"""오류 안내·요청 번호(contracts/model-api.openapi.yaml 머리말, 2026-09-30 API 서비스 점검표 W5·E4·E7·L1).

이상한 값을 넣으면 detail(무엇이 틀렸고 무엇을 하면 되는지)·fields[].message(올바른 값)·requestId를 돌려주고, 모든 응답에 X-Request-ID.
"""
from __future__ import annotations

import re

from tests.test_model_api import api, post  # noqa: F401 — 같은 픽스처·요청 도우미

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _guided(r, status):
    assert r.status_code == status
    b = r.json()
    assert isinstance(b.get("detail"), str) and len(b["detail"]) > 5
    assert b.get("requestId") == r.headers.get("x-request-id")
    return b


def _msg(b, name):
    return next((f.get("message", "") for f in b.get("fields", []) if f["name"] == name), "")


def test_422_tells_what_to_send(api):
    k = api.key()
    b = _guided(post(api.client, "segment", k, name="file"), 422)
    assert "image" in _msg(b, "image") or "image" in b["detail"]
    assert "빼고" in _msg(b, "file")
    b = _guided(post(api.client, "segment", k, data=b"GIF89a...."), 422)
    assert re.search(r"JPEG|PNG|HEIC", _msg(b, "image"))


def test_other_errors_have_detail_and_who_fixes(api):
    assert "키" in _guided(post(api.client, "segment", None), 401)["detail"]
    b = _guided(api.client.get("/v1/models/jobs/abc", headers={"X-API-Key": api.key()}), 404)
    assert b["code"] == "not_found"


def test_request_id_header_echo_or_uuid(api):
    r = api.client.get("/v1/models/openapi.json")
    assert UUID.match(r.headers["x-request-id"])
    r = post(api.client, "segment", None, extra=None)
    r2 = api.client.post("/v1/models/segment", headers={"X-Request-ID": "client-1.a_b"})
    assert r2.headers["x-request-id"] == "client-1.a_b" and r2.json()["requestId"] == "client-1.a_b"
    r3 = api.client.get("/v1/models/openapi.json", headers={"X-Request-ID": "a b"})
    assert UUID.match(r3.headers["x-request-id"])
