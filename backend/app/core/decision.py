"""The trader's view: what the forecast said at the day-ahead decision time.

A purchase for delivery day D is made on D-1 at a cutoff (default 09:00 UK
time, ahead of GB day-ahead auction gate closure). The only forecast that
counts is the latest WINDFOR run published at or before that cutoff.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from app.core.store import ONE_HOUR_NS, WindStore, to_ns

UK = ZoneInfo("Europe/London")


def decision_cutoff(delivery_date: date, cutoff: time) -> pd.Timestamp:
    """UTC instant of the decision for ``delivery_date`` (cutoff is UK local time on D-1)."""
    local = datetime.combine(delivery_date - timedelta(days=1), cutoff, tzinfo=UK)
    return pd.Timestamp(local).tz_convert("UTC")


def delivery_day_bounds(delivery_date: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[start, end) of a UK delivery day in UTC (handles 46/50-period clock-change days)."""
    start = pd.Timestamp(datetime.combine(delivery_date, time(0), tzinfo=UK)).tz_convert("UTC")
    nxt = delivery_date + timedelta(days=1)
    end = pd.Timestamp(datetime.combine(nxt, time(0), tzinfo=UK)).tz_convert("UTC")
    return start, end


@dataclass(frozen=True)
class DecisionForecast:
    delivery_date: date
    cutoff: pd.Timestamp
    run_time: pd.Timestamp | None  # publish time of the run used
    next_run_time: pd.Timestamp | None  # first run published after the cutoff
    targets: pd.DatetimeIndex  # half-hour start times of the delivery day (UTC)
    settlement_period: np.ndarray
    forecast: np.ndarray
    actual: np.ndarray

    @property
    def horizon_hours(self) -> np.ndarray:
        """Hours between the run's publish time and each half-hour."""
        if self.run_time is None:
            return np.full(len(self.targets), np.nan)
        return np.asarray((self.targets - self.run_time) / pd.Timedelta(hours=1), dtype=float)


def decision_forecast(store: WindStore, delivery_date: date, cutoff: time) -> DecisionForecast:
    cut = decision_cutoff(delivery_date, cutoff)
    start, end = delivery_day_bounds(delivery_date)
    idx = store.target_indices(start, end)
    i = store.run_index_at(cut)
    return DecisionForecast(
        delivery_date=delivery_date,
        cutoff=cut,
        run_time=store.run_times[i] if i >= 0 else None,
        next_run_time=store.run_times[i + 1] if i + 1 < len(store.run_times) else None,
        targets=store.targets[idx],
        settlement_period=store.settlement["settlement_period"].to_numpy()[idx],
        forecast=store.forecast_from_run(i, idx),
        actual=store.actual[idx],
    )


def decision_errors(store: WindStore, delivery_dates: list[date], cutoff: time) -> pd.DataFrame:
    """One row per (delivery day, half-hour) with forecast-at-decision and actual.

    Same rule as ``decision_forecast`` but vectorised over every day at once.
    error = forecast - actual  (positive => wind came in BELOW forecast,
    i.e. a shortfall the trader has to cover at short notice).
    """
    days = store.settlement["settlement_date"].to_numpy(dtype=str)
    uniq, inv = np.unique(days, return_inverse=True)
    none = np.iinfo(np.int64).min  # "not in scope" marker: earlier than any run
    by_day = {d.isoformat(): decision_cutoff(d, cutoff).value for d in delivery_dates}
    cutoff_ns = np.array([by_day.get(u, none) for u in uniq], dtype=np.int64)[inv]
    wanted = cutoff_ns != none
    day_of_target = np.array([date.fromisoformat(u) for u in uniq], dtype=object)[inv]

    forecast, run = store.forecast_at_cutoffs(cutoff_ns, use_older_runs=False)
    run_ns = to_ns(store.run_times)
    horizon_h = np.where(run >= 0, (to_ns(store.targets) - run_ns[np.maximum(run, 0)]) / ONE_HOUR_NS, np.nan)

    out = pd.DataFrame(
        {
            "delivery_date": day_of_target,
            "start_time": store.targets,
            "forecast": forecast,
            "actual": store.actual,
            "horizon_h": horizon_h,
        }
    )[wanted].reset_index(drop=True)
    out["error"] = out["forecast"] - out["actual"]
    return out
