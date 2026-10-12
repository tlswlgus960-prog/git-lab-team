"""GET /v1/models/health (contracts/model-api.openapi.yaml, 2026-09-30 API 개선 A1·A3·A4): 키 없이 열고,
적재 상태를 실제로 읽어 준비됐으면 200 ok, 적재 중이면 503 loading, 실패면 503 error. 내부 값(기기·경로·점수)은 싣지 않는다."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from model_api import external
from model_api.app import app


def view(states: dict[str, str | None]):
    """models_view 모양 — state None은 활성 버전 없음(disabled)"""
    return {"models": [{"modelId": m, "activeVersion": (f"{m}-v1" if st else None), "execDevice": "cpu",
                        "load": {"state": st or "disabled", "device": "mps"}} for m, st in states.items()],
            "workers": [{"worker": "w1", "servingGroup": "cpu_vision", "alive": True}]}


@pytest.fixture()
def client(monkeypatch):
    def use(states):
        monkeypatch.setattr(external, "models_view", lambda: view(states))
        return TestClient(app)
    return use


def test_all_ready_is_200_ok(client):
    r = client({"M1": "ready", "M2": "ready", "M3": "ready", "M5": "ready", "M7": None}).get("/v1/models/health")
    assert r.status_code == 200
    b = r.json()
    assert b["status"] == "ok" and b["functions"] == {"segment": "ready", "classify": "ready", "pose": "ready", "relief": "ready"}
    assert b["modelVersions"]["segment"] == "M1-v1" and b["modelVersions"]["relief"] == "M5-v1"   # relief 주 모델은 M5(FUNC_MODEL)
    assert "mps" not in r.text and "device" not in r.text and "X-API-Key" not in r.request.headers   # 키 없이·내부 값 없음


def test_loading_is_503_not_ok(client):
    r = client({"M1": "loading", "M2": "ready", "M3": "ready", "M5": "ready"}).get("/v1/models/health")
    assert r.status_code == 503 and r.json()["status"] == "loading"
    assert r.json()["functions"]["segment"] == "loading" and r.json()["functions"]["relief"] == "loading"   # relief = M1+M5


def test_failed_is_503_error_and_disabled_excluded(client):
    r = client({"M1": "ready", "M2": None, "M3": "failed", "M5": "ready"}).get("/v1/models/health")
    assert r.status_code == 503 and r.json()["status"] == "error"
    assert r.json()["functions"]["classify"] == "disabled"
    r = client({"M1": "ready", "M2": None, "M3": None, "M5": "ready"}).get("/v1/models/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"                 # 꺼진 기능은 판정에서 뺀다


def test_no_active_model_is_503_error(client):
    r = client({"M1": None, "M2": None, "M3": None, "M5": None}).get("/v1/models/health")
    assert r.status_code == 503 and r.json()["status"] == "error"
