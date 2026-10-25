import { useEffect, useState } from "react";
import { api, type Meta } from "./api";
import { ErrorState, Loading } from "./components/ui";
import { fmtDateTime } from "./format";
import { useApi } from "./useApi";
import { AccuracyView } from "./views/AccuracyView";
import { DecisionView } from "./views/DecisionView";
import { ExplorerView } from "./views/ExplorerView";

const TABS = [
  { id: "decision", label: "Day-ahead decision" },
  { id: "explorer", label: "Forecast vs actual" },
  { id: "accuracy", label: "Forecast accuracy" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Tab + selections live in the URL hash so any view can be bookmarked or shared. */
function readHash(): { tab: TabId; date?: string; cutoff?: string } {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const tab = (TABS.find((t) => t.id === p.get("tab"))?.id ?? "decision") as TabId;
  return { tab, date: p.get("date") ?? undefined, cutoff: p.get("cutoff") ?? undefined };
}

export default function App() {
  const meta = useApi<Meta>(api.meta());
  const initial = readHash();
  const [tab, setTab] = useState<TabId>(initial.tab);
  const [date, setDate] = useState<string | undefined>(initial.date);
  const [cutoff, setCutoff] = useState<string | undefined>(initial.cutoff);
  const [theme, setTheme] = useState<"light" | "dark" | null>(() => {
    try {
      return (localStorage.getItem("theme") as "light" | "dark" | null) ?? null;
    } catch {
      return null;
    }
  });

  const m = meta.data;
  const effDate = date && m?.delivery_dates.includes(date) ? date : (m?.delivery_dates[13] ?? m?.delivery_dates[0]);
  const effCutoff = cutoff ?? m?.default_cutoff ?? "09:00";

  // Follow links / back-forward that change the hash.
  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setTab(h.tab);
      if (h.date) setDate(h.date);
      if (h.cutoff) setCutoff(h.cutoff);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const p = new URLSearchParams({ tab, ...(effDate ? { date: effDate } : {}), cutoff: effCutoff });
    window.history.replaceState(null, "", `#${p.toString()}`);
  }, [tab, effDate, effCutoff]);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem("theme", theme);
      else localStorage.removeItem("theme");
    } catch {
      /* storage unavailable – theme just won't persist */
    }
  }, [theme]);

  const isDark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="logo" aria-hidden>
            <WindIcon />
          </div>
          <div>
            <h1>Wind Forecast Monitor</h1>
            <p>GB national wind · day-ahead purchasing · January 2026</p>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <button
          className="icon-btn"
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? "☀" : "☾"}
        </button>
      </header>

      <main>
        {meta.error && <ErrorState message={meta.error} />}
        {!m && !meta.error && <Loading height={480} />}
        {m && effDate && (
          <>
            {tab === "decision" && (
              <DecisionView meta={m} date={effDate} cutoff={effCutoff} onDate={setDate} onCutoff={setCutoff} />
            )}
            {tab === "explorer" && <ExplorerView meta={m} />}
            {tab === "accuracy" && <AccuracyView meta={m} cutoff={effCutoff} />}
          </>
        )}
      </main>

      <footer className="footer">
        <span>
          Data: Elexon BMRS — actuals FUELHH (fuel type WIND), forecasts WINDFOR. All times UK local.
        </span>
        {m && (
          <span>
            {m.n_runs} forecast runs · snapshot {fmtDateTime(m.fetched_at)} ·{" "}
            <a href="/api/docs" style={{ color: "inherit" }}>
              API docs
            </a>
          </span>
        )}
      </footer>
    </div>
  );
}

function WindIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 8h11a3 3 0 1 0-3-3" />
      <path d="M3 12h16a3 3 0 1 1-3 3" />
      <path d="M3 16h7" />
    </svg>
  );
}
