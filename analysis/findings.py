"""Reproduce the numbers quoted in analysis/FINDINGS.md.

Run from the repo root:
    backend/.venv/Scripts/python analysis/findings.py      (Windows)
    backend/.venv/bin/python analysis/findings.py          (macOS/Linux)
"""

from __future__ import annotations

import sys
from datetime import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import load_settings  # noqa: E402
from app.core.calibration import correction_benefit  # noqa: E402
from app.core.metrics import summarize  # noqa: E402
from app.service import WindService  # noqa: E402


def gw(x: float) -> str:
    return f"{x / 1000:.2f} GW"


def main() -> None:
    svc = WindService(load_settings())
    store = svc.store
    days = svc.delivery_dates
    print(f"Scope: {len(days)} delivery days {days[0]} .. {days[-1]}, {len(store.run_times)} forecast runs\n")

    # 1. Decision-time accuracy
    e = svc.decision_errors(time(9))
    s = summarize(e["forecast"].to_numpy(), e["actual"].to_numpy())
    print("1. Forecast available at 09:00 D-1 (the 07:30 run)")
    print(f"   MAE {gw(s['mae'])} ({s['nmae']:.0%} of mean wind {gw(s['mean_actual'])}), RMSE {gw(s['rmse'])}")
    print(f"   bias {gw(s['bias'])}, forecast too high in {s['share_shortfall']:.0%} of half-hours")
    print(f"   90% of abs errors <= {gw(s['p90_abs_error'])}; worst shortfall {gw(s['max_shortfall'])}")
    print(f"   lead times {e['horizon_h'].min():.1f}-{e['horizon_h'].max():.1f} h\n")

    # 2. Bias correction (no look-ahead)
    b = correction_benefit(e)
    print("2. Bias correction (median past error, days <= D-2 only)")
    print(f"   MAE {gw(b['raw_mae'])} -> {gw(b['corrected_mae'])}  ({b['improvement']:.0%} better)\n")

    # 3. Error vs forecast level
    e = e.assign(level=pd.cut(e["forecast"], [0, 8000, 12000, 16000, 30000], labels=["<8", "8-12", "12-16", ">16"]))
    print("3. Bias by forecast level (GW)")
    for lvl, g in e.groupby("level", observed=True):
        bias, mae = gw(g["error"].mean()), gw(g["error"].abs().mean())
        print(f"   forecast {lvl:>5} GW: n={len(g):4d}  bias {bias}  MAE {mae}")
    top_actual, top_forecast = gw(np.nanmax(store.actual)), gw(e["forecast"].max())
    print(f"   highest actual in January: {top_actual}; highest decision forecast: {top_forecast}\n")

    # 4. Lead time
    print("4. MAE by minimum lead time")
    for row in svc.horizon_curve:
        if row["horizon_h"] in (0, 6, 12, 24, 36, 48):
            print(f"   >= {row['horizon_h']:>4.0f} h: MAE {gw(row['mae'])}  coverage {row['coverage']:.0%}")
    print()

    # 5. Cutoff timing
    print("5. Decision cutoff vs MAE")
    for row in svc.cutoff_curve:
        if row["cutoff"] in ("06:00", "08:00", "09:00", "09:30", "10:00", "11:30", "12:00"):
            print(f"   {row['cutoff']}: uses {row['run_hhmm']} run, MAE {gw(row['mae'])}")
    print()

    # 6. Time of day and worst days
    acc = svc.accuracy_decision(time(9))
    hours = pd.DataFrame(acc["by_hour"]).set_index("hour")
    print(f"6. Bias 00-07h {gw(hours.loc[0:6, 'bias'].mean())} vs 10-18h {gw(hours.loc[10:17, 'bias'].mean())}")
    worst = sorted(acc["by_day"], key=lambda d: -d["mae"])[:5]
    print("   worst days: " + ", ".join(f"{d['date']} ({gw(d['mae'])})" for d in worst))


if __name__ == "__main__":
    main()
