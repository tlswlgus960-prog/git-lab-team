"""외부 모델 기능 경로(UC12, FR-28, D8·D13·D17, T121·T122 model-api 쪽·T130) — contracts/model-api.openapi.yaml.

  POST /v1/models/{segment|classify|pose|relief}  → 202 ExtJob (external_job 등록, 입력은 ext/{id}/input.*)
  POST /v1/models/caption                          → 200 (P0.5, llm-server 동기 프록시, 작업 없음)
  GET  /v1/models/jobs/{id}                        → ExtJob (발급 키로만)
  GET  /v1/models/jobs/{id}/result                 → ExtResult 1회, 전달 즉시 ext/{id}/ 삭제
  GET  /v1/models/openapi.json                     → 명세 + info.x-model-versions (API활용, BR-API-08)
워커 쪽(external_job 점유·실행·result.json 쓰기)은 serving/workers/external.py(A, T122).
"""
from __future__ import annotations

import json
import os
import shutil
import urllib.error
import urllib.request
from email.parser import BytesParser
from email.policy import HTTP
from pathlib import Path

import yaml
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from common.config import REPO_ROOT, load_settings
from common.db import connect, tx

from .auth import ApiError, Key, authenticate, check_rate, limits, record
from .internal import models_view

router = APIRouter(prefix="/v1/models")
FUNC_MODEL = {"segment": "M1", "classify": "M2", "pose": "M3", "relief": "M5"}
NEEDS = {"relief": ("M1", "M5")}                     # relief = M1 마스크 + M5 깊이
MAGIC = ((b"\xff\xd8\xff", "jpg"), (b"\x89PNG\r\n\x1a\n", "png"))
_versions_at_start: dict | None = None


def _sniff(buf: bytes) -> str | None:
    for sig, ext in MAGIC:
        if buf.startswith(sig):
            return ext
    if buf[4:8] == b"ftyp" and buf[8:12] in (b"heic", b"heix", b"mif1", b"msf1", b"hevc"):
        return "heic"
    return None


def _problem(e: ApiError) -> JSONResponse:
    return JSONResponse(e.body(), status_code=e.status, headers=e.headers, media_type="application/problem+json")


def _run(endpoint: str, request: Request, handler, *, creates_job: bool = False, authed: bool = True):
    """인증 → 한도 → 처리 → 기록. 어떤 결과든 external_call_log 1행(BR-API-03)."""
    conn = connect()
    key: Key | None = None
    try:
        try:
            if authed:
                with tx(conn) as cur:
                    key = authenticate(cur, request.headers.get("x-api-key"))
                    if endpoint in FUNC_MODEL or endpoint == "caption":
                        check_rate(cur, key, creates_job)
            status, body, headers = handler(conn, key)
            gate = reason = None
        except ApiError as e:
            status, body, headers, gate, reason = e.status, e.body(), e.headers, e.gate, e.reason
        except Exception:
            status, body, headers, gate, reason = 503, ApiError(503, "model_not_ready", "internal").body(), {}, None, None
        try:
            with tx(conn) as cur:
                record(cur, key.key_id if key else None, endpoint, status, gate, reason)
        except Exception:
            pass
        if status >= 400 and isinstance(body, dict):
            body["requestId"] = request.state.request_id
        media = "application/json" if status < 400 else "application/problem+json"
        return JSONResponse(body, status_code=status, headers=headers, media_type=media)
    finally:
        conn.close()


def _active(cur, model_id: str) -> dict | None:
    cur.execute("""SELECT version_id, version_label FROM model_version
                    WHERE model_id = %s AND release_state = 'active' AND license_confirmed = TRUE""", (model_id,))
    return cur.fetchone()


def _signal(e: Exception) -> ApiError | None:
    msg = str(getattr(e, "args", ["", ""])[1] if len(getattr(e, "args", [])) > 1 else e)
    if "pose_team_internal_only" in msg:
        return ApiError(403, "forbidden_scope", "pose_team_internal_only", "G2")
    if "key_revoked" in msg:
        return ApiError(401, "unauthorized", "key_revoked", "G2")
    if "version_not_active" in msg:
        return ApiError(503, "model_not_ready", "version_not_active", "G25")
    return None


def _job_view(r: dict) -> dict:
    ttl = limits()["result_ttl_s"]
    dur = int((r["finished_at"] - r["started_at"]).total_seconds() * 1000) if r["finished_at"] and r["started_at"] else None
    exp = None
    if r["status"] == "done" and r["finished_at"] and not r["delivered_at"]:
        from datetime import timedelta
        exp = (r["finished_at"] + timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"jobId": str(r["ext_job_id"]), "function": r["func"], "status": r["status"],
            "outcome": r["result_class"] or r["error_class"], "model": {"id": r["model_id"], "version": r["version_label"]},
            "durationMs": dur, "resultExpiresAt": exp}


def _own_job(cur, key: Key, job_id: str) -> dict:
    if not job_id.isdigit():
        raise ApiError(404, "not_found")
    cur.execute("""SELECT j.*, v.model_id, v.version_label, (j.finished_at < UTC_TIMESTAMP() - INTERVAL %s SECOND) expired
                     FROM external_job j JOIN model_version v ON v.version_id = j.model_version_id
                    WHERE j.ext_job_id = %s AND j.key_id = %s""", (limits()["result_ttl_s"], int(job_id), key.key_id))
    r = cur.fetchone()
    if not r:
        raise ApiError(404, "not_found")                 # 다른 키의 작업도 404(존재를 알리지 않음)
    return r


# ---- 명세(API활용) --------------------------------------------------------------------------------
@router.get("/openapi.json")
def spec(request: Request):
    def h(conn, _key):
        global _versions_at_start
        if _versions_at_start is None:                   # 기동 뒤 첫 조회 때 한 번 — 이 프로세스가 본 활성 버전
            with tx(conn) as cur:
                cur.execute("SELECT model_id, version_label FROM model_version WHERE release_state = 'active'")
                act = {r["model_id"]: r["version_label"] for r in cur.fetchall()}
            _versions_at_start = {m: act.get(m) for m in ("M1", "M2", "M3", "M5", "M6")}
        doc = yaml.safe_load((Path(os.environ.get("CONTRACTS_DIR", str(REPO_ROOT / "contracts"))) / "model-api.openapi.yaml").read_text("utf-8"))
        doc["paths"] = {p: v for p, v in doc.get("paths", {}).items() if not p.startswith("/internal")}
        doc.setdefault("info", {})["x-model-versions"] = _versions_at_start
        return 200, doc, {}
    return _run("other", request, h, authed=False)


# ---- 계약 문서 화면(키 없이, 2026-09-30 API 개선 A11) ------------------------------------------------
@router.get("/docs", include_in_schema=False)
def docs():
    """계약 정본(/v1/models/openapi.json)을 그대로 읽는 Swagger 화면 — FastAPI 자동 문서가 아니다."""
    from fastapi.openapi.docs import get_swagger_ui_html
    return get_swagger_ui_html(openapi_url="/v1/models/openapi.json", title="우리 아이 미술관 모델 기능 API")


# ---- 준비 상태(키 없이, 2026-09-30 API 개선 A1·A3·A4) --------------------------------------------------
_FUNC_MODELS = {"segment": ("M1",), "classify": ("M2",), "pose": ("M3",), "relief": ("M1", "M5")}
_STATE = {"ready": "ready", "loading": "loading", "not_loaded": "loading", "cold": "loading", "failed": "error"}


@router.get("/health")
def health():
    """적재 상태를 실제로 읽는다(워커 적재 기록). 활성 모델이 모두 준비면 200 ok, 아니면 503 loading·error."""
    try:
        view = models_view()
    except Exception:
        return JSONResponse({"status": "error", "functions": {f: "error" for f in _FUNC_MODELS}}, status_code=503)
    by_id = {m["modelId"]: m for m in view["models"]}
    any_worker = any(w["alive"] for w in view.get("workers", []))
    functions, versions = {}, {}
    for fn, mids in _FUNC_MODELS.items():
        ms = [by_id.get(m) or {} for m in mids]
        versions[fn] = (by_id.get(FUNC_MODEL[fn]) or {}).get("activeVersion")   # 주 모델(relief는 M5)
        if any(not m.get("activeVersion") for m in ms):
            functions[fn] = "disabled"                    # 부르면 503 model_not_ready — 판정에서 뺀다
            continue
        st = [_STATE.get(((m.get("load") or {}).get("state")) or "", "error") for m in ms]
        functions[fn] = "error" if "error" in st or not any_worker else "loading" if "loading" in st else "ready"
    live = [v for v in functions.values() if v != "disabled"]
    status = "error" if not live or "error" in live else "loading" if "loading" in live else "ok"
    return JSONResponse({"status": status, "functions": functions, "modelVersions": versions},
                        status_code=200 if status == "ok" else 503)


# ---- 작업 상태·결과 -------------------------------------------------------------------------------
@router.get("/jobs/{job_id}")
def job_status(job_id: str, request: Request):
    def h(conn, key):
        with tx(conn) as cur:
            return 200, _job_view(_own_job(cur, key, job_id)), {}
    return _run("jobs", request, h)


@router.get("/jobs/{job_id}/result")
def job_result(job_id: str, request: Request):
    store = load_settings().storage_root
    def h(conn, key):
        with tx(conn) as cur:
            r = _own_job(cur, key, job_id)
            if r["delivered_at"]:
                raise ApiError(404, "not_found", "already_delivered")
            ext_dir = store / "ext" / str(r["ext_job_id"])
            if r["status"] == "done" and r["expired"]:   # 보관 1시간 지남(D8) — sweeper와 같게 지우고 수령 불가
                shutil.rmtree(ext_dir, ignore_errors=True)
                cur.execute("UPDATE external_job SET result_temp_ref = NULL WHERE ext_job_id = %s", (r["ext_job_id"],))
                raise ApiError(404, "not_found", "result_expired")
            if r["status"] != "done" or not r["result_temp_ref"]:
                raise ApiError(404, "not_found", "result_not_ready")
            payload = json.loads((store / r["result_temp_ref"]).read_text("utf-8"))
            cur.execute("UPDATE external_job SET result_temp_ref = NULL, delivered_at = UTC_TIMESTAMP() WHERE ext_job_id = %s", (r["ext_job_id"],))
        shutil.rmtree(ext_dir, ignore_errors=True)       # 전달 즉시 삭제(SD_01 10.7, BR-API-05)
        body = {"jobId": str(r["ext_job_id"]), "function": r["func"], "outcome": r["result_class"],
                "model": {"id": r["model_id"], "version": r["version_label"]}}
        body.update({k: v for k, v in payload.items() if k in ("segment", "classify", "pose", "relief")})
        return 200, body, {}
    return _run("result", request, h)


# ---- caption (P0.5, 동기) ----------------------------------------------------------------------------
@router.post("/caption")
async def caption(request: Request):
    raw = await request.body()
    def h(conn, _key):
        if os.environ.get("CAPTION_ENABLED", "").lower() not in ("1", "true"):
            raise ApiError(404, "not_found", "caption_not_open", "G25")
        try:
            b = json.loads(raw or b"null")
        except ValueError:
            b = None
        allowed = {"keywords", "tags", "words", "ageAtMaking", "madeOn"}
        kw = b.get("keywords") if isinstance(b, dict) else None
        if (not isinstance(b, dict) or set(b) - allowed or not isinstance(kw, list) or not 1 <= len(kw) <= 5
                or any(not isinstance(k, str) or not k.strip() or len(k) > 20 for k in kw)
                or not isinstance(b.get("tags", []), list) or len(b.get("tags", [])) > 5
                or ("words" in b and (not isinstance(b["words"], str) or len(b["words"]) > 500))
                or ("ageAtMaking" in b and (not isinstance(b["ageAtMaking"], int) or not 0 <= b["ageAtMaking"] <= 18))):
            raise ApiError(422, "invalid_input", "caption_fields", "G24")   # 이미지·이름 필드 포함(BR-CAP-01)
        with tx(conn) as cur:
            v = _active(cur, "M6")
        if not v:
            raise ApiError(503, "model_not_ready", "model_disabled", "G25")
        req = urllib.request.Request(load_settings().llm_server_url.rstrip("/") + "/v1/caption", method="POST",
                                     data=json.dumps({"requestId": "ext", **b}).encode(), headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=limits()["llm_timeout_s"]) as r:
                out = json.load(r)
        except TimeoutError:
            raise ApiError(504, "timeout", "timeout")
        except (urllib.error.URLError, ValueError, OSError) as e:
            if isinstance(getattr(e, "reason", None), TimeoutError):
                raise ApiError(504, "timeout", "timeout")
            raise ApiError(503, "model_not_ready", "engine_down")
        if out.get("outcome") == "timeout":
            raise ApiError(504, "timeout", "timeout")
        if out.get("outcome") != "ok":
            raise ApiError(503, "model_not_ready", out.get("outcome") or "engine_down")
        # 결과를 저장하지 않는다(D8). 규칙 검사 통과 문장·템플릿만 온다(BR-CAP-07)
        return 200, {"body": out["body"], "source": out["source"], "aiAuthored": True,
                     "model": {"id": "M6", "version": v["version_label"]}}, {}
    return _run("caption", request, h)


# ---- 이미지 기능 (비동기) ------------------------------------------------------------------------------
@router.post("/{function}")
async def call_function(function: str, request: Request):
    lim = limits()
    raw = await request.body()          # nginx client_max_body_size 21m이 먼저 막는다
    ctype = request.headers.get("content-type", "")

    def h(conn, key):
        if function not in FUNC_MODEL:                   # 3D(sculpture) 등 없는 기능(D9)
            raise ApiError(404, "not_found", "unknown_function", "G25")
        if len(raw) > lim["max_bytes"] + 64 * 1024:
            raise ApiError(413, "payload_too_large", "too_large", "G24")
        if not ctype.startswith("multipart/form-data"):
            raise ApiError(422, "invalid_input", "multipart_required", "G24")
        msg = BytesParser(policy=HTTP).parsebytes(b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + raw)
        parts = list(msg.iter_parts()) if msg.is_multipart() else []
        names = [p.get_param("name", header="content-disposition") for p in parts]
        if names != ["image"]:                           # 이미지 1장, 다른 필드 없음(additionalProperties false)
            fs = ([] if "image" in names else [{"name": "image", "reason": "required"}]) + \
                 [{"name": n or "(이름 없음)", "reason": "unrecognized"} for n in dict.fromkeys(names) if n != "image"]
            raise ApiError(422, "invalid_input", "image_only", "G24", fields=fs)
        img = parts[0].get_payload(decode=True) or b""
        if len(img) > lim["max_bytes"]:
            raise ApiError(413, "payload_too_large", "too_large", "G24", fields=[{"name": "image", "reason": "too_large"}])
        ext = _sniff(img)
        if not ext:
            raise ApiError(422, "invalid_input", "format", "G24", fields=[{"name": "image", "reason": "format"}])
        with tx(conn) as cur:
            vers = {m: _active(cur, m) for m in NEEDS.get(function, (FUNC_MODEL[function],))}
            if not all(vers.values()):                   # 활성 버전·라이선스 확인 없음 — 작업을 만들지 않는다(G25)
                raise ApiError(503, "model_not_ready", "model_disabled", "G25")
            v = vers[FUNC_MODEL[function]]
            try:
                cur.execute("INSERT INTO external_job (key_id, func, model_version_id) VALUES (%s, %s, %s)",
                            (key.key_id, function, v["version_id"]))
            except Exception as e:
                sig = _signal(e)
                if sig:
                    raise sig
                raise
            jid = cur.lastrowid
            d = load_settings().storage_root / "ext" / str(jid)
            d.mkdir(parents=True, exist_ok=True)
            fd = os.open(d / f"input.{ext}", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o440)
            with os.fdopen(fd, "wb") as f:
                f.write(img)
        return 202, {"jobId": str(jid), "function": function, "status": "queued", "outcome": None,
                     "model": {"id": FUNC_MODEL[function], "version": v["version_label"]}, "durationMs": None, "resultExpiresAt": None}, {}
    return _run(function if function in FUNC_MODEL else "other", request, h, creates_job=True)
