"""Forecast accuracy metrics.

Sign convention everywhere: error = forecast - actual (MW).
  error > 0  -> less wind than forecast (shortfall: buy more, at short notice)
  error < 0  -> more wind than forecast (surplus: bought too much)
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _pairs(forecast: np.ndarray, actual: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    f = np.asarray(forecast, dtype=float)
    a = np.asarray(actual, dtype=float)
    ok = ~(np.isnan(f) | np.isnan(a))
    return f[ok], a[ok]


def summarize(forecast: np.ndarray, actual: np.ndarray) -> dict[str, Any]:
    """Headline accuracy numbers for paired forecast/actual series."""
    f, a = _pairs(forecast, actual)
    if len(f) == 0:
        return {"n": 0}
    e = f - a
    ae = np.abs(e)
    mean_actual = float(a.mean())
    return {
        "n": int(len(e)),
        "mae": float(ae.mean()),
        "rmse": float(np.sqrt((e**2).mean())),
        "bias": float(e.mean()),
        "nmae": float(ae.mean() / mean_actual) if mean_actual else None,
        "p50_abs_error": float(np.percentile(ae, 50)),
        "p90_abs_error": float(np.percentile(ae, 90)),
        "error_p10": float(np.percentile(e, 10)),
        "error_p90": float(np.percentile(e, 90)),
        "max_shortfall": float(e.max()),  # forecast above actual
        "max_surplus": float(-e.min()),  # actual above forecast
        "mean_actual": mean_actual,
        "within_1gw": float((ae <= 1000).mean()),
        "share_shortfall": float((e > 0).mean()),  # share of half-hours forecast too high
    }


def by_hour_of_day(times: pd.DatetimeIndex, forecast: np.ndarray, actual: np.ndarray) -> list[dict[str, Any]]:
    """MAE and bias grouped by UK local hour of day."""
    df = pd.DataFrame(
        {"hour": times.tz_convert("Europe/London").hour, "e": np.asarray(forecast) - np.asarray(actual)}
    ).dropna()
    g = df.groupby("hour")["e"]
    out = pd.DataFrame({"mae": g.apply(lambda s: s.abs().mean()), "bias": g.mean(), "n": g.size()})
    return [
        {"hour": int(r["hour"]), "mae": float(r["mae"]), "bias": float(r["bias"]), "n": int(r["n"])}
        for r in out.reset_index().to_dict("records")
    ]


def by_day(times: pd.DatetimeIndex, forecast: np.ndarray, actual: np.ndarray) -> list[dict[str, Any]]:
    """Daily MAE, bias and energy totals (UK local date)."""
    df = pd.DataFrame(
        {
            "day": times.tz_convert("Europe/London").date,
            "f": np.asarray(forecast, dtype=float),
            "a": np.asarray(actual, dtype=float),
        }
    ).dropna()
    df["e"] = df["f"] - df["a"]
    rows = []
    for day, g in df.groupby("day"):
        rows.append(
            {
                "date": str(day),
                "mae": float(g["e"].abs().mean()),
                "bias": float(g["e"].mean()),
                "forecast_mwh": float(g["f"].sum() * 0.5),
                "actual_mwh": float(g["a"].sum() * 0.5),
                "n": int(len(g)),
            }
        )
    return rows


def histogram(forecast: np.ndarray, actual: np.ndarray, bin_mw: int = 500) -> list[dict[str, Any]]:
    """Counts of errors in fixed-width MW bins (bin labelled by its lower edge)."""
    f, a = _pairs(forecast, actual)
    if len(f) == 0:
        return []
    e = f - a
    lo = int(np.floor(e.min() / bin_mw) * bin_mw)
    hi = int(np.ceil(e.max() / bin_mw) * bin_mw) + bin_mw
    counts, edges = np.histogram(e, bins=np.arange(lo, hi + 1, bin_mw))
    return [{"from": int(edges[i]), "to": int(edges[i + 1]), "count": int(c)} for i, c in enumerate(counts)]


def error_quantiles(errors: np.ndarray, qs: tuple[float, ...] = (10, 50, 90)) -> dict[str, float]:
    e = np.asarray(errors, dtype=float)
    e = e[~np.isnan(e)]
    if len(e) == 0:
        return {}
    return {f"q{int(q)}": float(np.percentile(e, q)) for q in qs}
