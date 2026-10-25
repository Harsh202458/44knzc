// Forecast vs actual across January, for a chosen forecast lead time.
import { useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { api, type Meta, type TimeSeries } from "../api";
import { Card, ErrorState, Legend, Loading, Tile, TooltipBox } from "../components/ui";
import { axisProps, useThemeColors } from "../components/theme";
import { compactMW, downloadCsv, fmtDateTime, fmtDay, fmtGW, fmtMW, fmtPct, fmtSignedGW } from "../format";
import { useApi } from "../useApi";

export function ExplorerView({ meta }: { meta: Meta }) {
  const dates = meta.delivery_dates;
  const [horizon, setHorizon] = useState(24);
  const [committed, setCommitted] = useState(24); // fetch on release, not on every slider tick
  const [start, setStart] = useState(dates[0]);
  const [end, setEnd] = useState(dates[dates.length - 1]);
  const { data, error, loading } = useApi<TimeSeries>(api.timeseries(committed, start, end));
  const c = useThemeColors();

  const rows = useMemo(
    () =>
      (data?.points ?? []).map((p) => ({
        t: p.start_time,
        actual: p.actual,
        forecast: p.forecast,
        published: p.publish_time,
      })),
    [data],
  );
  const m = data?.metrics;
  const totalPoints = rows.length;

  return (
    <div className="stack">
      <div className="card">
        <div className="controls">
          <div className="field">
            <label htmlFor="hz">Forecast made at least … hours ahead</label>
            <div className="slider">
              <input
                id="hz"
                type="range"
                min={0}
                max={48}
                step={1}
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                onPointerUp={() => setCommitted(horizon)}
                onKeyUp={() => setCommitted(horizon)}
              />
              <output htmlFor="hz">{horizon} h</output>
            </div>
          </div>
          <div className="field">
            <label htmlFor="from">From</label>
            <select id="from" value={start} onChange={(e) => setStart(e.target.value)}>
              {dates.filter((d) => d <= end).map((d) => (
                <option key={d} value={d}>
                  {fmtDay(d)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <select id="to" value={end} onChange={(e) => setEnd(e.target.value)}>
              {dates.filter((d) => d >= start).map((d) => (
                <option key={d} value={d}>
                  {fmtDay(d)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <ErrorState message={error} />}
      {!data && loading && <Loading height={420} />}

      {data && m && (
        <>
          <div className="tiles">
            <Tile label="Mean absolute error" value={fmtGW(m.mae, 2)} note={`${fmtPct(m.nmae)} of average wind output`} />
            <Tile label="Bias (forecast − actual)" value={fmtSignedGW(m.bias, 2)} note={m.bias && m.bias > 0 ? "forecast runs high" : "forecast runs low"} />
            <Tile label="RMSE" value={fmtGW(m.rmse, 2)} note="penalises big misses" />
            <Tile label="90% of errors within" value={fmtGW(m.p90_abs_error, 2)} note={`${fmtPct(m.within_1gw)} of half-hours within 1 GW`} />
          </div>

          <Card
            title={`Actual vs forecast made ≥ ${data.horizon_h} h ahead`}
            sub={
              <>
                For each half-hour, the newest forecast published at least {data.horizon_h} h before it.
                {m.n < totalPoints && ` ${totalPoints - m.n} half-hours had no forecast that far ahead.`} Drag the
                handles under the chart to zoom.
              </>
            }
            actions={
              <button className="link-btn" onClick={() => downloadCsv(`wind-h${data.horizon_h}-${start}-${end}.csv`, rows)}>
                Download CSV
              </button>
            }
          >
            <Legend
              items={[
                { label: "Actual", color: c.actual },
                { label: `Forecast (≥ ${data.horizon_h} h ahead)`, color: c.forecast },
              ]}
            />
            <div style={{ height: 420, marginTop: 8, opacity: loading ? 0.5 : 1 }}>
              <ResponsiveContainer>
                <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis
                    dataKey="t"
                    {...axisProps(c)}
                    tickFormatter={(t: string) => fmtDay(t.slice(0, 10))}
                    minTickGap={40}
                  />
                  <YAxis {...axisProps(c)} axisLine={false} tickFormatter={compactMW} width={44} />
                  <Tooltip content={<SeriesTooltip c={c} />} cursor={{ stroke: c.axis }} />
                  <Line dataKey="actual" stroke={c.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="forecast" stroke={c.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Brush
                    dataKey="t"
                    height={26}
                    stroke={c.axis}
                    fill={c.surface}
                    travellerWidth={8}
                    tickFormatter={(t: string) => fmtDay(t.slice(0, 10))}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SeriesTooltip({ active, payload, c }: TooltipProps<number, string> & { c: ReturnType<typeof useThemeColors> }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as { t: string; actual: number | null; forecast: number | null; published: string | null };
  const err = r.forecast !== null && r.actual !== null ? r.forecast - r.actual : null;
  return (
    <TooltipBox
      title={fmtDateTime(r.t)}
      rows={[
        { label: "Actual", value: fmtMW(r.actual), color: c.actual },
        { label: "Forecast", value: fmtMW(r.forecast), color: c.forecast },
        { label: "Error", value: err === null ? "–" : fmtSignedGW(err, 2) },
        { label: "Published", value: r.published ? fmtDateTime(r.published) : "–" },
      ]}
    />
  );
}
