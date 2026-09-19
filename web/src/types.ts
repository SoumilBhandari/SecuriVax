// Mirrors the JSON returned by the FastAPI backend.

export type Verdict = "USE" | "QUARANTINE" | "DISCARD";
export type Severity = "discard" | "quarantine" | "advisory" | "ok";
export type PointStatus = "ok" | "heat" | "freeze";

export interface Reason {
  code: string;
  severity: Severity;
  text: string;
}

export interface Gap {
  node_id: string;
  start_ts: number;
  end_ts: number;
  ongoing: boolean;
}

export interface Run {
  kind: "freeze" | "heat" | "humid";
  node_id: string;
  start_ts: number;
  end_ts: number;
  minutes: number;
  extreme: number;
  lat: number | null;
  lon: number | null;
  budget_used: number;
}

export interface RoutePoint {
  ts: number;
  lat: number;
  lon: number;
  temp_c: number;
  rh: number | null;
  status: PointStatus;
}

export interface SeriesPoint {
  ts: number;
  temp_c: number;
  rh: number | null;
}

export type EnvCode = "PROTECTED" | "TRACKING_AMBIENT" | "HEAT_SOURCE" | "FROZEN_PACKS" | "CALM" | "NO_DATA";

export interface LegEnvironment {
  code: EnvCode;
  text: string;
  source: "open-meteo" | "model" | "mixed";
  ambient_min_c: number | null;
  ambient_max_c: number | null;
  inside_mean_c: number | null;
  ambient_mean_c: number | null;
  hot_outside_share: number;
  noise_c: number | null;
  ambient: [number, number][];
}

export interface Segment {
  node_id: string;
  node_label: string;
  start_ts: number;
  end_ts: number | null;
  budget_used: number;
  reading_count: number;
  min_temp_c: number | null;
  max_temp_c: number | null;
  max_rh: number | null;
  data_through: number | null;
  last_temp_c: number | null;
  last_rh: number | null;
  start_lat: number | null;
  start_lon: number | null;
  end_lat: number | null;
  end_lon: number | null;
  gaps: Gap[];
  runs: Run[];
  route: RoutePoint[];
  series: SeriesPoint[];
  backup_label: string | null;
  backup_filled: number;
  max_disagreement_c: number | null;
  located_by: string | null;
  environment?: LegEnvironment;
}

export interface Product {
  id: string;
  name: string;
  kind: "vaccine" | "rapid_test";
  stability_ref: string;
  freeze_sensitive: boolean;
  freeze_check: string;
  storage_min_c: number;
  storage_max_c: number;
  notes: string;
}

export interface Box {
  id: string;
  product_id: string;
  lot: string;
  quantity: number;
  initial_budget_used: number;
  created_at: number;
}

export interface Report {
  verdict: Verdict;
  action: string;
  budget_used: number;
  budget_remaining: number;
  initial_budget_used: number;
  reasons: Reason[];
  segments: Segment[];
  current_temp_c: number | null;
  current_rh: number | null;
  hours_left_at_current: number | null;
  data_through: number | null;
  provisional: boolean;
  demo_time: boolean;
  time_scale: number;
  computed_at: number;
  box: Box;
  product: Product;
  current_node_id: string | null;
  places: Record<string, string>;
}

export interface Explanation {
  verdict: Verdict;
  text: string;
  source: "grok" | "template";
  places: Record<string, string>;
  places_source: "gemini" | "coords" | "mixed";
}

export interface BoxSummary extends Box {
  product_name: string;
  product_kind: Product["kind"];
  current_node_id: string | null;
  verdict: Verdict;
  budget_used: number;
}

export interface LatestReading {
  ts: number;
  temp_c: number;
  rh: number | null;
  lat: number | null;
  lon: number | null;
}

export interface NodeSummary {
  id: string;
  label: string;
  kind: string;
  facility: string;
  time_scale: number;
  last_seen_at: number | null;
  battery_v: number | null;
  fw_version: string | null;
  online: boolean;
  low_battery: boolean;
  backup_for: string | null;
  latest: LatestReading | null;
  box_ids: string[];
}

export interface Upload {
  id: number;
  boot_id: number;
  received_at: number;
  count: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  ack_seq: number | null;
}

export interface NodeDetail extends NodeSummary {
  recent: (LatestReading & { battery_v: number | null })[];
  uploads: Upload[];
}

export type Risk = "extreme" | "high" | "moderate" | "low";
export type WeatherSource = "open-meteo" | "model" | "mixed";

export interface Facility {
  id: string;
  name: string;
  kind: "store" | "clinic";
  lat: number;
  lon: number;
}

export interface StoreRisk extends Facility {
  risk: Risk;
  peak_c: number;
  peak_ts: number;
  hours_above_30_next_72h: number;
  hours_above_30_past_7d: number;
  max_rh_next_72h: number | null;
  forecast: [number, number][];
  actions: string[];
  stock: { id: string; product: string; verdict: Verdict; budget_used: number }[];
}

export interface StoresAtRisk {
  generated_at: number;
  source: WeatherSource;
  summary: string;
  facilities: StoreRisk[];
}

export interface CarrierLeg {
  start_ts: number;
  end_ts: number;
  hours: number;
  effective_cold_life_h: number | null;
  how: "fitted" | "held" | "unknown";
  predicted_breach_ts: number | null;
  actual_breach_ts: number | null;
  froze: boolean;
  outside_max_c: number;
  source: WeatherSource;
}

export interface CarrierPerformance {
  node_id: string;
  label: string;
  rating: "as rated" | "underperforming" | "failing" | "untested";
  note: string;
  effective_cold_life_h: number | null;
  rated_cold_life_h: number;
  legs: CarrierLeg[];
}

export interface TripOption {
  depart_ts: number;
  arrive_ts: number;
  end_ts: number;
  budget_used: number;
  max_inside_c: number;
  breach_ts: number | null;
  outside_max_c: number;
}

export interface TripPlan {
  generated_at: number;
  product: Product;
  origin: Facility;
  assumptions: string;
  cold_life_h: number;
  source: WeatherSource;
  destinations: {
    id: string;
    name: string;
    km: number;
    travel_h: number;
    best: TripOption;
    worst: TripOption;
    rated_best: TripOption | null;
    options: TripOption[];
  }[];
  recommendations: string[];
  stock_advice: string[];
}
