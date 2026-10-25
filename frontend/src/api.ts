// Typed client for the FastAPI backend. Shapes mirror backend/app/schemas.py.

export interface Metrics {
  n: number;
  mae?: number;
  rmse?: number;
  bias?: number;
  nmae?: number;
  p50_abs_error?: number;
  p90_abs_error?: number;
  error_p10?: number;
  error_p90?: number;
  max_shortfall?: number;
  max_surplus?: number;
  mean_actual?: number;
  within_1gw?: number;
  share_shortfall?: number;
}

export interface Meta {
  fetched_at: string;
  source: string;
  default_cutoff: string;
  delivery_dates: string[];
  data_from: string;
  data_to: string;
  n_runs: number;
  run_schedule_utc: Record<string, number>;
}

export interface DecisionPeriod {
  start_time: string;
  settlement_period: number;
  forecast: number | null;
  expected: number | null;
  p10: number | null;
  p90: number | null;
  actual: number | null;
  horizon_h: number | null;
}

export interface Decision {
  delivery_date: string;
  cutoff_utc: string;
  run_publish_time: string | null;
  next_run_publish_time: string | null;
  band: { method: string; n_samples: number; error_q10: number; error_q50: number; error_q90: number } | null;
  summary: {
    forecast_mwh: number;
    expected_mwh: number;
    p10_mwh: number;
    actual_mwh: number | null;
    peak_forecast_mw: number | null;
    min_forecast_mw: number | null;
    metrics: Metrics;
  };
  periods: DecisionPeriod[];
}

export interface TimeSeries {
  horizon_h: number;
  points: { start_time: string; actual: number | null; forecast: number | null; publish_time: string | null }[];
  metrics: Metrics;
}

export interface Accuracy {
  mode: "decision" | "horizon";
  label: string;
  metrics: Metrics;
  by_hour: { hour: number; mae: number; bias: number; n: number }[];
  by_day: { date: string; mae: number; bias: number; forecast_mwh: number; actual_mwh: number; n: number }[];
  histogram: { from: number; to: number; count: number }[];
  bias_correction?: { method: string; raw_mae: number; corrected_mae: number; improvement: number } | null;
}

export interface HorizonRow {
  horizon_h: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  p90_abs_error: number | null;
  coverage: number;
}

export interface CutoffRow {
  cutoff: string;
  run_hhmm: string | null;
  mae: number | null;
  bias: number | null;
  mean_horizon_h: number | null;
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export function buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${BASE}${path}${q ? `?${q}` : ""}`;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

export const api = {
  meta: () => buildUrl("/api/meta"),
  decision: (date: string, cutoff: string) => buildUrl("/api/decision", { date, cutoff }),
  timeseries: (horizon: number, start?: string, end?: string) =>
    buildUrl("/api/timeseries", { horizon, start, end }),
  accuracy: (p: { mode: "decision" | "horizon"; cutoff?: string; horizon?: number }) =>
    buildUrl("/api/accuracy", p),
  horizons: () => buildUrl("/api/accuracy/horizons"),
  cutoffs: () => buildUrl("/api/accuracy/cutoffs"),
};
