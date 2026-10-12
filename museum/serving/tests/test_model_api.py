"""T120 — 외부 모델 기능 계약 시험(FR-28, Scenario 18, G2·G24·G25, D8·D17, contracts/model-api.openapi.yaml).

키 인증·종류 제한·한도·크기·형식·활성 버전, 작업 등록·상태·결과 1회 수령, caption 프록시, 명세 버전, 모든 호출 기록.
"""
from __future__ import annotations

import hashlib
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from model_api.app import app

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200


@pytest.fixture()
def api(env, monkeypatch):
    s = env
    for t in ("external_call_log", "external_job", "api_key", "gate_event"):
        s.cur.execute(f"DELETE FROM {t}")

    def key(kind="team_internal", status="active"):
        raw = f"uam_{kind}_{status}_{len(s.q('SELECT 1 FROM api_key'))}"
        s.cur.execute("INSERT INTO api_key (key_kind, key_hash, status, revoked_at) VALUES (%s, %s, %s, IF(%s = 'revoked', UTC_TIMESTAMP(), NULL))",
                      (kind, hashlib.sha256(raw.encode()).hexdigest(), status, status))
        return raw
    s.key = key
    s.client = TestClient(app)
    return s


def post(c, fn, k, data=PNG, name="image", extra=None):
    files = {name: ("a.png", io.BytesIO(data), "image/png")}
    if extra:
        files.update(extra)
    return c.post(f"/v1/models/{fn}", files=files, headers={"X-API-Key": k} if k else {})


def calls(s):
    return [(r["endpoint"], r["http_status"]) for r in s.q("SELECT endpoint, http_status FROM external_call_log ORDER BY call_id")]


def test_key_required_and_every_call_logged(api):
    c = api.client
    assert post(c, "segment", None).status_code == 401
    assert post(c, "segment", "uam_wrong").status_code == 401
    assert post(c, "segment", api.key(status="revoked")).status_code == 401
    assert calls(api) == [("segment", 401)] * 3
    assert {r["gate_id"] for r in api.q("SELECT gate_id FROM gate_event")} == {"G2"}


def test_job_created_input_in_ext_and_status_only_for_owner(api):
    k, other = api.key(), api.key("course_internal")
    r = post(api.client, "segment", k)
    assert r.status_code == 202, r.text
    b = r.json()
    assert b["status"] == "queued" and b["model"]["id"] == "M1" and b["jobId"].isdigit()
    assert (api.store / "ext" / b["jobId"] / "input.png").read_bytes() == PNG
    job = api.one("SELECT func, key_id, status FROM external_job WHERE ext_job_id = %s", int(b["jobId"]))
    assert job["func"] == "segment" and job["status"] == "queued"
    assert api.client.get(f"/v1/models/jobs/{b['jobId']}", headers={"X-API-Key": k}).json()["status"] == "queued"
    assert api.client.get(f"/v1/models/jobs/{b['jobId']}", headers={"X-API-Key": other}).status_code == 404
    # 아직 done이 아니면 404 result_not_ready(chk_ecl_status에 409 없음)
    nr = api.client.get(f"/v1/models/jobs/{b['jobId']}/result", headers={"X-API-Key": k})
    assert nr.status_code == 404 and nr.json()["reason"] == "result_not_ready"


def test_result_once_then_deleted(api):
    k = api.key()
    jid = post(api.client, "classify", k).json()["jobId"]
    d = api.store / "ext" / jid
    (d / "result.json").write_text(json.dumps({"classify": {"kind": "house", "tags": ["집"]}, "score": 0.9}))
    api.cur.execute("""UPDATE external_job SET status = 'done', result_class = 'ok', started_at = UTC_TIMESTAMP(), finished_at = UTC_TIMESTAMP(),
                       result_temp_ref = %s WHERE ext_job_id = %s""", (f"ext/{jid}/result.json", int(jid)))
    st = api.client.get(f"/v1/models/jobs/{jid}", headers={"X-API-Key": k}).json()
    assert st["outcome"] == "ok" and st["resultExpiresAt"]
    r = api.client.get(f"/v1/models/jobs/{jid}/result", headers={"X-API-Key": k})
    assert r.status_code == 200 and r.json()["classify"] == {"kind": "house", "tags": ["집"]} and "score" not in r.json()
    assert not d.exists()
    assert api.one("SELECT result_temp_ref, delivered_at FROM external_job WHERE ext_job_id = %s", int(jid))["result_temp_ref"] is None
    assert api.client.get(f"/v1/models/jobs/{jid}/result", headers={"X-API-Key": k}).status_code == 404


def test_pose_only_team_internal_or_test(api):
    assert post(api.client, "pose", api.key("course_internal")).status_code == 403
    assert post(api.client, "pose", api.key("test")).status_code == 202
    assert api.q("SELECT COUNT(*) n FROM external_job")[0]["n"] == 1


def test_size_format_fields(api, monkeypatch):
    k = api.key()
    assert post(api.client, "segment", k, data=b"GIF89a....").status_code == 422
    assert post(api.client, "segment", k, name="file").status_code == 422
    assert post(api.client, "segment", k, extra={"name": (None, "하늘")}).status_code == 422
    from model_api import auth
    monkeypatch.setattr(auth, "load_yaml", lambda _n: {**_limits(), "max_bytes": 100})
    assert post(api.client, "segment", k).status_code == 413
    assert api.q("SELECT COUNT(*) n FROM external_job")[0]["n"] == 0
    assert {r["gate_id"] for r in api.q("SELECT gate_id FROM gate_event")} == {"G24"}


def _limits():
    from common.config import load_yaml
    return load_yaml("ext-limits")


def test_inactive_model_and_unknown_function(api):
    k = api.key()
    api.cur.execute("UPDATE model_version SET release_state = 'retired' WHERE model_id = 'M5'")
    r = post(api.client, "relief", k)
    assert r.status_code == 503 and r.json()["reason"] == "model_disabled"
    assert post(api.client, "sculpture", k).status_code == 404         # 3D는 외부 기능이 아님(D9)
    assert api.q("SELECT COUNT(*) n FROM external_job")[0]["n"] == 0
    assert calls(api) == [("relief", 503), ("other", 404)]


def test_rate_limits(api, monkeypatch):
    from model_api import auth
    k = api.key()
    monkeypatch.setattr(auth, "load_yaml", lambda _n: {**_limits(), "concurrent": 1})
    assert post(api.client, "segment", k).status_code == 202
    r = post(api.client, "segment", k)
    assert r.status_code == 429 and r.json()["reason"] == "concurrent" and r.headers["retry-after"] == "10"
    monkeypatch.setattr(auth, "load_yaml", lambda _n: {**_limits(), "per_minute": 2, "concurrent": 9})
    r = post(api.client, "segment", k)
    assert r.status_code == 429 and r.json()["reason"] == "per_minute"


class _Llm(BaseHTTPRequestHandler):
    reply = {"outcome": "ok", "source": "llm", "body": "바다를 그린 작품이에요.", "generationCount": 1}
    got: list = []

    def do_POST(self):
        _Llm.got.append(json.loads(self.rfile.read(int(self.headers["content-length"]))))
        out = json.dumps(_Llm.reply).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(out)

    def log_message(self, *a):
        pass


def test_caption_proxy(api, monkeypatch):
    k = api.key()
    body = {"keywords": ["바다"], "ageAtMaking": 5}
    assert api.client.post("/v1/models/caption", json=body, headers={"X-API-Key": k}).status_code == 404   # P0
    monkeypatch.setenv("CAPTION_ENABLED", "true")
    assert api.client.post("/v1/models/caption", json=body, headers={"X-API-Key": k}).status_code == 503  # M6 비활성
    api.version("M6", label="qwen3-4b-instruct-2507")
    srv = HTTPServer(("127.0.0.1", 0), _Llm)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("LLM_SERVER_URL", f"http://127.0.0.1:{srv.server_port}")
    try:
        bad = api.client.post("/v1/models/caption", json={**body, "image": "x"}, headers={"X-API-Key": k})
        assert bad.status_code == 422 and bad.json()["gate"] == "G24"
        ok = api.client.post("/v1/models/caption", json=body, headers={"X-API-Key": k})
        assert ok.status_code == 200 and ok.json() == {"body": "바다를 그린 작품이에요.", "source": "llm", "aiAuthored": True,
                                                       "model": {"id": "M6", "version": "qwen3-4b-instruct-2507"}}
        assert _Llm.got[-1]["keywords"] == ["바다"] and "image" not in _Llm.got[-1]
        _Llm.reply = {"outcome": "timeout"}
        assert api.client.post("/v1/models/caption", json=body, headers={"X-API-Key": k}).status_code == 504
    finally:
        srv.shutdown()
    assert api.q("SELECT COUNT(*) n FROM external_job")[0]["n"] == 0                               # 작업 없음
    assert ("caption", 200) in calls(api)


def test_openapi_has_model_versions_without_internal(api):
    import model_api.external as ext
    ext._versions_at_start = None
    r = api.client.get("/v1/models/openapi.json")
    assert r.status_code == 200
    doc = r.json()
    assert not any(p.startswith("/internal") for p in doc["paths"])
    assert doc["info"]["x-model-versions"]["M1"].startswith("M1-v") and doc["info"]["x-model-versions"]["M6"] is None


def test_expired_result_not_delivered(api):
    k = api.key()
    jid = post(api.client, "segment", k).json()["jobId"]
    (api.store / "ext" / jid / "result.json").write_text("{}")
    api.cur.execute("""UPDATE external_job SET status = 'done', result_class = 'ok', started_at = UTC_TIMESTAMP() - INTERVAL 2 HOUR,
                       finished_at = UTC_TIMESTAMP() - INTERVAL 2 HOUR, result_temp_ref = %s WHERE ext_job_id = %s""", (f"ext/{jid}/result.json", int(jid)))
    r = api.client.get(f"/v1/models/jobs/{jid}/result", headers={"X-API-Key": k})
    assert r.status_code == 404 and r.json()["reason"] == "result_expired"
    assert not (api.store / "ext" / jid).exists()
    assert api.one("SELECT delivered_at FROM external_job WHERE ext_job_id = %s", int(jid))["delivered_at"] is None
