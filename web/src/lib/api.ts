import type {
  BoxSummary,
  CarrierPerformance,
  Explanation,
  Facility,
  NodeDetail,
  NodeSummary,
  Product,
  Report,
  StoresAtRisk,
  TripPlan,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  return res.json();
}

export const api = {
  boxes: () => request<BoxSummary[]>("/api/boxes"),
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
  products: () => request<Product[]>("/api/products"),
  facilities: () => request<Facility[]>("/api/facilities"),
  storesAtRisk: () => request<StoresAtRisk>("/api/climate/stores"),
  carriers: () => request<CarrierPerformance[]>("/api/climate/carriers"),
  plan: (body: { product_id: string; origin_id: string; carrier_id?: string | null; session_h?: number }) =>
    request<TripPlan>("/api/climate/plan", { method: "POST", body: JSON.stringify(body) }),
};
