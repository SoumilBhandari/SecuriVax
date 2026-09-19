import type {
  AgentAdvice,
  BoxSummary,
  CarrierForecast,
  CarrierPerformance,
  CounterfactualRow,
  Explanation,
  Facility,
  FleetSummary,
  Impact,
  NodeDetail,
  NodeSummary,
  Product,
  Report,
  StoresAtRisk,
  TripPlan,
  VvmResult,
} from "../types";

// Same origin in production (FastAPI serves the app); proxied by Vite in dev.
const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const CODE_KEY = "vialtality.operator";

function operatorCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
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

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body) headers["Content-Type"] = "application/json"; // no preflight for plain GETs
  const code = operatorCode();
  if (code && init?.method && init.method !== "GET") headers["X-Operator-Token"] = code;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(20000) });
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === "TimeoutError";
    throw new ApiError(0, timeout ? "The server took too long. Check your signal and try again." : "Can't reach Vialtality. Check your signal.");
  }
  if (res.status === 401 && !retried) {
    const entered = window.prompt("Enter this site's operator code");
    if (entered) {
      try {
        localStorage.setItem(CODE_KEY, entered.trim());
      } catch {
        /* private mode: the code lasts for this request only */
      }
      return request<T>(path, init, true);
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, describe(res.status, body));
  }
  return res.json();
}

export const api = {
  boxes: () => request<BoxSummary[]>("/api/boxes"),
  fleet: () => request<FleetSummary>("/api/boxes/fleet/summary"),
  counterfactual: (id: string) => request<CounterfactualRow[]>(`/api/boxes/${encodeURIComponent(id)}/counterfactual`),
  report: (id: string) => request<Report>(`/api/boxes/${encodeURIComponent(id)}/report`),
  explain: (id: string) =>
    request<Explanation>(`/api/boxes/${encodeURIComponent(id)}/explain`, { method: "POST" }),
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
    request<{ confirmed: boolean }>(`/api/boxes/${encodeURIComponent(boxId)}/vvm/${checkId}/confirm`, {
      method: "POST",
      body: JSON.stringify(stage ? { stage } : {}),
    }),
  agent: (nodeId: string, destinationId: string | null) =>
    request<AgentAdvice>(`/api/nodes/${encodeURIComponent(nodeId)}/agent`, {
      method: "POST",
      body: JSON.stringify({ destination_id: destinationId }),
    }),
  decide: (nodeId: string, action: string, facilityId: string | null) =>
    request<{ logged: number }>(`/api/nodes/${encodeURIComponent(nodeId)}/decisions`, {
      method: "POST",
      body: JSON.stringify({ action, facility_id: facilityId }),
    }),
  impact: () => request<Impact>("/api/impact"),
  products: () => request<Product[]>("/api/products"),
  facilities: () => request<Facility[]>("/api/facilities"),
  storesAtRisk: () => request<StoresAtRisk>("/api/climate/stores"),
  carriers: () => request<CarrierPerformance[]>("/api/climate/carriers"),
  plan: (body: { product_id: string; origin_id: string; carrier_id?: string | null; session_h?: number }) =>
    request<TripPlan>("/api/climate/plan", { method: "POST", body: JSON.stringify(body) }),
};
