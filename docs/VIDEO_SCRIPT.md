# Video script (≤ 10 min total)

Recording tips: 1080p, browser at 100–110% zoom, dark theme, close other tabs. Keep the app open on
**Day-ahead decision → Thu 15 Jan, cutoff 09:00** before you start. Speak to the outcome first and
the mechanics second.

---

## Part 1 — Client pitch (≤ 5 min)

**0:00 – 0:30 · The problem** *(on the Day-ahead decision screen)*
> "Every morning your team decides how much power to buy for tomorrow. Wind covers a big, changing
> share of demand, so the real question is: *how much wind can we count on?* That decision is made
> on a forecast, and today you can't easily see how good that forecast is. This pilot answers both."

**0:30 – 1:45 · What the forecast said when you had to decide**
- Point at the info line: "At 09:00 on the 14th, the latest forecast was the 07:30 run, looking
  17–40 hours ahead. The next one lands at 09:30, just after your cutoff."
- Tiles: raw forecast 277 GWh, **expected 238 GWh**, low-wind case (P10) 177 GWh.
- Chart: orange = raw forecast, green = expected, shaded band = where outturn landed 80% of the time.
- Tick "show what actually happened". The blue actual line sits on the green line, well below orange.
- "You can step day by day, change the cutoff, see the table, or download it as CSV."

**1:45 – 3:30 · Can you trust it? (Forecast accuracy tab)** *(read the Key findings)*
- "On average the forecast you buy against is **2 GW off**, about 18% of wind output."
- "More important: it's **too high 85% of the time**, by 1.7 GW on average, and by almost 3 GW on
  windy days. Planning on the raw number means routinely under-buying."
- "Correcting that bias, using only data you already had, **cuts the error by 27%**."
- Cutoff chart: "Waiting for a later forecast barely helps. 11:30 gains only 7%. The lever is the
  correction, not the timing."
- Bias by hour: "It's worst overnight."
- Day-by-day bars: "These were the days you'd have been caught short: 28, 11 and 12 January."

**3:30 – 4:15 · Forecast vs actual tab**
- Drag the lead-time slider from 0 h to 48 h: "You can see how quality drops with lead time."
- Point at the peaks: "When the forecast says 20 GW, outturn tops out around 17–18 GW. That's
  most likely wind being curtailed, and worth confirming together."

**4:15 – 5:00 · Close**
> "In one screen, your traders see what to plan on, with a range, and the evidence behind it. Next
> we'd add demand and solar to show the residual volume to buy, refresh the data automatically, and
> alert you on high-wind days, when the forecast is most likely too high."

---

## Part 2 — Tech lead walkthrough (≤ 5 min)

**0:00 – 0:40 · Architecture** *(README → Architecture diagram)*
- React + TS (Vite, Recharts) → FastAPI → `service.py` → pure `core/` domain package → CSV snapshot
  downloaded from Elexon by `scripts/fetch_snapshot.py`.
- Why a snapshot: the data is historical, so this is fast, reproducible and serverless-friendly.
  Refreshing it is one command.

**0:40 – 2:00 · The core rule** *(open `backend/app/core/store.py`, then `decision.py`)*
- Data shapes: half-hourly actuals vs hourly forecasts, about 8 runs a day, each about 66 h ahead.
- `WindStore.from_frames`: drop rows with start < publish, de-duplicate, interpolate each run onto
  the half-hour grid → a `runs × half-hours` matrix.
- `forecast_at_cutoffs`: one `searchsorted` gives the newest run published ≤ cutoff. `last_covering`
  handles "fall back to an older run" for the lead-time view. Fully vectorised: the cutoff curve
  went from 13 s to 0.45 s.
- `decision.py`: cutoff = D-1 at 09:00 *Europe/London*, so delivery days are UK days (46/50-period
  clock-change days are handled).

**2:00 – 2:50 · Analysis choices** *(`metrics.py`, `calibration.py`, `service.decision`)*
- Sign convention: error = forecast − actual (positive = shortfall).
- Band: leave-one-day-out error quantiles (pilot). Bias-correction metric: trailing days ≤ D-2
  only, with no look-ahead. Production should use the trailing method for the band too.
- `analysis/findings.py` regenerates every number in FINDINGS.md and the pitch.

**2:50 – 3:40 · API and frontend**
- `/api/docs` (OpenAPI from the Pydantic schemas). Show `/api/decision`.
- Frontend: `api.ts` types mirror `schemas.py`; `useApi` caches and de-duplicates requests; views
  are split by screen; theme tokens with a CVD-validated palette; state lives in the URL hash so
  views can be shared.

**3:40 – 4:30 · Quality**
- `pytest` (hand-made edge cases + real-data API tests), `ruff`, `mypy`, ESLint, `tsc`, vitest.
- GitHub Actions: backend, frontend, then a Docker build + smoke test.
- `docker compose up --build` → :8080. Vercel: static frontend + `api/index.py` serverless function.

**4:30 – 5:00 · Trade-offs and next steps**
- Interpolating hourly forecasts to half-hours; one month of data; the band method.
- Next: rolling, lead-time-specific calibration; demand and solar; scheduled refresh; alerting.
