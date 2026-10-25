"""Simple bias correction of the decision-time forecast.

The WINDFOR forecast runs persistently high against FUELHH outturn. Subtracting
the median past error is the simplest possible correction; this module measures
what it would have achieved *without look-ahead*: for delivery day D we only use
errors from days whose actuals were fully known at the D-1 decision (<= D-2).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd


def trailing_median_correction(errors: pd.DataFrame, lag_days: int = 2, min_days: int = 3) -> pd.Series:
    """Corrected forecast per row of ``decision_errors`` output.

    Days with fewer than ``min_days`` of history are left uncorrected.
    """
    corrected = errors["forecast"].copy()
    for key, rows in errors.groupby("delivery_date"):
        day: date = key  # type: ignore[assignment]
        past = errors.loc[errors["delivery_date"] <= day - timedelta(days=lag_days), ["delivery_date", "error"]]
        if past["delivery_date"].nunique() < min_days:
            continue
        corrected.loc[rows.index] = rows["forecast"] - float(np.nanmedian(past["error"]))
    return corrected


def correction_benefit(errors: pd.DataFrame) -> dict[str, Any]:
    """MAE of the raw vs bias-corrected decision-time forecast."""
    corrected = trailing_median_correction(errors)
    ok = errors["actual"].notna() & errors["forecast"].notna()
    raw = float((errors.loc[ok, "forecast"] - errors.loc[ok, "actual"]).abs().mean())
    adj = float((corrected[ok] - errors.loc[ok, "actual"]).abs().mean())
    return {
        "method": "subtract median error of all days known by the decision (<= D-2); no look-ahead",
        "raw_mae": round(raw, 1),
        "corrected_mae": round(adj, 1),
        "improvement": round((raw - adj) / raw, 4) if raw else 0.0,
    }
