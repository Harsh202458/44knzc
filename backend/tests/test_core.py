"""Unit tests for forecast selection and metrics, on small hand-made data."""

from __future__ import annotations

from datetime import date, time

import numpy as np
import pandas as pd
import pytest

from app.core import metrics
from app.core.decision import decision_cutoff, decision_errors, decision_forecast, delivery_day_bounds
from app.core.store import WindStore


def _half_hours(start: str, periods: int) -> list[str]:
    return [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in pd.date_range(start, periods=periods, freq="30min", tz="UTC")]


def make_store() -> WindStore:
    """Two delivery days (2-3 Jan 2026), actual = 1000 MW flat.

    Runs:
      R1  published 1 Jan 07:30, forecasts 2000 MW for 2-3 Jan
      R2  published 1 Jan 09:30, forecasts 1500 MW for 2-3 Jan  (after 09:00 cutoff for D=2 Jan)
      R3  published 2 Jan 07:30, forecasts 1200 MW for 3 Jan only
    """
    targets = _half_hours("2026-01-02T00:00Z", 96)
    actuals = pd.DataFrame(
        {
            "start_time": targets,
            "settlement_date": ["2026-01-02"] * 48 + ["2026-01-03"] * 48,
            "settlement_period": list(range(1, 49)) * 2,
            "generation_mw": 1000.0,
        }
    )
    hours_2_3 = pd.date_range("2026-01-02T00:00Z", "2026-01-04T00:00Z", freq="1h", tz="UTC")
    hours_3 = pd.date_range("2026-01-03T00:00Z", "2026-01-04T00:00Z", freq="1h", tz="UTC")
    rows = []
    for pub, hours, mw in [
        ("2026-01-01T07:30:00Z", hours_2_3, 2000.0),
        ("2026-01-01T09:30:00Z", hours_2_3, 1500.0),
        ("2026-01-02T07:30:00Z", hours_3, 1200.0),
    ]:
        rows += [
            {"publish_time": pub, "start_time": h.strftime("%Y-%m-%dT%H:%M:%SZ"), "generation_mw": mw} for h in hours
        ]
    # A "forecast" for a time before its own publish time must be ignored.
    rows.append({"publish_time": "2026-01-02T07:30:00Z", "start_time": "2026-01-02T00:00:00Z", "generation_mw": 9999.0})
    return WindStore.from_frames(actuals, pd.DataFrame(rows))


def test_decision_uses_latest_run_before_cutoff() -> None:
    store = make_store()
    d = decision_forecast(store, date(2026, 1, 2), time(9, 0))
    assert d.run_time == pd.Timestamp("2026-01-01T07:30Z")
    assert d.next_run_time == pd.Timestamp("2026-01-01T09:30Z")
    assert len(d.targets) == 48
    assert np.allclose(d.forecast, 2000.0)
    assert d.horizon_hours[0] == pytest.approx(16.5)


def test_later_cutoff_picks_newer_run() -> None:
    store = make_store()
    d = decision_forecast(store, date(2026, 1, 2), time(10, 0))
    assert d.run_time == pd.Timestamp("2026-01-01T09:30Z")
    assert np.allclose(d.forecast, 1500.0)


def test_run_published_exactly_at_cutoff_counts() -> None:
    store = make_store()
    d = decision_forecast(store, date(2026, 1, 2), time(9, 30))
    assert d.run_time == pd.Timestamp("2026-01-01T09:30Z")


def test_no_run_before_cutoff_gives_nan() -> None:
    store = make_store()
    d = decision_forecast(store, date(2026, 1, 2), time(6, 0))
    assert d.run_time is None
    assert np.isnan(d.forecast).all()


def test_negative_horizon_rows_are_dropped() -> None:
    store = make_store()
    # R3's bogus 9999 MW point for 2 Jan 00:00 must not appear anywhere.
    assert np.nanmax(store.values) < 9999


def test_half_hours_are_interpolated_between_hourly_points() -> None:
    targets = _half_hours("2026-01-02T00:00Z", 3)
    actuals = pd.DataFrame({"start_time": targets, "generation_mw": [0.0, 0.0, 0.0]})
    forecasts = pd.DataFrame(
        {
            "publish_time": ["2026-01-01T00:00:00Z"] * 2,
            "start_time": ["2026-01-02T00:00:00Z", "2026-01-02T01:00:00Z"],
            "generation_mw": [100.0, 200.0],
        }
    )
    store = WindStore.from_frames(actuals, forecasts)
    assert store.values[0].tolist() == [100.0, 150.0, 200.0]


def test_forecast_at_horizon_respects_minimum_lead_time() -> None:
    store = make_store()
    # Target 3 Jan 12:00; 24 h ahead => published by 2 Jan 12:00 => R3 (2 Jan 07:30)
    f, published = store.forecast_at_horizon(24)
    j = store.targets.get_loc(pd.Timestamp("2026-01-03T12:00Z"))
    assert f[j] == 1200.0
    assert published[j] == pd.Timestamp("2026-01-02T07:30Z").value
    # 36 h ahead => published by 2 Jan 00:00 => R2
    f36, _ = store.forecast_at_horizon(36)
    assert f36[j] == 1500.0


def test_decision_errors_sign_convention() -> None:
    store = make_store()
    df = decision_errors(store, [date(2026, 1, 2)], time(9))
    # forecast 2000, actual 1000 => +1000 = shortfall
    assert (df["error"] == 1000).all()


def test_uk_day_bounds_handle_clock_change() -> None:
    start, end = delivery_day_bounds(date(2026, 3, 29))  # BST starts: 23-hour day
    assert (end - start) == pd.Timedelta(hours=23)
    assert decision_cutoff(date(2026, 7, 1), time(9)) == pd.Timestamp("2026-06-30T08:00Z")


def test_summarize_metrics() -> None:
    f = np.array([110.0, 90.0, np.nan, 100.0])
    a = np.array([100.0, 100.0, 100.0, np.nan])
    s = metrics.summarize(f, a)
    assert s["n"] == 2
    assert s["mae"] == 10
    assert s["bias"] == 0
    assert s["rmse"] == 10
    assert s["max_shortfall"] == 10
    assert s["max_surplus"] == 10


def test_summarize_empty() -> None:
    assert metrics.summarize(np.array([np.nan]), np.array([1.0])) == {"n": 0}


def test_histogram_counts_everything() -> None:
    f = np.array([0.0, 600.0, -600.0, 1200.0])
    h = metrics.histogram(f, np.zeros(4), bin_mw=500)
    assert sum(b["count"] for b in h) == 4


def test_bias_correction_uses_only_past_days() -> None:
    from app.core.calibration import correction_benefit, trailing_median_correction

    days = [date(2026, 1, d) for d in range(1, 8)]
    errors = pd.DataFrame(
        {
            "delivery_date": [d for d in days for _ in range(2)],
            "forecast": 1500.0,
            "actual": 1000.0,
        }
    )
    errors["error"] = errors["forecast"] - errors["actual"]
    corrected = trailing_median_correction(errors, lag_days=2, min_days=3)
    # Days 1-4 have < 3 earlier days known by D-2 => untouched; day 5+ corrected by +500.
    assert (corrected[errors["delivery_date"] <= date(2026, 1, 4)] == 1500).all()
    assert (corrected[errors["delivery_date"] >= date(2026, 1, 5)] == 1000).all()
    assert correction_benefit(errors)["improvement"] > 0


def test_vercel_requirements_match_backend() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]

    def pins(p: Path) -> list[str]:
        return [ln.strip() for ln in p.read_text().splitlines() if ln.strip() and not ln.startswith("#")]

    assert pins(root / "requirements.txt") == pins(root / "backend" / "requirements.txt")
