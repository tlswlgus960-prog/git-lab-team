"""공유 Ollama 서버 클라이언트 — `docs/참고/Ollama 유저 가이드.md`(원본 /Users/Shared/ollama/ollama-user-guide.md) §2.2 템플릿을 따른다.

가이드 규칙을 코드로 강제한다(표준 라이브러리만):
- num_ctx 8192 고정(모든 요청·미리 올리기 포함). 다른 값은 받지 않는다 — 다르면 공용 모델이 다시 올라간다(§1.3, §1.7-1)
- num_predict 기본 1024, 호출자가 더 줄일 수 있다(§1.7-2)
- keep_alive "5m"(A등급 상한, -1·긴 상주 금지, §1.6)
- 프로세스당 동시 요청 1건 — 이 모듈의 잠금(§1.7-5). llm_server.app의 대기열은 그 앞에서 순서만 센다
- 연결 오류·시간 초과만 3초·6초 뒤 재시도, 4xx는 즉시 실패, 타임아웃 300초(§2.3)
- think:false, 새어 나온 </think> 앞부분은 잘라낸다(§1.4). 모델은 `qwen3:4b-instruct-2507-q4_K_M`
  (`qwen3:4b`는 사고 모드가 꺼지지 않아 가이드 §1.2 "사용하지 않는 모델")
- /api/ps·/api/tags·/api/show는 폴링하지 않는다 — 기동 때와 운영 CLI에서만(§1.7-6). /api/version은 호출자가 1분에 1회 이하로
- 런타임 코드에는 pull·create·rm·stop·serve·push, 공용 모델 keep_alive:0이 없다(§2.4)
- 연결을 닫으면 서버도 생성을 멈춘다 — 호출자 취소에 쓴다(§1.7-9)
"""
from __future__ import annotations

import http.client
import json
import os
import re
import socket
import threading
import time
import urllib.parse

# localhost 금지: localhost는 IPv6 ::1로 붙는데, 이 호스트에서는 ::1에 설정만 있고 요청을 받지 않는
# 두 번째 Ollama 인스턴스가 떠 있다. 실제 공유 서버는 IPv4 127.0.0.1에만 있다(2026-09-28 실측)
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
CHAT_MODEL = os.environ.get("OLLAMA_CHAT_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
NUM_CTX = 8192        # 고정값. 모두가 같은 값을 써야 올라가 있는 모델을 공유한다
NUM_PREDICT = 1024    # 출력 길이 기본 상한
KEEP_ALIVE = "5m"
TIMEOUT = 300
_sleep = time.sleep          # 시험에서 바꿔 끼운다
_lock = threading.Semaphore(1)   # 프로세스당 동시 요청 1건(미리 올리기와 생성이 겹치지 않게)
_THINK = re.compile(r"<think>.*?</think>\s*", re.S)


class OllamaError(Exception):
    """kind: engine_down(연결 실패·5xx·재시도 소진) · timeout · model_not_ready(404) · bad_request(400) · cancelled"""

    def __init__(self, kind: str, status: int | None = None):
        super().__init__(kind)
        self.kind = kind
        self.status = status


class _Call:
    """취소할 수 있는 한 번의 HTTP 호출 — 연결을 닫으면 Ollama가 생성을 멈춘다(llm-contract §11 취소)."""

    def __init__(self):
        self.conn: http.client.HTTPConnection | None = None
        self.cancelled = threading.Event()

    def cancel(self) -> None:
        self.cancelled.set()
        c = self.conn
        if c is not None:
            try:
                c.sock and c.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            c.close()


def _once(method: str, path: str, payload: dict | None, call: _Call | None, timeout: float) -> dict:
    u = urllib.parse.urlparse(OLLAMA_URL)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    if call is not None:
        call.conn = conn
    try:
        body = json.dumps(payload).encode() if payload is not None else None
        conn.request(method, (u.path.rstrip("/") + path), body=body, headers={"Content-Type": "application/json"})
        r = conn.getresponse()
        data = r.read()
        if r.status >= 400:
            raise OllamaError("model_not_ready" if r.status == 404 else "bad_request" if r.status == 400 else "http_5xx",
                              r.status)
        return json.loads(data or b"{}")
    finally:
        conn.close()


def _request(method: str, path: str, payload: dict | None = None, retries: int = 3,
             call: _Call | None = None, timeout: float = TIMEOUT) -> dict:
    for attempt in range(retries):
        if call is not None and call.cancelled.is_set():
            raise OllamaError("cancelled")
        try:
            return _once(method, path, payload, call, timeout)
        except OllamaError as e:
            if e.kind != "http_5xx":
                raise                              # 4xx: 재시도해도 같은 결과
            last = OllamaError("engine_down", e.status)
        except (socket.timeout, TimeoutError):
            last = OllamaError("timeout")
        except (ConnectionError, OSError, http.client.HTTPException):
            if call is not None and call.cancelled.is_set():
                raise OllamaError("cancelled")
            last = OllamaError("engine_down")
        if attempt == retries - 1:
            raise last
        time.sleep(2 ** attempt * 3)               # 3초, 6초
    raise OllamaError("engine_down")


def _strip_think(text: str) -> str:
    text = _THINK.sub("", text)
    return text.split("</think>", 1)[1] if "</think>" in text else text   # 여는 태그 없이 새어 나온 경우


def chat(messages: list[dict], model: str = CHAT_MODEL, options: dict | None = None,
         call: _Call | None = None, json_mode: bool = False) -> dict:
    """{content, load_s, total_s} — load_s는 Ollama가 알려 준 적재 시간(이미 올라가 있었으면 0에 가깝다)."""
    opts = {k: v for k, v in (options or {}).items() if k != "num_ctx"}
    opts["num_ctx"] = NUM_CTX
    opts["num_predict"] = min(int(opts.get("num_predict", NUM_PREDICT)), NUM_PREDICT)
    msgs = [dict(m) for m in messages]
    if model.startswith("qwen3") and msgs and msgs[-1]["role"] == "user" and not msgs[-1]["content"].rstrip().endswith("/no_think"):
        msgs[-1]["content"] = msgs[-1]["content"].rstrip() + " /no_think"
    body = {"model": model, "messages": msgs, "stream": False, "think": False,
            "keep_alive": KEEP_ALIVE, "options": opts}
    if json_mode:
        body["format"] = "json"
    with _lock:
        out = _request("POST", "/api/chat", body, call=call)
    return {"content": _strip_think(out.get("message", {}).get("content", "")).strip(),
            "load_s": (out.get("load_duration") or 0) / 1e9, "total_s": (out.get("total_duration") or 0) / 1e9}


# ── 서버 조회 — 폴링 금지(§1.7-6). 기동 때·운영 CLI에서만 부른다 ───────────────
def health() -> str | None:
    """서버 버전. 호출자가 1분에 1회 이하로 부른다."""
    try:
        return _request("GET", "/api/version", retries=1, timeout=3).get("version")
    except OllamaError:
        return None


version = health


def installed_models() -> list[str]:
    """설치된 모델 이름(:cloud 제외)."""
    return [m["name"] for m in _request("GET", "/api/tags", retries=1, timeout=5).get("models", [])
            if not m["name"].endswith("cloud")]


def loaded() -> list[dict]:
    """/api/ps — 메모리에 올라간 모델: name, context_length, expires_at."""
    return _request("GET", "/api/ps", retries=1, timeout=5).get("models", [])


def blob_digest(model: str = CHAT_MODEL) -> str | None:
    """`ollama show --modelfile`의 FROM 블롭 다이제스트(R-22 weights_sha256). 경로는 밖으로 내보내지 않는다."""
    info = _request("POST", "/api/show", {"model": model}, retries=1, timeout=10)
    m = re.search(r"^FROM\s+\S*sha256-([0-9a-f]{64})", info.get("modelfile", ""), re.M)
    return m.group(1) if m else None


def preload(model: str = CHAT_MODEL) -> float:
    """서비스 시작 때 1회만 미리 올린다(§1.6, §1.7-10). 걸린 초를 돌려준다.

    num_ctx는 실제 호출과 같은 8192 — 다르면 첫 실제 호출에서 다시 올라간다(2026-09-28 실측 2.9초 재적재).
    """
    t = time.monotonic()
    with _lock:
        _request("POST", "/api/generate", {"model": model, "keep_alive": KEEP_ALIVE, "stream": False,
                                           "options": {"num_ctx": NUM_CTX}})
    return time.monotonic() - t
