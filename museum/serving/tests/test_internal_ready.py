"""T109 — /internal/ready·/internal/models·warmup이 워커 적재 상태를 모아 보여 준다."""
from __future__ import annotations

import threading
import time

from fastapi.testclient import TestClient

from model_api.app import app
from tests.test_stage_job_contract import make_worker


def test_ready_shows_loading_then_ready(env, monkeypatch):
    monkeypatch.setenv("LLM_SERVER_URL", "http://127.0.0.1:9")      # llm-server 없음(P0)
    w = make_worker(load_s=0.8, preload=False)
    c = TestClient(app)
    body = c.get("/internal/ready").json()
    assert body["groups"] == {"cpu": True, "gpu": False, "llm": False} and body["gpuEnabled"] is False
    m1 = next(m for m in body["models"] if m["modelId"] == "M1")
    assert m1["load"]["state"] == "not_loaded" and m1["hint"] == "model_loading"
    t = threading.Thread(target=w.load_model, args=("M1",)); t.start(); time.sleep(0.3)
    m1 = next(m for m in c.get("/internal/models").json()["models"] if m["modelId"] == "M1")
    assert m1["load"]["state"] == "loading" and m1["load"]["elapsedSeconds"] >= 0.2
    t.join()
    m1 = next(m for m in c.get("/internal/models").json()["models"] if m["modelId"] == "M1")
    assert m1["load"]["state"] == "ready" and m1["load"]["lastLoadSeconds"] >= 0.7 and m1["hint"] is None
    m6 = next(m for m in c.get("/internal/models").json()["models"] if m["modelId"] == "M6")
    assert m6["load"]["state"] == "disabled"


def test_remaining_seconds_from_manifest(env, tmp_path):
    (tmp_path / "manifest.yaml").write_text("models:\n  M1:\n    load: {expected_seconds: 5}\n")
    w = make_worker(load_s=0.5, preload=False)
    t = threading.Thread(target=w.load_model, args=("M1",)); t.start(); time.sleep(0.2)
    m1 = next(m for m in TestClient(app).get("/internal/models").json()["models"] if m["modelId"] == "M1")
    assert m1["load"]["expectedSeconds"] == 5 and 4.0 <= m1["load"]["remainingSeconds"] <= 4.9
    t.join()


def test_disabled_model_and_warmup_flag(env):
    env.q("UPDATE model_version SET release_state='retired' WHERE version_id=%s", env.versions["M2"])
    w = make_worker(preload=False)
    c = TestClient(app)
    m2 = next(m for m in c.get("/internal/models").json()["models"] if m["modelId"] == "M2")
    assert m2["load"]["state"] == "disabled" and m2["hint"] == "model_disabled" and m2["activeVersion"] is None
    r = c.post("/internal/models/M1/warmup")
    assert r.status_code == 202
    w.poll_warmup_requests(); time.sleep(0.2)
    assert w.board.get("M1").state == "ready"
    assert c.post("/internal/models/M9/warmup").status_code == 404
    r = c.post("/internal/models/M6/warmup")
    assert r.status_code == 409 and r.json()["code"] == "m6_preload_at_start_only"   # 공유 Ollama 규칙
