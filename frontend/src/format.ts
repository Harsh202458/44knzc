// Display helpers. All times are shown in UK local time (Europe/London).

const UK = "Europe/London";

export function fmtGW(mw: number | null | undefined, digits = 1): string {
  if (mw === null || mw === undefined || Number.isNaN(mw)) return "–";
  return `${(mw / 1000).toFixed(digits)} GW`;
}

export function fmtMW(mw: number | null | undefined): string {
  if (mw === null || mw === undefined || Number.isNaN(mw)) return "–";
  return `${Math.round(mw).toLocaleString("en-GB")} MW`;
}

/** Signed GW, e.g. "+1.7 GW" / "−0.4 GW". */
export function fmtSignedGW(mw: number | null | undefined, digits = 1): string {
  if (mw === null || mw === undefined || Number.isNaN(mw)) return "–";
  const v = (mw / 1000).toFixed(digits);
  return mw > 0 ? `+${v} GW` : mw < 0 ? `−${v.slice(1)} GW` : `${v} GW`;
}

export function fmtGWh(mwh: number | null | undefined): string {
  if (mwh === null || mwh === undefined || Number.isNaN(mwh)) return "–";
  return `${(mwh / 1000).toFixed(0)} GWh`;
}

export function fmtPct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}

/** Axis ticks: 0 / 5K / 10K style. */
export function compactMW(mw: number): string {
  return Math.abs(mw) >= 1000 ? `${+(mw / 1000).toFixed(1)}K` : `${Math.round(mw)}`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: UK });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: UK,
  });
}

export function fmtDay(isoDate: string): string {
  // isoDate is a plain calendar date (YYYY-MM-DD); format at midday to dodge TZ edges.
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: UK,
  });
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 00:00, 00:30 … 23:30 */
export const HALF_HOURS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
