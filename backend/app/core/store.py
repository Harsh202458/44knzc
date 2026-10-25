"""In-memory data model for wind actuals and forecast runs.

Shape of the data (see README "Data notes"):
* Actuals (FUELHH): one value per half-hour, ``start_time`` in UTC.
* Forecasts (WINDFOR): ~8 runs a day, each an hourly curve ~3 days ahead.

To compare the two we put every forecast run on the same half-hour grid as
the actuals, linearly interpolating between a run's hourly points (exact on
the hour, midpoint on the half-hour). The result is a dense matrix:

    values[run_index, target_index]  -> MW forecast by that run, or NaN

which turns "latest run published before time X" into a binary search, and
lets every selection below run as vectorised numpy (no per-row Python loops).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

ONE_HOUR_NS = pd.Timedelta(hours=1).value


def to_ns(index: pd.DatetimeIndex | pd.Series) -> np.ndarray:
    """UTC nanoseconds since epoch as int64 (tz-aware input)."""
    return pd.DatetimeIndex(index).tz_convert("UTC").tz_localize(None).to_numpy("datetime64[ns]").astype(np.int64)


@dataclass(frozen=True)
class WindStore:
    targets: pd.DatetimeIndex  # half-hour start times (UTC), sorted
    actual: np.ndarray  # MW, shape (n_targets,)
    run_times: pd.DatetimeIndex  # forecast publish times (UTC), sorted
    values: np.ndarray  # MW, shape (n_runs, n_targets), NaN = not covered
    settlement: pd.DataFrame = field(repr=False)  # settlement_date / period per target
    # last_covering[i, j] = newest run index <= i that has a value for target j (-1 if none)
    last_covering: np.ndarray = field(repr=False, default_factory=lambda: np.empty((0, 0), int))

    # ---- construction -------------------------------------------------

    @classmethod
    def from_frames(cls, actuals: pd.DataFrame, forecasts: pd.DataFrame) -> WindStore:
        """Build from raw frames.

        actuals:   start_time, generation_mw [, settlement_date, settlement_period]
        forecasts: publish_time, start_time, generation_mw
        """
        a = actuals.copy()
        a["start_time"] = pd.to_datetime(a["start_time"], utc=True)
        a = a.drop_duplicates("start_time", keep="last").sort_values("start_time")
        targets = pd.DatetimeIndex(a["start_time"])
        if "settlement_date" not in a:
            a["settlement_date"] = [str(d) for d in targets.tz_convert("Europe/London").date]
        if "settlement_period" not in a:
            a["settlement_period"] = 0
        settlement = a[["settlement_date", "settlement_period"]].reset_index(drop=True)

        f = forecasts.copy()
        f["publish_time"] = pd.to_datetime(f["publish_time"], utc=True)
        f["start_time"] = pd.to_datetime(f["start_time"], utc=True)
        # Rows whose target is before their publish time are not forecasts.
        f = f[f["start_time"] >= f["publish_time"]]
        f = f.drop_duplicates(["publish_time", "start_time"], keep="last")

        run_times = pd.DatetimeIndex(sorted(f["publish_time"].unique()))
        x_targets = to_ns(targets).astype(np.float64)
        values = np.full((len(run_times), len(targets)), np.nan)
        for i, (_, run) in enumerate(f.groupby("publish_time", sort=True)):
            run = run.sort_values("start_time")
            xs = to_ns(run["start_time"]).astype(np.float64)
            ys = run["generation_mw"].to_numpy(dtype=np.float64)
            # Interpolate only inside the run's span; never extrapolate.
            values[i] = np.interp(x_targets, xs, ys, left=np.nan, right=np.nan)
            # Don't bridge gaps: a half-hour needs a run point within 1 hour.
            values[i, _distance_to_nearest(xs, x_targets) > ONE_HOUR_NS] = np.nan

        # Forward-fill "which run last covered this target" down the run axis.
        rows = np.arange(len(run_times))[:, None]
        last_covering = np.maximum.accumulate(np.where(np.isnan(values), -1, rows), axis=0)

        return cls(
            targets=targets,
            actual=a["generation_mw"].to_numpy(dtype=np.float64),
            run_times=run_times,
            values=values,
            settlement=settlement,
            last_covering=last_covering,
        )

    @classmethod
    def from_csv_dir(cls, data_dir: Path) -> WindStore:
        actuals = pd.read_csv(data_dir / "actuals.csv")
        forecasts = pd.read_csv(data_dir / "forecasts.csv")
        return cls.from_frames(actuals, forecasts)

    # ---- forecast selection ------------------------------------------

    def run_index_at(self, cutoff: pd.Timestamp) -> int:
        """Index of the latest run published at or before ``cutoff`` (-1 if none)."""
        return int(self.run_times.searchsorted(cutoff, side="right")) - 1

    def forecast_from_run(self, run_index: int, target_idx: np.ndarray) -> np.ndarray:
        if run_index < 0:
            return np.full(len(target_idx), np.nan)
        return self.values[run_index, target_idx]

    def forecast_at_cutoffs(self, cutoff_ns: np.ndarray, *, use_older_runs: bool) -> tuple[np.ndarray, np.ndarray]:
        """Forecast for every target as known at its own cutoff instant.

        cutoff_ns: int64 array, one cutoff per target.
        use_older_runs: if the newest run before the cutoff doesn't cover the
            target, fall back to the newest older run that does.
        Returns (forecast_mw, run_index) with NaN / -1 where nothing is available.
        """
        cols = np.arange(len(self.targets))
        newest = np.searchsorted(to_ns(self.run_times), cutoff_ns, side="right") - 1
        has_run = newest >= 0
        run = np.full(len(cols), -1)
        if use_older_runs:
            run[has_run] = self.last_covering[newest[has_run], cols[has_run]]
        else:
            covered = has_run.copy()
            covered[has_run] = ~np.isnan(self.values[newest[has_run], cols[has_run]])
            run[covered] = newest[covered]
        forecast = np.full(len(cols), np.nan)
        ok = run >= 0
        forecast[ok] = self.values[run[ok], cols[ok]]
        return forecast, run

    def forecast_at_horizon(self, hours: float) -> tuple[np.ndarray, np.ndarray]:
        """For every target t, the latest forecast published at least ``hours`` before t.

        This is the "how good is a forecast made N hours ahead?" view.
        Returns (forecast_mw, publish_time_ns) with NaN / -1 where none exists.
        """
        cutoffs = to_ns(self.targets) - int(hours * ONE_HOUR_NS)
        forecast, run = self.forecast_at_cutoffs(cutoffs, use_older_runs=True)
        run_ns = to_ns(self.run_times)
        published = np.where(run >= 0, run_ns[np.maximum(run, 0)], -1)
        return forecast, published

    def target_indices(self, start: pd.Timestamp, end: pd.Timestamp) -> np.ndarray:
        """Indices of targets with start <= t < end."""
        lo = self.targets.searchsorted(start, side="left")
        hi = self.targets.searchsorted(end, side="left")
        return np.arange(lo, hi)


def _distance_to_nearest(xs: np.ndarray, x: np.ndarray) -> np.ndarray:
    """Distance from each value in ``x`` to the nearest point in sorted ``xs``."""
    if len(xs) == 1:
        return np.abs(x - xs[0])
    pos = np.clip(np.searchsorted(xs, x), 1, len(xs) - 1)
    return np.minimum(np.abs(x - xs[pos - 1]), np.abs(xs[pos] - x))
