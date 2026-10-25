"""Download the January 2026 wind data from Elexon and save it as CSV.

Run from the backend folder:  python -m scripts.fetch_snapshot

Scope: purchase decisions made in January 2026 => delivery days 2 Jan - 1 Feb.
We also keep 1 Jan actuals and forecasts published from 29 Dec so that
"forecast made N hours ahead" analysis (up to 48 h) works from the first day.
"""

from __future__ import annotations

import csv
import json
from datetime import UTC, date, datetime
from pathlib import Path

from app.elexon import BASE_URL, fetch_wind_actuals, fetch_wind_forecasts

OUT_DIR = Path(__file__).resolve().parents[1] / "data"

ACTUALS_FROM = date(2026, 1, 1)
ACTUALS_TO = date(2026, 2, 1)
FORECASTS_PUBLISHED_FROM = datetime(2025, 12, 29, tzinfo=UTC)
FORECASTS_PUBLISHED_TO = datetime(2026, 2, 2, tzinfo=UTC)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    actuals = fetch_wind_actuals(ACTUALS_FROM, ACTUALS_TO)
    actuals.sort(key=lambda r: r["startTime"])
    with open(OUT_DIR / "actuals.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["start_time", "settlement_date", "settlement_period", "generation_mw"])
        for r in actuals:
            w.writerow([r["startTime"], r["settlementDate"], r["settlementPeriod"], r["generation"]])

    forecasts = fetch_wind_forecasts(FORECASTS_PUBLISHED_FROM, FORECASTS_PUBLISHED_TO)
    forecasts.sort(key=lambda r: (r["publishTime"], r["startTime"]))
    with open(OUT_DIR / "forecasts.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["publish_time", "start_time", "generation_mw"])
        for r in forecasts:
            w.writerow([r["publishTime"], r["startTime"], r["generation"]])

    meta = {
        "fetched_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": BASE_URL,
        "datasets": {
            "actuals": "FUELHH (fuelType=WIND)",
            "forecasts": "WINDFOR",
        },
        "actuals_settlement_dates": [ACTUALS_FROM.isoformat(), ACTUALS_TO.isoformat()],
        "forecasts_published": [
            FORECASTS_PUBLISHED_FROM.isoformat(),
            FORECASTS_PUBLISHED_TO.isoformat(),
        ],
        "rows": {"actuals": len(actuals), "forecasts": len(forecasts)},
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta["rows"]))


if __name__ == "__main__":
    main()
