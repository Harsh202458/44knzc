"""API response models (also drive the OpenAPI docs at /api/docs)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Metrics(BaseModel):
    n: int
    mae: float | None = None
    rmse: float | None = None
    bias: float | None = Field(None, description="Mean of forecast - actual (MW). >0 = forecast too high")
    nmae: float | None = Field(None, description="MAE / mean actual")
    p50_abs_error: float | None = None
    p90_abs_error: float | None = None
    error_p10: float | None = None
    error_p90: float | None = None
    max_shortfall: float | None = None
    max_surplus: float | None = None
    mean_actual: float | None = None
    within_1gw: float | None = Field(None, description="Share of half-hours with |error| <= 1000 MW")
    share_shortfall: float | None = Field(None, description="Share of half-hours where forecast > actual")


class Meta(BaseModel):
    fetched_at: str
    source: str
    default_cutoff: str
    delivery_dates: list[str]
    data_from: str
    data_to: str
    n_runs: int
    run_schedule_utc: dict[str, int] = Field(description="Forecast runs per publish time-of-day")


class DecisionPeriod(BaseModel):
    start_time: str
    settlement_period: int
    forecast: float | None
    expected: float | None = Field(description="Forecast adjusted by the median historical error")
    p10: float | None = Field(description="Low wind case: 90% of the time actual was above this")
    p90: float | None
    actual: float | None
    horizon_h: float | None


class DecisionSummary(BaseModel):
    forecast_mwh: float
    expected_mwh: float
    p10_mwh: float
    actual_mwh: float | None
    peak_forecast_mw: float | None
    min_forecast_mw: float | None
    metrics: Metrics


class Band(BaseModel):
    method: str
    n_samples: int
    error_q10: float
    error_q50: float
    error_q90: float


class Decision(BaseModel):
    delivery_date: str
    cutoff_utc: str
    run_publish_time: str | None
    next_run_publish_time: str | None
    band: Band | None
    summary: DecisionSummary
    periods: list[DecisionPeriod]


class SeriesPoint(BaseModel):
    start_time: str
    actual: float | None
    forecast: float | None
    publish_time: str | None


class TimeSeries(BaseModel):
    horizon_h: float
    points: list[SeriesPoint]
    metrics: Metrics


class HourRow(BaseModel):
    hour: int
    mae: float
    bias: float
    n: int


class DayRow(BaseModel):
    date: str
    mae: float
    bias: float
    forecast_mwh: float
    actual_mwh: float
    n: int


class HistBin(BaseModel):
    from_: int = Field(alias="from")
    to: int
    count: int


class BiasCorrection(BaseModel):
    method: str
    raw_mae: float
    corrected_mae: float
    improvement: float


class Accuracy(BaseModel):
    mode: str
    label: str
    metrics: Metrics
    by_hour: list[HourRow]
    by_day: list[DayRow]
    histogram: list[HistBin]
    bias_correction: BiasCorrection | None = None


class HorizonRow(BaseModel):
    horizon_h: float
    mae: float | None
    rmse: float | None
    bias: float | None
    p90_abs_error: float | None
    coverage: float


class CutoffRow(BaseModel):
    cutoff: str
    run_hhmm: str | None
    mae: float | None
    bias: float | None
    mean_horizon_h: float | None
