"""Small client for the two Elexon BMRS endpoints this app uses.

Only used by the snapshot script (and tests); the running API reads the
saved snapshot so it never depends on Elexon being up.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from typing import Any

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
CHUNK_DAYS = 7  # keep each request small; the stream endpoints have no paging


def _get(path: str, params: list[tuple[str, str]], retries: int = 3) -> list[dict[str, Any]]:
    url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params)}"
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 - fixed https host
                data = json.load(resp)
            if not isinstance(data, list):
                raise ValueError(f"Unexpected response shape from {url}")
            return data
        except Exception as exc:  # network errors, 5xx, bad JSON
            last_error = exc
            time.sleep(2**attempt)
    raise RuntimeError(f"Failed to fetch {url}") from last_error


def _date_chunks(start: date, end: date) -> Iterator[tuple[date, date]]:
    cur = start
    while cur <= end:
        chunk_end = min(cur + timedelta(days=CHUNK_DAYS - 1), end)
        yield cur, chunk_end
        cur = chunk_end + timedelta(days=1)


def fetch_wind_actuals(start: date, end: date) -> list[dict[str, Any]]:
    """Half-hourly wind outturn (FUELHH, fuelType=WIND) for settlement dates start..end."""
    rows: list[dict[str, Any]] = []
    for a, b in _date_chunks(start, end):
        rows += _get(
            "/datasets/FUELHH/stream",
            [
                ("settlementDateFrom", a.isoformat()),
                ("settlementDateTo", b.isoformat()),
                ("fuelType", "WIND"),
            ],
        )
    return rows


def fetch_wind_forecasts(publish_from: datetime, publish_to: datetime) -> list[dict[str, Any]]:
    """All WINDFOR forecast runs published in [publish_from, publish_to]."""
    rows: list[dict[str, Any]] = []
    cur = publish_from
    while cur < publish_to:
        nxt = min(cur + timedelta(days=CHUNK_DAYS), publish_to)
        rows += _get(
            "/datasets/WINDFOR/stream",
            [
                ("publishDateTimeFrom", cur.strftime("%Y-%m-%dT%H:%M:%SZ")),
                ("publishDateTimeTo", nxt.strftime("%Y-%m-%dT%H:%M:%SZ")),
            ],
        )
        cur = nxt
    return rows
