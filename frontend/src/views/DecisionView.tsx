// "What should I plan on for tomorrow?" – the forecast available at the decision cutoff,
// with an uncertainty band calibrated on the forecast's own January track record.
import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { api, type Decision, type Meta } from "../api";
import { Card, ErrorState, Legend, Loading, Tile, TooltipBox } from "../components/ui";
import { axisProps, useThemeColors } from "../components/theme";
import {
  HALF_HOURS,
  addDays,
  compactMW,
  downloadCsv,
  fmtDateTime,
  fmtDay,
  fmtGW,
  fmtGWh,
  fmtMW,
  fmtPct,
  fmtSignedGW,
  fmtTime,
} from "../format";
import { useApi } from "../useApi";

interface Props {
  meta: Meta;
  date: string;
  cutoff: string;
  onDate: (d: string) => void;
  onCutoff: (c: string) => void;
}

export function DecisionView({ meta, date, cutoff, onDate, onCutoff }: Props) {
  const { data, error, loading } = useApi<Decision>(api.decision(date, cutoff));
  const [showActual, setShowActual] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const c = useThemeColors();
  const dates = meta.delivery_dates;
  const i = dates.indexOf(date);

  const rows = useMemo(
    () =>
      (data?.periods ?? []).map((p) => ({
        time: fmtTime(p.start_time),
        sp: p.settlement_period,
        forecast: p.forecast,
        expected: p.expected,
        band: p.p10 !== null && p.p90 !== null ? [p.p10, p.p90] : null,
        p10: p.p10,
        p90: p.p90,
        actual: p.actual,
        horizon: p.horizon_h,
      })),
    [data],
  );

  const s = data?.summary;
  const forecastErrPct =
    s && s.actual_mwh ? (s.forecast_mwh - s.actual_mwh) / s.actual_mwh : null;

  return (
    <div className="stack">
      <div className="card">
        <div className="controls">
          <div className="field">
            <label htmlFor="dd">Delivery day</label>
            <div className="date-stepper">
              <button aria-label="Previous day" disabled={i <= 0} onClick={() => onDate(dates[i - 1])}>
                ‹
              </button>
              <select id="dd" value={date} onChange={(e) => onDate(e.target.value)}>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {fmtDay(d)}
                  </option>
                ))}
              </select>
              <button aria-label="Next day" disabled={i >= dates.length - 1} onClick={() => onDate(dates[i + 1])}>
                ›
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="co">Decision cutoff (UK time, day before)</label>
            <select id="co" value={cutoff} onChange={(e) => onCutoff(e.target.value)}>
              {HALF_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} on {fmtDay(addDays(date, -1))}
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
            Show what actually happened (hindsight)
          </label>
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {!data && loading && <Loading height={420} />}

      {data && s && (
        <>
          <div className="banner" role="status">
            <span aria-hidden>ⓘ</span>
            <span>
              {data.run_publish_time ? (
                <>
                  At your cutoff, the latest wind forecast was published{" "}
                  <strong>{fmtDateTime(data.run_publish_time)}</strong>, looking{" "}
                  {Math.round(rows[0]?.horizon ?? 0)}–{Math.round(rows[rows.length - 1]?.horizon ?? 0)} h ahead.
                  {data.next_run_publish_time && (
                    <>
                      {" "}
                      The next update lands at <strong>{fmtTime(data.next_run_publish_time)}</strong>
                      {minutesAfter(data.cutoff_utc, data.next_run_publish_time)}.
                    </>
                  )}
                </>
              ) : (
                <>No forecast had been published before this cutoff.</>
              )}
            </span>
          </div>

          <div className="tiles">
            <Tile
              label="Raw forecast"
              swatch={c.forecast}
              value={fmtGWh(s.forecast_mwh)}
              note={`avg ${fmtGW(s.forecast_mwh / 24)} · peak ${fmtGW(s.peak_forecast_mw)}`}
            />
            <Tile
              hero
              label="Expected wind (bias-adjusted)"
              swatch={c.expected}
              value={fmtGWh(s.expected_mwh)}
              note={
                data.band
                  ? `raw forecast minus typical over-forecast of ${fmtGW(data.band.error_q50)}`
                  : "not enough history"
              }
            />
            <Tile
              label="Low-wind case (P10)"
              value={fmtGWh(s.p10_mwh)}
              note="actual beat this level in 90% of January half-hours"
            />
            {showActual && (
              <Tile
                label="Actual outturn (hindsight)"
                swatch={c.actual}
                value={fmtGWh(s.actual_mwh)}
                note={
                  forecastErrPct !== null
                    ? `raw forecast was ${fmtPct(Math.abs(forecastErrPct))} ${forecastErrPct > 0 ? "too high" : "too low"} · MAE ${fmtGW(s.metrics.mae)}`
                    : "not yet known"
                }
              />
            )}
          </div>

          <Card
            title={`Wind generation for ${fmtDay(data.delivery_date)}`}
            sub="Half-hourly national wind, MW. Shaded band = range actual wind fell in 80% of the time (P10–P90), calibrated on the other January days."
            actions={
              <div style={{ display: "flex", gap: 12 }}>
                <button className="link-btn" onClick={() => setShowTable((v) => !v)}>
                  {showTable ? "Hide table" : "Show table"}
                </button>
                <button
                  className="link-btn"
                  onClick={() =>
                    downloadCsv(
                      `wind-decision-${data.delivery_date}-cutoff-${cutoff.replace(":", "")}.csv`,
                      data.periods as unknown as Record<string, unknown>[],
                    )
                  }
                >
                  Download CSV
                </button>
              </div>
            }
          >
            <Legend
              items={[
                { label: "Raw forecast", color: c.forecast },
                { label: "Expected (bias-adjusted)", color: c.expected },
                { label: "P10–P90 range", color: c.expected, kind: "band" },
                ...(showActual ? [{ label: "Actual", color: c.actual }] : []),
              ]}
            />
            <div style={{ height: 380, marginTop: 8 }}>
              <ResponsiveContainer>
                <ComposedChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="time" {...axisProps(c)} interval={5} />
                  <YAxis {...axisProps(c)} axisLine={false} tickFormatter={compactMW} width={44} />
                  <Tooltip content={<DecisionTooltip showActual={showActual} c={c} />} cursor={{ stroke: c.axis }} />
                  <Area
                    dataKey="band"
                    stroke="none"
                    fill={c.expected}
                    fillOpacity={0.14}
                    isAnimationActive={false}
                    activeDot={false}
                  />
                  <Line dataKey="forecast" stroke={c.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="expected" stroke={c.expected} strokeWidth={2} dot={false} isAnimationActive={false} />
                  {showActual && (
                    <Line dataKey="actual" stroke={c.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {showTable && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Time</th>
                      <th>Forecast</th>
                      <th>Expected</th>
                      <th>P10</th>
                      <th>P90</th>
                      {showActual && <th>Actual</th>}
                      <th>Hours ahead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.sp}>
                        <td>SP {r.sp}</td>
                        <td>{r.time}</td>
                        <td>{fmtMW(r.forecast)}</td>
                        <td>{fmtMW(r.expected)}</td>
                        <td>{fmtMW(r.p10)}</td>
                        <td>{fmtMW(r.p90)}</td>
                        {showActual && <td>{fmtMW(r.actual)}</td>}
                        <td>{r.horizon?.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {data.band && (
            <p className="sub" style={{ margin: 0 }}>
              How the band is built: across the other {Math.round(data.band.n_samples / 48)} January delivery days,
              the forecast available at this cutoff was off by {fmtSignedGW(data.band.error_q50)} at the median,
              and by between {fmtSignedGW(data.band.error_q10)} and {fmtSignedGW(data.band.error_q90)} in 80% of
              half-hours (positive = forecast too high). Those errors are subtracted from today's forecast.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function minutesAfter(cutoffIso: string, nextIso: string): string {
  const mins = Math.round((Date.parse(nextIso) - Date.parse(cutoffIso)) / 60000);
  if (mins <= 0) return "";
  if (mins < 120) return ` — just ${mins} min after your cutoff`;
  return ` — ${(mins / 60).toFixed(1)} h after your cutoff`;
}

type Row = { time: string; forecast: number | null; expected: number | null; p10: number | null; p90: number | null; actual: number | null; horizon: number | null };

function DecisionTooltip({
  active,
  payload,
  showActual,
  c,
}: TooltipProps<number, string> & { showActual: boolean; c: ReturnType<typeof useThemeColors> }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Row;
  return (
    <TooltipBox
      title={`${r.time} · ${r.horizon?.toFixed(1)} h ahead`}
      rows={[
        { label: "Raw forecast", value: fmtMW(r.forecast), color: c.forecast },
        { label: "Expected", value: fmtMW(r.expected), color: c.expected },
        { label: "P10 – P90", value: `${fmtGW(r.p10)} – ${fmtGW(r.p90)}` },
        ...(showActual ? [{ label: "Actual", value: fmtMW(r.actual), color: c.actual }] : []),
      ]}
    />
  );
}
