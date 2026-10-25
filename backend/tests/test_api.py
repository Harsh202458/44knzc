"""API tests against the real January 2026 snapshot in backend/data."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_meta_covers_january_decisions() -> None:
    meta = client.get("/api/meta").json()
    assert meta["delivery_dates"][0] == "2026-01-02"
    assert meta["delivery_dates"][-1] == "2026-02-01"
    assert meta["default_cutoff"] == "09:00"
    assert "07:30" in meta["run_schedule_utc"]


def test_decision_day() -> None:
    r = client.get("/api/decision", params={"date": "2026-01-15"})
    assert r.status_code == 200
    body = r.json()
    assert body["run_publish_time"] == "2026-01-14T07:30:00Z"
    assert len(body["periods"]) == 48
    p = body["periods"][0]
    assert p["p10"] <= p["expected"] <= p["p90"]
    assert body["band"]["n_samples"] == 30 * 48


def test_decision_rejects_out_of_range_and_bad_cutoff() -> None:
    assert client.get("/api/decision", params={"date": "2025-06-01"}).status_code == 422
    assert client.get("/api/decision", params={"date": "2026-01-15", "cutoff": "9am"}).status_code == 422


def test_timeseries_and_accuracy() -> None:
    ts = client.get("/api/timeseries", params={"horizon": 4, "start": "2026-01-10", "end": "2026-01-11"}).json()
    assert len(ts["points"]) == 96
    assert ts["metrics"]["n"] == 96

    acc = client.get("/api/accuracy", params={"mode": "horizon", "horizon": 24}).json()
    assert len(acc["by_hour"]) == 24
    assert acc["histogram"][0]["from"] < 0 < acc["histogram"][-1]["to"]

    dec = client.get("/api/accuracy", params={"mode": "decision"}).json()
    assert dec["bias_correction"]["corrected_mae"] < dec["bias_correction"]["raw_mae"]


def test_curves() -> None:
    horizons = client.get("/api/accuracy/horizons").json()
    assert [r["horizon_h"] for r in horizons][:3] == [0, 1, 2]
    # Error should grow with lead time.
    assert horizons[0]["mae"] < horizons[36]["mae"]
    cutoffs = client.get("/api/accuracy/cutoffs").json()
    nine = next(r for r in cutoffs if r["cutoff"] == "09:00")
    assert nine["run_hhmm"] == "07:30"
