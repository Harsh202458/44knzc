"""Runtime settings (overridable with environment variables)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, time
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    default_cutoff: time  # UK local time on D-1
    # Purchase decisions made on these days are in scope (January 2026).
    decision_from: date
    decision_to: date
    cors_origins: list[str]

    @property
    def delivery_from(self) -> date:
        return date.fromordinal(self.decision_from.toordinal() + 1)

    @property
    def delivery_to(self) -> date:
        return date.fromordinal(self.decision_to.toordinal() + 1)


def parse_hhmm(value: str) -> time:
    hh, mm = value.split(":")
    return time(int(hh), int(mm))


def load_settings() -> Settings:
    default_data = Path(__file__).resolve().parents[1] / "data"
    return Settings(
        data_dir=Path(os.getenv("DATA_DIR", default_data)),
        default_cutoff=parse_hhmm(os.getenv("DEFAULT_CUTOFF", "09:00")),
        decision_from=date.fromisoformat(os.getenv("DECISION_FROM", "2026-01-01")),
        decision_to=date.fromisoformat(os.getenv("DECISION_TO", "2026-01-31")),
        cors_origins=[o for o in os.getenv("CORS_ORIGINS", "*").split(",") if o],
    )
