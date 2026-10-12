"""GET /v1/models/docs (계약, 2026-09-30 API 개선 A11): 계약 정본(/v1/models/openapi.json)을 읽는 Swagger 화면이 키 없이 열리고,
그 문서에서 Try it out 할 경로(health·openapi.json)가 실제로 200이다."""
from fastapi.testclient import TestClient

from model_api import external
from model_api.app import app
from tests.test_model_api import api  # noqa: F401 — DB 준비(openapi.json이 활성 버전을 읽는다)
from tests.test_models_health import view


def test_docs_page_points_to_contract(monkeypatch):
    c = TestClient(app)
    r = c.get("/v1/models/docs")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert "/v1/models/openapi.json" in r.text and "swagger-ui" in r.text.lower()


def test_try_it_out_paths_are_200(api, monkeypatch):
    monkeypatch.setattr(external, "models_view", lambda: view({"M1": "ready", "M2": "ready", "M3": "ready", "M5": "ready"}))
    c = TestClient(app)
    assert c.get("/v1/models/health").status_code == 200
    spec = c.get("/v1/models/openapi.json")
    assert spec.status_code == 200 and "/v1/models/docs" in spec.json()["paths"]
