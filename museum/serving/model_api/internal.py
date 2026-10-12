"""model-api 내부 경로(T109, FR-12) — app-api `/ready`와 운영 화면(S11)이 부른다. nginx는 /internal을 내보내지 않는다.

  GET  /internal/ready                     서빙군·런타임 준비(openapi 계약) + models[] 적재 상태(보완)
  GET  /internal/models                    모델별 활성 버전·장치·적재 상태(운영 S11 "모델 상태" 표)
  GET  /internal/console                   운영자용 적재 상태 화면(내부 콘솔)
  POST /internal/models/{model_id}/warmup  지금 불러오기 — 워커에 적재 요청(파일 신호). 202. M6는 409(공유 Ollama 규칙)

적재 상태(model.load.state): disabled · not_loaded · loading · ready · failed (common.model_state).
화면 문구 코드(hint):
  model_loading   "모델을 불러오는 중이에요(약 N초)" — 작업은 큐에서 기다린다. 보호자에게 오류로 보이지 않는다
  model_cold      "처음 요청은 조금 더 걸려요" — M6가 내려갔다고 짐작(마지막 응답 뒤 keep_alive 5분 경과)
  model_failed    운영자에게만: 적재 실패, 대기 작업은 model_not_ready로 재시도
  model_disabled  활성 버전 없음·라이선스 미확인(G25) — 그 모델이 필요한 선택지를 막는다
"""
from __future__ import annotations

import json
import time
import urllib.request

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse

from common.config import load_manifest, load_settings
from common.model_state import describe, read_all

router = APIRouter(prefix="/internal")
MODEL_IDS = ("M1", "M2", "M3", "M5", "M6", "M7")
_PRIORITY = ("loading", "ready", "failed", "not_loaded", "disabled")   # 여러 워커가 있으면 앞의 것을 대표로


def _get_json(url: str, timeout: float = 3.0, method: str = "GET") -> dict | None:
    try:
        req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r) if r.status < 400 else None
    except Exception:
        return None


def _active_versions() -> dict[str, dict]:
    try:
        from common.db import connect, tx
        conn = connect()
        try:
            with tx(conn) as cur:
                cur.execute("""SELECT model_id, version_label, license_confirmed, exec_device, runtime
                                 FROM model_version WHERE release_state = 'active'""")
                return {r["model_id"]: r for r in cur.fetchall()}
        finally:
            conn.close()
    except Exception:
        return {}


def _torchserve_up(url: str) -> bool:
    return _get_json(url.rstrip("/") + "/ping") is not None


def _hint(state: str) -> str | None:
    return {"loading": "model_loading", "not_loaded": "model_loading", "failed": "model_failed",
            "disabled": "model_disabled", "cold": "model_cold"}.get(state)


def models_view() -> dict:
    s = load_settings()
    man = load_manifest(s.manifest_path).get("models", {})
    active = _active_versions()
    workers = read_all(s.run_dir)
    now = time.time()
    out = []
    for mid in MODEL_IDS:
        if mid == "M6":
            continue
        entries = [(w, w["models"][mid]) for w in workers if w["alive"] and mid in w["models"]]
        load = None
        if entries:
            _, best = min(entries, key=lambda e: _PRIORITY.index(e[1]["state"]) if e[1]["state"] in _PRIORITY else 99)
            load = describe(best, now)
        elif mid in active:
            load = {"state": "not_loaded", "expectedSeconds": ((man.get(mid) or {}).get("load") or {}).get("expected_seconds")}
        v = active.get(mid)
        if v is None or not v["license_confirmed"]:
            load = dict(load or {}, state="disabled")
        out.append({"modelId": mid, "activeVersion": v["version_label"] if v else None,
                    "execDevice": v["exec_device"] if v else None, "runtime": v["runtime"] if v else None,
                    "licenseConfirmed": bool(v and v["license_confirmed"]),
                    "workers": len(entries), "load": load, "hint": _hint((load or {}).get("state", "disabled"))})
    llm = _get_json(s.llm_server_url.rstrip("/") + "/v1/ready")
    v6 = active.get("M6")
    m6_load = (llm or {}).get("model") or {"state": "unavailable"}
    if v6 is None or not v6["license_confirmed"]:
        m6_load = dict(m6_load, state="disabled")
    out.append({"modelId": "M6", "activeVersion": v6["version_label"] if v6 else None,
                "execDevice": v6["exec_device"] if v6 else None, "runtime": v6["runtime"] if v6 else None,
                "licenseConfirmed": bool(v6 and v6["license_confirmed"]), "workers": 1 if llm else 0,
                "load": m6_load, "hint": _hint(m6_load.get("state")),
                "queue": (llm or {}).get("queue")})
    return {"models": out, "llm": llm, "workers": [{"worker": w["worker"], "servingGroup": w["serving_group"],
                                                     "alive": w["alive"]} for w in workers]}


@router.get("/console", response_class=HTMLResponse)
def console():
    """운영자용 적재 상태 화면(127.0.0.1 전용). 정식 운영 화면 S11은 C가 web/에 만든다."""
    from pathlib import Path
    return (Path(__file__).parent / "console.html").read_text(encoding="utf-8")


@router.get("/ready")
def ready():
    s = load_settings()
    view = models_view()
    workers = view["workers"]
    alive = {w["servingGroup"] for w in workers if w["alive"]}
    llm = view["llm"]
    body = {
        "groups": {"cpu": "cpu_vision" in alive, "gpu": "gpu" in alive,
                   "llm": bool(llm and llm.get("model", {}).get("state") in ("ready", "cold", "loading"))},
        "runtimes": {"torchserve": _torchserve_up(s.torchserve_url), "ollama": bool(llm and llm.get("ollama"))},
        "gpuEnabled": s.gpu_enabled,
        # 보완(A): 적재 상태 — openapi /internal/ready 스키마에 추가 요청(B)
        "models": view["models"],
    }
    return body


@router.get("/models")
def models():
    return models_view()


@router.post("/models/{model_id}/warmup", status_code=202)
def warmup(model_id: str):
    if model_id not in MODEL_IDS or model_id == "M4":
        raise HTTPException(404, "unknown_model")
    s = load_settings()
    if model_id == "M6":
        # 공유 Ollama: 미리 올리기는 llm-server 기동 때 1회만(가이드 §1.7-10). 그 뒤는 첫 요청이 올린다
        return JSONResponse({"code": "m6_preload_at_start_only",
                             "detail": "M6는 llm-server 기동 때 한 번만 미리 올린다. 내려가 있으면 첫 설명 요청이 올린다"},
                            status_code=409)
    else:
        d = s.run_dir / "warmup"
        d.mkdir(parents=True, exist_ok=True)
        (d / model_id).write_text(str(time.time()))
    return next(m for m in models_view()["models"] if m["modelId"] == model_id)
