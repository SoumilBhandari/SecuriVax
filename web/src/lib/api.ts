import type {
  AgentAdvice,
  BoxSummary,
  CarrierForecast,
  CarrierPerformance,
  CounterfactualRow,
  Facility,
  FleetSummary,
  Impact,
  LearnedRate,
  LearningSummary,
  LiveRecent,
  NodeDetail,
  NodeSummary,
  Product,
  Report,
  StoresAtRisk,
  TripPlan,
  User,
  VvmResult,
} from "../types";
import { SNAPSHOT } from "./snapshot";

// Same origin in production (FastAPI serves the app); proxied by Vite in dev.
const BASE = import.meta.env.VITE_API_BASE ?? "";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** FastAPI errors: a string, a list of validation errors, or an HTML proxy page. */
function describe(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => (d as { msg?: string }).msg ?? "invalid input").join("; ");
  if (status === 429) return "Too many requests, try again in a minute.";
  if (status >= 500) return `Server error (${status}). Try again shortly.`;
  return `Request failed (${status}).`;
}

// Who's asking travels in the sign-in cookie (HttpOnly, same origin): changes
// need an operator account. A change refused for want of a sign-in raises
// SIGN_IN_EVENT, and the app goes to sign-in and back.
export const SIGN_IN_EVENT = "securivax:sign-in";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (SNAPSHOT) return fromSnapshot<T>(path, init);
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body) headers["Content-Type"] = "application/json"; // no preflight for plain GETs
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(20000) });
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === "TimeoutError";
    throw new ApiError(0, timeout ? "The server took too long. Check your signal and try again." : "Can't reach SecuriVax. Check your signal.");
  }
  if (res.status === 401 && init?.method && init.method !== "GET" && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(SIGN_IN_EVENT));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, describe(res.status, body));
  }
  return res.json();
}

/** Snapshot mode: the saved answer for this exact call, or a clear refusal. */
async function fromSnapshot<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  const table = method === "GET" ? SNAPSHOT!.get : SNAPSHOT!.post;
  const key = body ? `${path} ${body}` : path;
  if (key in table) return structuredClone(table[key]) as T;
  throw new ApiError(
    0,
    method === "GET"
      ? "Not saved in this snapshot."
      : "This is a snapshot, so it can't change anything or ask new questions. That needs the live app.",
  );
}

interface Place {
  lat?: number | null;
  lon?: number | null;
  accuracy_m?: number | null;
  facility_id?: string | null;
  note?: string;
}

const post = (body?: unknown): RequestInit => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  auth: {
    me: () => request<{ user: User | null }>("/api/auth/me"),
    login: (email: string, password: string) => request<{ user: User }>("/api/auth/login", post({ email, password })),
    register: (b: { email: string; password: string; name: string; operator_code: string }) => request<{ user: User }>("/api/auth/register", post(b)),
    logout: () => request<{ user: null }>("/api/auth/logout", post()),
  },
  boxes: () => request<BoxSummary[]>("/api/boxes"),
  fleet: () => request<FleetSummary>("/api/boxes/fleet/summary"),
  learning: () => request<LearningSummary>("/api/boxes/learning/summary"),
  resetStage: () => request<{ reset: boolean }>("/api/admin/reset-stage", { method: "POST" }),
  counterfactual: (id: string) => request<CounterfactualRow[]>(`/api/boxes/${encodeURIComponent(id)}/counterfactual`),
  report: (id: string) => request<Report>(`/api/boxes/${encodeURIComponent(id)}/report`),
  load: (boxId: string, nodeId: string) =>
    request<{ status: string; action?: string; node_id: string }>(
      `/api/boxes/${encodeURIComponent(boxId)}/load`,
      { method: "POST", body: JSON.stringify({ node_id: nodeId }) },
    ),
  unload: (boxId: string, note = "") =>
    request<{ status: string }>(`/api/boxes/${encodeURIComponent(boxId)}/unload`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  nodes: () => request<NodeSummary[]>("/api/nodes"),
  node: (id: string) => request<NodeDetail>(`/api/nodes/${encodeURIComponent(id)}`),
  forecast: (nodeId: string) => request<CarrierForecast>(`/api/nodes/${encodeURIComponent(nodeId)}/forecast`),
  checkVvm: (boxId: string, image: string) =>
    request<VvmResult>(`/api/boxes/${encodeURIComponent(boxId)}/vvm`, { method: "POST", body: JSON.stringify({ image }) }),
  confirmVvm: (boxId: string, checkId: number, stage?: number) =>
    request<{ confirmed: boolean; flagged: boolean; learned_rate: LearnedRate }>(`/api/boxes/${encodeURIComponent(boxId)}/vvm/${checkId}/confirm`, {
      method: "POST",
      body: JSON.stringify(stage ? { stage } : {}),
    }),
  agent: (nodeId: string, destinationId: string | null) =>
    request<AgentAdvice>(`/api/nodes/${encodeURIComponent(nodeId)}/agent`, {
      method: "POST",
      body: JSON.stringify({ destination_id: destinationId }),
      signal: AbortSignal.timeout(60000), // Gemini may call several tools in turn
    }),
  decide: (nodeId: string, action: string, facilityId: string | null) =>
    request<{ logged: number }>(`/api/nodes/${encodeURIComponent(nodeId)}/decisions`, {
      method: "POST",
      body: JSON.stringify({ action, facility_id: facilityId }),
    }),
  impact: () => request<Impact>("/api/impact"),
  products: () => request<Product[]>("/api/products"),
  facilities: () => request<Facility[]>("/api/facilities"),
  // The field: a driver's NFC checkpoint, the clinic's QR pickup, watching a node live.
  checkpoint: (boxId: string, place: Place) =>
    request<{ status: string; facility: string | null; node_id: string | null }>(`/api/boxes/${encodeURIComponent(boxId)}/checkpoint`, post(place)),
  receive: (boxId: string, place: Place) =>
    request<{ status: string; facility: string | null; from_node: string | null }>(`/api/boxes/${encodeURIComponent(boxId)}/receive`, post(place)),
  watchLive: (nodeId: string) =>
    request<{ state: "off" | "asked" | "live"; until: number | null; next_checkin: number | null }>(`/api/nodes/${encodeURIComponent(nodeId)}/live`, post()),
  /** Where a carrier could be heading: within a day's drive, nearest first. */
  destinations: (nodeId: string) =>
    request<(Facility & { road_km: number | null })[]>(`/api/nodes/${encodeURIComponent(nodeId)}/destinations`),
  storesAtRisk: () => request<StoresAtRisk>("/api/climate/stores"),
  carriers: () => request<CarrierPerformance[]>("/api/climate/carriers"),
  liveRecent: (limit = 120, node?: string) =>
    request<LiveRecent>(`/api/live/recent?${new URLSearchParams({ limit: String(limit), ...(node && { node }) })}`),
  /** Server-sent events of new readings; the browser reconnects and resumes on its own. */
  liveStreamUrl: ({ after, node }: { after?: number; node?: string }) =>
    `${BASE}/api/live/stream?${new URLSearchParams({ ...(after != null && { after: String(after) }), ...(node && { node }) })}`,
  plan: (body: { product_id: string; origin_id: string; carrier_id?: string | null; session_h?: number }) =>
    request<TripPlan>("/api/climate/plan", { method: "POST", body: JSON.stringify(body) }),
};
