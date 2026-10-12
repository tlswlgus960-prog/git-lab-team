"""llm-server — M6(Qwen3-4B-Instruct-2507, Ollama `qwen3:4b-instruct-2507-q4_K_M`) 내부 동기 HTTP 서버(research R-18, llm-contract).

127.0.0.1:8200 전용. 큐 워커가 아니다. DB에 쓰지 않는다(기록은 호출자 app-api).
  POST /v1/caption   허용 입력 → 설명 초안(규칙 검사·재생성 2회·템플릿 낮춤)
  GET  /v1/ready     {ollama, activeVersion, licenseConfirmed, model{state…}, queue{…}} — Ollama를 두드리지 않는다

공유 Ollama 규칙(`docs/참고/Ollama 유저 가이드.md`)에 맞춘 적재 상태 추적:
- 설치·다이제스트·상주 확인(/api/tags·/api/show·/api/ps)은 **기동 때 1회**만 한다(§1.7-6 폴링 금지).
- 미리 올리기도 **기동 때 1회**만(§1.7-10). 운영 화면의 수동 "지금 불러오기"는 M6에 두지 않는다.
- 그 뒤 "올라가 있음"은 추정이다: 마지막 성공 응답 + keep_alive 5분(§1.6). 다른 사용자가 같은 모델을 쓰면
  더 오래 올라가 있을 수 있고, 메모리가 모자라면 서버가 먼저 내릴 수도 있다(§1.4) — 화면에는 "짐작"으로만 쓴다.
- /api/version 헬스체크는 1분에 1회 이하로 캐시한다.
"""
from __future__ import annotations

import asyncio
import os
import re
import threading
import time
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from common.config import load_manifest
from common.logging import get_logger

from . import caption as cap
from . import ollama_client as oc

app = FastAPI(title="uam llm-server", docs_url=None, redoc_url=None, openapi_url=None)
log = get_logger(worker="llm-server")
_sem = asyncio.Semaphore(1)          # 요청 순서(동시 1건은 ollama_client가 강제)
_waiting = 0
KEEP_ALIVE_S = 300
HEALTH_EVERY_S = 60


class ModelState:
    """cold(내려갔다고 짐작) · loading(올리는 중) · ready(올라가 있다고 짐작) · unavailable(Ollama 없음·태그 없음) · disabled(라이선스·다이제스트)"""

    def __init__(self):
        self.lock = threading.Lock()
        self.loading_since: float | None = None
        self.last_load_s: float | None = None
        self.loaded_until: float | None = None    # 마지막 성공 응답 + 5분(또는 기동 때 /api/ps의 expires_at)
        self.health_at = 0.0
        self.ollama_up = False
        self.present = False
        self.digest: str | None = None
        self.context_length: int | None = None
        self.inventoried = False
        self.reinventory_at: float | None = None
        m6 = (load_manifest().get("models") or {}).get("M6") or {}
        self.manifest = m6
        self.expected_s = (m6.get("load") or {}).get("expected_seconds")
        self.max_s = (m6.get("load") or {}).get("observed_max_seconds")

    def version_label(self, digest: str | None) -> str | None:
        return f"qwen3-4b-instruct-2507-q4_K_M@sha256:{digest[:12]}" if digest else None

    # 기동 때 1회 --------------------------------------------------------
    def inventory(self) -> None:
        self.ollama_up = oc.health() is not None
        self.health_at = time.time()
        if self.ollama_up:
            try:
                self.present = oc.CHAT_MODEL in oc.installed_models()
                self.digest = oc.blob_digest(oc.CHAT_MODEL) if self.present else None
                for p in oc.loaded():
                    if p.get("name") == oc.CHAT_MODEL:
                        self.context_length = p.get("context_length")
                        self.loaded_until = _parse_ts(p.get("expires_at"))
            except oc.OllamaError:
                self.ollama_up = False
        self.inventoried = True

    def _health(self) -> None:
        """1분에 1회 이하(§1.7-6)."""
        if time.time() - self.health_at >= HEALTH_EVERY_S:
            self.health_at = time.time()
            self.ollama_up = oc.health() is not None

    # 요청 결과로 갱신(추가 조회 없음) -------------------------------------
    def served(self, load_s: float) -> None:
        with self.lock:
            self.loaded_until = time.time() + KEEP_ALIVE_S
            self.ollama_up = True
            if load_s > 0.5:
                self.last_load_s = round(load_s, 2)

    def not_found(self) -> None:
        """404: 모델이 없어졌다. 같은 요청을 되풀이하지 않고(§1.4) 1분 뒤 설치 목록을 한 번 다시 본다."""
        self.present = False
        self.reinventory_at = time.time() + HEALTH_EVERY_S

    def begin_load(self) -> None:
        with self.lock:
            if self.loading_since is None:
                self.loading_since = time.time()

    def end_load(self) -> None:
        with self.lock:
            self.loading_since = None

    def view(self) -> dict:
        if not self.inventoried or (self.reinventory_at and time.time() >= self.reinventory_at):
            self.reinventory_at = None
            self.inventory()
        self._health()
        want = self.manifest.get("weights_sha256")
        digest_ok = bool(self.digest) and (want is None or want == self.digest)
        lic = bool(self.manifest.get("license_confirmed"))
        now = time.time()
        loaded = bool(self.loaded_until and now < self.loaded_until)
        if not self.ollama_up or not self.present:
            st = "unavailable"
        elif not digest_ok or not lic:
            st = "disabled"
        elif self.loading_since is not None:
            st = "loading"
        elif loaded:
            st = "ready"
        else:
            st = "cold"
        d = {"model": oc.CHAT_MODEL, "state": st, "loaded": loaded, "estimated": True,
             "loadedUntil": _iso(self.loaded_until) if loaded else None,
             "expectedLoadSeconds": self.expected_s, "maxObservedLoadSeconds": self.max_s,
             "lastLoadSeconds": self.last_load_s, "contextLength": self.context_length,
             "elapsedSeconds": None, "remainingSeconds": None, "overdue": False}
        if st == "loading":
            el = now - self.loading_since
            d["elapsedSeconds"] = round(el, 1)
            exp = self.expected_s or self.last_load_s
            if exp and el <= exp * 1.5 + 2:
                d["remainingSeconds"] = round(max(0.0, exp - el), 1)
            elif exp:
                d["overdue"] = True
        return {"ollama": self.ollama_up, "digestMatches": digest_ok, "licenseConfirmed": lic, "model": d}


def _parse_ts(s: str | None) -> float | None:
    """Ollama expires_at(소수점 9자리일 수 있음) → epoch 초."""
    if not s:
        return None
    s = re.sub(r"(\.\d{6})\d+", r"\1", s.replace("Z", "+00:00"))
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def _iso(ts: float | None) -> str | None:
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds") if ts else None


state = ModelState()


def _ready_body() -> dict:
    v = state.view()
    return {"ollama": v["ollama"], "activeVersion": state.version_label(state.digest) if v["digestMatches"] else None,
            "licenseConfirmed": v["licenseConfirmed"], "model": v["model"],
            "queue": {"inFlight": _sem.locked(), "waiting": _waiting},
            "caption": {"rulesVersion": cap.RULES_VERSION, "provisional": cap.RULES_PROVISIONAL}}   # research R-26


@app.get("/v1/ready")
def ready():
    return _ready_body()


def _preload_once() -> None:
    """기동 때 1회(§1.7-10)."""
    state.begin_load()
    try:
        took = oc.preload()
        state.served(took)
        state.last_load_s = round(took, 2)
        log.info("model_load", model_id="M6", load_state="ready", load_ms=int(took * 1000))
    except oc.OllamaError as e:
        if e.kind == "model_not_ready":
            state.not_found()
        log.warning("model_load", model_id="M6", load_state="failed", diagnostic=e.kind)
    finally:
        state.end_load()


def _generate(inp: dict, call) -> dict:
    """규칙 검사 재생성 최대 2회(총 3회). 모두 걸리면 템플릿(llm_to_template). 걸린 문장은 돌려주지 않는다(BR-CAP-07)."""
    fails, last_fail, n = 0, None, 0
    classes: list[str] = []          # 걸린 초안마다 분류 하나(llm-contract §4 failClasses, T145)
    msgs = cap.build_messages(inp)
    for n in range(1, cap.MAX_REGEN + 2):
        out = oc.chat(msgs, options=cap.GEN_OPTIONS, call=call)
        state.served(out["load_s"])
        state.end_load()
        fc = cap.rule_check(out["content"], inp)
        if fc is None:
            return {"source": "llm", "body": out["content"], "generationCount": n, "ruleCheck": "pass",
                    "ruleFailCount": fails, "lastFailClass": last_fail, "failClasses": classes}
        fails, last_fail = fails + 1, fc
        classes.append(fc)
    return {"source": "template", "body": cap.template(inp), "generationCount": n, "ruleCheck": "fail",
            "ruleFailCount": fails, "lastFailClass": last_fail, "failClasses": classes}


@app.post("/v1/caption")
async def caption(request: Request):
    global _waiting
    t0 = time.monotonic()
    body = await request.json()
    inp = cap.allowed_input(body)
    if not inp.get("keywords") and not inp.get("tags"):
        return JSONResponse({"outcome": "invalid_input", "code": "keywords_required"}, status_code=422)
    v = await asyncio.to_thread(state.view)
    st = v["model"]["state"]
    if st == "unavailable":
        return {"outcome": "engine_down" if not v["ollama"] else "model_not_ready", "model": v["model"]}
    if st == "disabled":
        return {"outcome": "model_not_ready", "model": v["model"]}
    _waiting += 1
    try:
        await _sem.acquire()
    finally:
        _waiting -= 1
    try:
        if state.view()["model"]["state"] == "cold":
            state.begin_load()        # 첫 요청이 적재를 겪는다 — 화면은 /v1/ready로 "불러오는 중"을 본다
        call = oc._Call()
        task = asyncio.create_task(asyncio.to_thread(_generate, inp, call))
        while not task.done():
            await asyncio.wait({task}, timeout=0.5)
            if not task.done() and await request.is_disconnected():
                call.cancel()         # 호출자가 끊으면 연결을 닫아 서버 생성도 멈춘다(§1.7-9)
        try:
            res = task.result()
        except oc.OllamaError as e:
            if e.kind == "model_not_ready":
                state.not_found()
            kind = {"model_not_ready": "model_not_ready", "timeout": "timeout", "cancelled": "cancelled"}.get(e.kind, "engine_down")
            log.warning("caption", model_id="M6", outcome=kind, duration_ms=int((time.monotonic() - t0) * 1000))
            return {"outcome": kind}
    finally:
        state.end_load()
        _sem.release()
    log.info("caption", model_id="M6", outcome="ok", rules_version=cap.RULES_VERSION, duration_ms=int((time.monotonic() - t0) * 1000))
    return {"outcome": "ok", **res, "model": {"id": "M6", "version": state.version_label(state.digest)}}


@app.on_event("startup")
def _startup() -> None:
    state.inventory()
    v = state.view()
    log.info("startup", serving_group="llm", load_state=v["model"]["state"], port=8200, rules_version=cap.RULES_VERSION)
    if os.environ.get("LLM_WARM_ON_START", "1") == "1" and v["model"]["state"] == "cold":
        threading.Thread(target=_preload_once, daemon=True).start()
