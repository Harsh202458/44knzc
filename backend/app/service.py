"""Use-case layer: turns the core calculations into API payloads.

Routes in main.py stay thin; everything here is plain Python and easy to test.
Results are cached because the data is a fixed historical snapshot.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import date, time, timedelta
from functools import cached_property, lru_cache
from typing import Any

import numpy as np
import pandas as pd

from app.config import Settings
from app.core import metrics as m
from app.core.calibration import correction_benefit
from app.core.decision import decision_errors, decision_forecast, delivery_day_bounds
from app.core.store import WindStore

HORIZONS = [float(h) for h in range(0, 49)]


def _iso(ts: pd.Timestamp | None) -> str | None:
    return None if ts is None else ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(x: float) -> float | None:
    return None if x is None or np.isnan(x) else round(float(x), 1)


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in d.items()}


class WindService:
    def __init__(self, settings: Settings, store: WindStore | None = None) -> None:
        self.settings = settings
        self.store = store or WindStore.from_csv_dir(settings.data_dir)
        meta_path = settings.data_dir / "meta.json"
        self._meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        # Per-instance caches (lru_cache on methods would pin self globally).
        self.decision_errors = lru_cache(maxsize=64)(self._decision_errors)
        self.horizon_series = lru_cache(maxsize=64)(self._horizon_series)

    # ---- reference data ---------------------------------------------

    @cached_property
    def delivery_dates(self) -> list[date]:
        """Delivery days for in-scope decisions that have actuals in the snapshot."""
        s = self.settings
        days = []
        d = s.delivery_from
        have = set(self.store.settlement["settlement_date"].astype(str))
        while d <= s.delivery_to:
            if d.isoformat() in have:
                days.append(d)
            d += timedelta(days=1)
        return days

    def meta(self) -> dict[str, Any]:
        schedule = Counter(t.strftime("%H:%M") for t in self.store.run_times)
        return {
            "fetched_at": self._meta.get("fetched_at", "unknown"),
            "source": self._meta.get("source", "Elexon BMRS"),
            "default_cutoff": self.settings.default_cutoff.strftime("%H:%M"),
            "delivery_dates": [d.isoformat() for d in self.delivery_dates],
            "data_from": _iso(self.store.targets[0]) or "",
            "data_to": _iso(self.store.targets[-1]) or "",
            "n_runs": len(self.store.run_times),
            "run_schedule_utc": dict(sorted((k, v) for k, v in schedule.items() if v > 2)),
        }

    # ---- decision view ----------------------------------------------

    def _decision_errors(self, cutoff: time) -> pd.DataFrame:
        return decision_errors(self.store, self.delivery_dates, cutoff)

    def decision(self, delivery_date: date, cutoff: time) -> dict[str, Any]:
        df = decision_forecast(self.store, delivery_date, cutoff)

        # Uncertainty band: errors of the decision-time forecast on all OTHER
        # in-scope days (leave-one-day-out, so a day never calibrates itself).
        hist = self.decision_errors(cutoff)
        others = hist.loc[hist["delivery_date"] != delivery_date, "error"].dropna().to_numpy()
        band = None
        expected = p10 = p90 = np.full(len(df.forecast), np.nan)
        if len(others) >= 48:
            q = m.error_quantiles(others)
            band = {
                "method": "leave-one-day-out error quantiles, same cutoff",
                "n_samples": int(len(others)),
                "error_q10": q["q10"],
                "error_q50": q["q50"],
                "error_q90": q["q90"],
            }
            # actual = forecast - error  =>  low case uses the high error quantile
            expected = np.clip(df.forecast - q["q50"], 0, None)
            p10 = np.clip(df.forecast - q["q90"], 0, None)
            p90 = np.clip(df.forecast - q["q10"], 0, None)

        horizons = df.horizon_hours
        periods = [
            {
                "start_time": _iso(t),
                "settlement_period": int(sp),
                "forecast": _num(f),
                "expected": _num(ex),
                "p10": _num(lo),
                "p90": _num(hi),
                "actual": _num(a),
                "horizon_h": _num(h),
            }
            for t, sp, f, ex, lo, hi, a, h in zip(
                df.targets, df.settlement_period, df.forecast, expected, p10, p90, df.actual, horizons, strict=True
            )
        ]

        def mwh(x: np.ndarray) -> float:
            return round(float(np.nansum(x) * 0.5), 1)

        has_actual = bool(np.isfinite(df.actual).any())
        return {
            "delivery_date": delivery_date.isoformat(),
            "cutoff_utc": _iso(df.cutoff),
            "run_publish_time": _iso(df.run_time),
            "next_run_publish_time": _iso(df.next_run_time),
            "band": band,
            "summary": {
                "forecast_mwh": mwh(df.forecast),
                "expected_mwh": mwh(expected),
                "p10_mwh": mwh(p10),
                "actual_mwh": mwh(df.actual) if has_actual else None,
                "peak_forecast_mw": _num(np.nanmax(df.forecast)) if np.isfinite(df.forecast).any() else None,
                "min_forecast_mw": _num(np.nanmin(df.forecast)) if np.isfinite(df.forecast).any() else None,
                "metrics": _clean(m.summarize(df.forecast, df.actual)),
            },
            "periods": periods,
        }

    # ---- fixed-horizon view -------------------------------------------

    def _horizon_series(self, horizon_h: float) -> tuple[np.ndarray, np.ndarray]:
        return self.store.forecast_at_horizon(horizon_h)

    def _window(self, start: date | None, end: date | None) -> np.ndarray:
        """Target indices for UK days start..end inclusive (defaults: delivery range)."""
        s = start or self.delivery_dates[0]
        e = end or self.delivery_dates[-1]
        lo, _ = delivery_day_bounds(s)
        _, hi = delivery_day_bounds(e)
        return self.store.target_indices(lo, hi)

    def timeseries(self, horizon_h: float, start: date | None, end: date | None) -> dict[str, Any]:
        idx = self._window(start, end)
        forecast, published = self.horizon_series(horizon_h)
        f, p, a, t = forecast[idx], published[idx], self.store.actual[idx], self.store.targets[idx]
        points = [
            {
                "start_time": _iso(ti),
                "actual": _num(ai),
                "forecast": _num(fi),
                "publish_time": _iso(pd.Timestamp(pi, tz="UTC")) if pi >= 0 else None,
            }
            for ti, ai, fi, pi in zip(t, a, f, p, strict=True)
        ]
        return {"horizon_h": horizon_h, "points": points, "metrics": _clean(m.summarize(f, a))}

    # ---- accuracy ---------------------------------------------------

    def accuracy_decision(self, cutoff: time) -> dict[str, Any]:
        df = self.decision_errors(cutoff)
        times = pd.DatetimeIndex(df["start_time"])
        f, a = df["forecast"].to_numpy(), df["actual"].to_numpy()
        payload = self._accuracy_payload(
            "decision", f"Forecast available at {cutoff.strftime('%H:%M')} UK on D-1", times, f, a
        )
        payload["bias_correction"] = correction_benefit(df)
        return payload

    def accuracy_horizon(self, horizon_h: float, start: date | None, end: date | None) -> dict[str, Any]:
        idx = self._window(start, end)
        forecast, _ = self.horizon_series(horizon_h)
        return self._accuracy_payload(
            "horizon",
            f"Latest forecast published at least {horizon_h:g} h ahead",
            self.store.targets[idx],
            forecast[idx],
            self.store.actual[idx],
        )

    @staticmethod
    def _accuracy_payload(
        mode: str, label: str, times: pd.DatetimeIndex, f: np.ndarray, a: np.ndarray
    ) -> dict[str, Any]:
        return {
            "mode": mode,
            "label": label,
            "metrics": _clean(m.summarize(f, a)),
            "by_hour": m.by_hour_of_day(times, f, a),
            "by_day": m.by_day(times, f, a),
            "histogram": m.histogram(f, a),
        }

    @cached_property
    def horizon_curve(self) -> list[dict[str, Any]]:
        idx = self._window(None, None)
        a = self.store.actual[idx]
        rows = []
        for h in HORIZONS:
            f = self.horizon_series(h)[0][idx]
            s = m.summarize(f, a)
            rows.append(
                {
                    "horizon_h": h,
                    "mae": _num(s.get("mae", np.nan)),
                    "rmse": _num(s.get("rmse", np.nan)),
                    "bias": _num(s.get("bias", np.nan)),
                    "p90_abs_error": _num(s.get("p90_abs_error", np.nan)),
                    "coverage": round(s["n"] / len(idx), 4) if len(idx) else 0.0,
                }
            )
        return rows

    @cached_property
    def cutoff_curve(self) -> list[dict[str, Any]]:
        """How decision-time accuracy changes if the cutoff moves (every 30 min on D-1)."""
        rows = []
        for minutes in range(0, 24 * 60, 30):
            c = time(minutes // 60, minutes % 60)
            df = self.decision_errors(c)
            s = m.summarize(df["forecast"].to_numpy(), df["actual"].to_numpy())
            sample = decision_forecast(self.store, self.delivery_dates[0], c)
            rows.append(
                {
                    "cutoff": c.strftime("%H:%M"),
                    "run_hhmm": sample.run_time.strftime("%H:%M") if sample.run_time is not None else None,
                    "mae": _num(s.get("mae", np.nan)),
                    "bias": _num(s.get("bias", np.nan)),
                    "mean_horizon_h": _num(float(df["horizon_h"].mean())),
                }
            )
        return rows
