// Small shared UI pieces: cards, tiles, legend, tooltip, loading/error states.
import type { ReactNode } from "react";

export function Card(props: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{props.title}</h2>
          {props.sub && <p className="sub">{props.sub}</p>}
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

export function Tile(props: { label: string; value: string; note?: ReactNode; swatch?: string; hero?: boolean }) {
  return (
    <div className={`tile${props.hero ? " hero" : ""}`}>
      <div className="t-label">
        {props.swatch && <span className="swatch" style={{ background: props.swatch }} />}
        {props.label}
      </div>
      <div className="t-value">{props.value}</div>
      {props.note && <div className="t-note">{props.note}</div>}
    </div>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  kind?: "line" | "band" | "bar";
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend" role="list">
      {items.map((it) => (
        <span key={it.label} role="listitem">
          {it.kind === "band" ? (
            <span className="key-band" style={{ background: it.color, opacity: 0.25 }} />
          ) : it.kind === "bar" ? (
            <span className="swatch" style={{ background: it.color }} />
          ) : (
            <span className="key-line" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function TooltipBox(props: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="tt">
      <div className="tt-title">{props.title}</div>
      {props.rows.map((r) => (
        <div className="tt-row" key={r.label}>
          <span>
            {r.color && <span className="swatch" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Loading({ height = 300 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-label="Loading" />;
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state error" role="alert">
      Couldn't load data — {message}
    </div>
  );
}
