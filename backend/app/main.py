"""FastAPI app: thin HTTP layer over WindService."""

from __future__ import annotations

from datetime import date, time
from functools import lru_cache
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app import schemas
from app.config import load_settings, parse_hhmm
from app.service import WindService

settings = load_settings()

app = FastAPI(
    title="Wind Forecast Monitor API",
    description="Day-ahead view of GB national wind forecasts (Elexon WINDFOR) vs actuals (FUELHH).",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"])


@lru_cache(maxsize=1)
def get_service() -> WindService:
    return WindService(settings)


Service = Annotated[WindService, Depends(get_service)]
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


def _cutoff(value: str | None) -> time:
    return parse_hhmm(value) if value else settings.default_cutoff


def _check_range(svc: WindService, *days: date | None) -> None:
    lo, hi = svc.delivery_dates[0], svc.delivery_dates[-1]
    for d in days:
        if d is not None and not lo <= d <= hi:
            raise HTTPException(422, f"Date {d} outside available range {lo}..{hi}")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meta", response_model=schemas.Meta)
def meta(svc: Service) -> dict[str, Any]:
    return svc.meta()


@app.get("/api/decision", response_model=schemas.Decision)
def decision(
    svc: Service,
    delivery_date: Annotated[date, Query(alias="date", description="UK delivery day D")],
    cutoff: Annotated[str | None, Query(pattern=HHMM, description="UK time on D-1, e.g. 09:00")] = None,
) -> dict[str, Any]:
    _check_range(svc, delivery_date)
    return svc.decision(delivery_date, _cutoff(cutoff))


@app.get("/api/timeseries", response_model=schemas.TimeSeries)
def timeseries(
    svc: Service,
    horizon: Annotated[float, Query(ge=0, le=48, description="Forecast made at least this many hours ahead")] = 24,
    start: date | None = None,
    end: date | None = None,
) -> dict[str, Any]:
    _check_range(svc, start, end)
    return svc.timeseries(horizon, start, end)


@app.get("/api/accuracy", response_model=schemas.Accuracy, response_model_by_alias=True)
def accuracy(
    svc: Service,
    mode: Annotated[str, Query(pattern="^(decision|horizon)$")] = "decision",
    cutoff: Annotated[str | None, Query(pattern=HHMM)] = None,
    horizon: Annotated[float, Query(ge=0, le=48)] = 24,
    start: date | None = None,
    end: date | None = None,
) -> dict[str, Any]:
    if mode == "decision":
        return svc.accuracy_decision(_cutoff(cutoff))
    _check_range(svc, start, end)
    return svc.accuracy_horizon(horizon, start, end)


@app.get("/api/accuracy/horizons", response_model=list[schemas.HorizonRow])
def horizon_curve(svc: Service) -> list[dict[str, Any]]:
    return svc.horizon_curve


@app.get("/api/accuracy/cutoffs", response_model=list[schemas.CutoffRow])
def cutoff_curve(svc: Service) -> list[dict[str, Any]]:
    return svc.cutoff_curve
