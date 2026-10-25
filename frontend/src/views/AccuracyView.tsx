// "How far can I trust the forecast?" – error statistics, and how they depend on
// lead time, decision cutoff, time of day and day.
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { api, type Accuracy, type CutoffRow, type HorizonRow, type Meta } from "../api";
import { Card, ErrorState, Legend, Loading, Tile, TooltipBox } from "../components/ui";
import { axisProps, useThemeColors } from "../components/theme";
import { compactMW, downloadCsv, fmtDay, fmtGW, fmtPct, fmtSignedGW } from "../format";
import { useApi } from "../useApi";

type Mode = "decision" | "horizon";

export function AccuracyView({ meta, cutoff }: { meta: Meta; cutoff: string }) {
  const [mode, setMode] = useState<Mode>("decision");
  const [horizon, setHorizon] = useState(24);
  const [committed, setCommitted] = useState(24);
  const acc = useApi<Accuracy>(api.accuracy(mode === "decision" ? { mode, cutoff } : { mode, horizon: committed }));
  const horizons = useApi<HorizonRow[]>(api.horizons());
  const cutoffs = useApi<CutoffRow[]>(api.cutoffs());
  const decisionAcc = useApi<Accuracy>(api.accuracy({ mode: "decision", cutoff }));
  const c = useThemeColors();
  const m = acc.data?.metrics;

  return (
    <div className="stack">
      <Insights meta={meta} cutoff={cutoff} decision={decisionAcc.data} horizons={horizons.data} cutoffs={cutoffs.data} />

      <div className="card">
        <div className="controls">
          <div className="field">
            <span className="label">Which forecast to score</span>
            <div className="seg" role="group">
              <button aria-pressed={mode === "decision"} onClick={() => setMode("decision")}>
                The one available at {cutoff} D-1
              </button>
              <button aria-pressed={mode === "horizon"} onClick={() => setMode("horizon")}>
                Fixed lead time
              </button>
            </div>
          </div>
          {mode === "horizon" && (
            <div className="field">
              <label htmlFor="hz2">At least … hours ahead</label>
              <div className="slider">
                <input
                  id="hz2"
                  type="range"
                  min={0}
                  max={48}
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  onPointerUp={() => setCommitted(horizon)}
                  onKeyUp={() => setCommitted(horizon)}
                />
                <output htmlFor="hz2">{horizon} h</output>
              </div>
            </div>
          )}
        </div>
      </div>

      {acc.error && <ErrorState message={acc.error} />}
      {!acc.data && acc.loading && <Loading height={120} />}
      {acc.data && m && (
        <div className="tiles">
          <Tile label="Mean absolute error" value={fmtGW(m.mae, 2)} note={`${fmtPct(m.nmae)} of average wind (${fmtGW(m.mean_actual)})`} />
          <Tile label="Bias (forecast − actual)" value={fmtSignedGW(m.bias, 2)} note={`forecast too high in ${fmtPct(m.share_shortfall)} of half-hours`} />
          <Tile label="90% of errors within" value={fmtGW(m.p90_abs_error, 2)} note={`RMSE ${fmtGW(m.rmse, 2)}`} />
          {acc.data.bias_correction && (
            <Tile
              hero
              label="Error after bias correction"
              value={fmtGW(acc.data.bias_correction.corrected_mae, 2)}
              note={`${fmtPct(acc.data.bias_correction.improvement)} lower than the raw forecast, no look-ahead`}
            />
          )}
          <Tile label="Worst shortfall" value={fmtGW(m.max_shortfall, 1)} note={`worst surplus ${fmtGW(m.max_surplus, 1)}`} />
        </div>
      )}

      <div className="grid-2">
        <Card
          title="Error grows with lead time"
          sub="Mean absolute error of the newest forecast published at least N hours before each half-hour. Shaded = lead times a 09:00 D-1 decision relies on."
        >
          <Legend
            items={[
              { label: "Mean absolute error", color: c.seq },
              { label: "90th percentile error", color: c.forecast },
            ]}
          />
          {horizons.data ? (
            <div style={{ height: 260, marginTop: 8 }}>
              <ResponsiveContainer>
                <LineChart data={horizons.data} margin={{ top: 10, right: 16, bottom: 14, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <ReferenceArea x1={16} x2={40} fill={c.surface2} fillOpacity={0.9} />
                  <XAxis
                    dataKey="horizon_h"
                    type="number"
                    domain={[0, 48]}
                    ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]}
                    {...axisProps(c)}
                    label={{ value: "hours ahead", position: "insideBottom", offset: -8, fill: c.muted, fontSize: 11 }}
                  />
                  <YAxis {...axisProps(c)} axisLine={false} tickFormatter={compactMW} width={44} />
                  <Tooltip content={<HorizonTip c={c} />} cursor={{ stroke: c.axis }} />
                  <Line dataKey="mae" stroke={c.seq} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="p90_abs_error" stroke={c.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : horizons.error ? (
            <ErrorState message={horizons.error} />
          ) : (
            <Loading height={260} />
          )}
        </Card>

        <Card
          title="What if the decision were made at a different time?"
          sub="Mean absolute error of the forecast available at each cutoff on D-1. Steps happen when a new forecast is published."
        >
          {cutoffs.data ? (
            <div style={{ height: 284, marginTop: 8 }}>
              <ResponsiveContainer>
                <LineChart data={cutoffs.data} margin={{ top: 10, right: 16, bottom: 14, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis
                    dataKey="cutoff"
                    {...axisProps(c)}
                    interval={5}
                    label={{ value: "cutoff on D-1 (UK)", position: "insideBottom", offset: -8, fill: c.muted, fontSize: 11 }}
                  />
                  <YAxis
                    {...axisProps(c)}
                    axisLine={false}
                    tickFormatter={(v: number) => `${(v / 1000).toFixed(2)} GW`}
                    width={62}
                    domain={["auto", "auto"]}
                  />
                  <ReferenceLine x={cutoff} stroke={c.ink2} strokeDasharray="0" label={{ value: "your cutoff", fill: c.ink2, fontSize: 11, position: "insideTopLeft" }} />
                  <Tooltip content={<CutoffTip c={c} />} cursor={{ stroke: c.axis }} />
                  <Line type="stepAfter" dataKey="mae" stroke={c.seq} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : cutoffs.error ? (
            <ErrorState message={cutoffs.error} />
          ) : (
            <Loading height={284} />
          )}
        </Card>

        <Card
          title="Bias by time of day"
          sub={`Average forecast − actual by UK hour. Red = forecast too high (shortfall to cover), blue = too low. ${acc.data?.label ?? ""}.`}
        >
          {acc.data ? (
            <div style={{ height: 260, marginTop: 8 }}>
              <ResponsiveContainer>
                <BarChart data={acc.data.by_hour} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="hour" {...axisProps(c)} tickFormatter={(h: number) => `${String(h).padStart(2, "0")}:00`} interval={2} />
                  <YAxis {...axisProps(c)} axisLine={false} tickFormatter={compactMW} width={44} />
                  <ReferenceLine y={0} stroke={c.axis} />
                  <Tooltip content={<HourTip c={c} />} cursor={{ fill: c.surface2 }} />
                  <Bar dataKey="bias" maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {acc.data.by_hour.map((r) => (
                      <Cell key={r.hour} fill={r.bias >= 0 ? c.pos : c.neg} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Loading height={260} />
          )}
        </Card>

        <Card title="Error distribution" sub="Number of half-hours by size of error (forecast − actual), 500 MW bins.">
          {acc.data ? (
            <div style={{ height: 260, marginTop: 8 }}>
              <ResponsiveContainer>
                <BarChart data={acc.data.histogram} margin={{ top: 10, right: 16, bottom: 0, left: 0 }} barCategoryGap={2}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="from" {...axisProps(c)} tickFormatter={(v: number) => compactMW(v)} interval={1} />
                  <YAxis {...axisProps(c)} axisLine={false} width={36} />
                  <ReferenceLine x={0} stroke={c.ink2} />
                  <Tooltip content={<HistTip />} cursor={{ fill: c.surface2 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {acc.data.histogram.map((b) => (
                      <Cell key={b.from} fill={b.from >= 0 ? c.pos : c.neg} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Loading height={260} />
          )}
        </Card>
      </div>

      {acc.data && (
        <Card
          title="Accuracy day by day"
          sub="Mean absolute error per delivery day. Tall bars are the days a trader would have been caught out."
          actions={
            <button className="link-btn" onClick={() => downloadCsv(`wind-accuracy-by-day-${mode}.csv`, acc.data!.by_day)}>
              Download CSV
            </button>
          }
        >
          <div className="grid-2" style={{ gridTemplateColumns: "minmax(0,2.2fr) minmax(0,1fr)" }}>
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={acc.data.by_day} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="date" {...axisProps(c)} tickFormatter={(d: string) => d.slice(8)} interval={1} />
                  <YAxis {...axisProps(c)} axisLine={false} tickFormatter={compactMW} width={44} />
                  <Tooltip content={<DayTip c={c} />} cursor={{ fill: c.surface2 }} />
                  <Bar dataKey="mae" fill={c.seq} maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div className="label" style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 550, marginBottom: 4 }}>
                Worst days
              </div>
              <ul className="worst">
                {[...acc.data.by_day]
                  .sort((a, b) => b.mae - a.mae)
                  .slice(0, 5)
                  .map((d) => (
                    <li key={d.date}>
                      <span>{fmtDay(d.date)}</span>
                      <span>
                        MAE {fmtGW(d.mae)} · <span className="pill">{d.bias > 0 ? "over-forecast" : "under-forecast"}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </Card>
      )}
      <p className="sub" style={{ margin: 0 }}>
        Scored over {meta.delivery_dates.length} delivery days ({fmtDay(meta.delivery_dates[0])} –{" "}
        {fmtDay(meta.delivery_dates[meta.delivery_dates.length - 1])}), i.e. every day-ahead purchase decided in
        January 2026.
      </p>
    </div>
  );
}

function Insights(props: {
  meta: Meta;
  cutoff: string;
  decision: Accuracy | null;
  horizons: HorizonRow[] | null;
  cutoffs: CutoffRow[] | null;
}) {
  const { decision, horizons, cutoffs, cutoff } = props;
  if (!decision || !horizons || !cutoffs) return <Loading height={140} />;
  const m = decision.metrics;
  const h0 = horizons.find((h) => h.horizon_h === 1);
  const h36 = horizons.find((h) => h.horizon_h === 36);
  const cur = cutoffs.find((r) => r.cutoff === cutoff);
  const next = cutoffs.find((r) => r.cutoff > cutoff && r.run_hhmm !== cur?.run_hhmm);
  // Best realistic alternative: a cutoff no later than noon (day-ahead auctions close late morning).
  const best = cutoffs
    .filter((r) => r.cutoff > cutoff && r.cutoff <= "12:00" && r.mae !== null)
    .sort((a, b) => (a.mae ?? 0) - (b.mae ?? 0))[0];
  const worst = [...decision.by_day].sort((a, b) => b.mae - a.mae)[0];
  const night = decision.by_hour.filter((h) => h.hour < 7);
  const day = decision.by_hour.filter((h) => h.hour >= 10 && h.hour < 18);
  const avg = (xs: { bias: number }[]) => xs.reduce((s, x) => s + x.bias, 0) / Math.max(xs.length, 1);
  const pctGain = (r?: CutoffRow) => (cur?.mae && r?.mae ? (cur.mae - r.mae) / cur.mae : null);

  return (
    <Card title="Key findings" sub={`January 2026 · forecast available at ${cutoff} on the day before delivery`}>
      <ul className="insights">
        <li>
          The forecast you buy against is off by <strong>{fmtGW(m.mae, 1)}</strong> on average (
          {fmtPct(m.nmae)} of average wind output).
        </li>
        <li>
          It is <strong>systematically too high</strong>: it over-forecast in {fmtPct(m.share_shortfall)} of
          half-hours, by {fmtSignedGW(m.bias, 1)} on average. Planning on the raw forecast means routinely
          under-buying. Use the bias-adjusted “expected” figure instead.
        </li>
        {h0 && h36 && (
          <li>
            Error grows with lead time, from {fmtGW(h0.mae, 1)} one hour ahead to {fmtGW(h36.mae, 1)} 36 hours
            ahead. Much of the error is a steady offset, not timing.
          </li>
        )}
        {decision.bias_correction && (
          <li>
            <strong>Correcting that bias is the biggest win:</strong> subtracting the typical past error (using only
            days already known at decision time) cuts the average error by{" "}
            <strong>{fmtPct(decision.bias_correction.improvement)}</strong>, from{" "}
            {fmtGW(decision.bias_correction.raw_mae, 2)} to {fmtGW(decision.bias_correction.corrected_mae, 2)}. That
            is the "expected" line on the decision screen.
          </li>
        )}
        {night.length > 0 && day.length > 0 && (
          <li>
            The over-forecast is worst overnight ({fmtSignedGW(avg(night), 1)} on average, 00:00–07:00) and
            smallest in the working day ({fmtSignedGW(avg(day), 1)}, 10:00–18:00).
          </li>
        )}
        {cur && next && (
          <li>
            At {cutoff} you trade on the {cur.run_hhmm} forecast. The {next.run_hhmm} update barely helps (
            {fmtPct(pctGain(next), 0)} lower error)
            {best && best.run_hhmm !== next.run_hhmm && (
              <>
                ; waiting for the {best.run_hhmm} update would cut error by {fmtPct(pctGain(best), 0)}
              </>
            )}
            .
          </li>
        )}
        {worst && (
          <li>
            Worst day: <strong>{fmtDay(worst.date)}</strong>, off by {fmtGW(worst.mae, 1)} on average (
            {worst.bias > 0 ? "far less wind than forecast" : "far more wind than forecast"}).
          </li>
        )}
      </ul>
    </Card>
  );
}

type C = { c: ReturnType<typeof useThemeColors> };

function HorizonTip({ active, payload, c }: TooltipProps<number, string> & C) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as HorizonRow;
  return (
    <TooltipBox
      title={`≥ ${r.horizon_h} h ahead`}
      rows={[
        { label: "Mean abs error", value: fmtGW(r.mae, 2), color: c.seq },
        { label: "90th pct error", value: fmtGW(r.p90_abs_error, 2), color: c.forecast },
        { label: "Bias", value: fmtSignedGW(r.bias, 2) },
        { label: "Coverage", value: fmtPct(r.coverage) },
      ]}
    />
  );
}

function CutoffTip({ active, payload, c }: TooltipProps<number, string> & C) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as CutoffRow;
  return (
    <TooltipBox
      title={`Cutoff ${r.cutoff} D-1`}
      rows={[
        { label: "Forecast used", value: r.run_hhmm ? `${r.run_hhmm} run` : "–" },
        { label: "Mean abs error", value: fmtGW(r.mae, 2), color: c.seq },
        { label: "Bias", value: fmtSignedGW(r.bias, 2) },
        { label: "Avg hours ahead", value: r.mean_horizon_h?.toFixed(1) ?? "–" },
      ]}
    />
  );
}

function HourTip({ active, payload, c }: TooltipProps<number, string> & C) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Accuracy["by_hour"][number];
  return (
    <TooltipBox
      title={`${String(r.hour).padStart(2, "0")}:00 – ${String(r.hour).padStart(2, "0")}:59`}
      rows={[
        { label: "Bias", value: fmtSignedGW(r.bias, 2), color: r.bias >= 0 ? c.pos : c.neg },
        { label: "Mean abs error", value: fmtGW(r.mae, 2) },
      ]}
    />
  );
}

function HistTip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Accuracy["histogram"][number];
  return (
    <TooltipBox
      title={`${fmtSignedGW(r.from, 1)} to ${fmtSignedGW(r.to, 1)}`}
      rows={[{ label: "Half-hours", value: String(r.count) }]}
    />
  );
}

function DayTip({ active, payload, c }: TooltipProps<number, string> & C) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Accuracy["by_day"][number];
  return (
    <TooltipBox
      title={fmtDay(r.date)}
      rows={[
        { label: "Mean abs error", value: fmtGW(r.mae, 2), color: c.seq },
        { label: "Bias", value: fmtSignedGW(r.bias, 2) },
        { label: "Forecast energy", value: `${(r.forecast_mwh / 1000).toFixed(0)} GWh` },
        { label: "Actual energy", value: `${(r.actual_mwh / 1000).toFixed(0)} GWh` },
      ]}
    />
  );
}
