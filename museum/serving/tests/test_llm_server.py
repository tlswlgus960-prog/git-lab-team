"""T126 — llm-server와 Ollama 클라이언트. 가짜 Ollama로 규칙을 확인하고, UAM_LIVE_OLLAMA=1이면 공유 서버로 1회 실호출."""
from __future__ import annotations

import importlib
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

DIGEST = "85e4a5b7b8ef0e48af0e8658f5aaab9c2324c76c1641493f4d1e25fce54b18b9"


def oc_model():
    return os.environ.get("OLLAMA_CHAT_MODEL", "qwen3:4b-instruct-2507-q4_K_M")


class FakeOllama:
    def __init__(self):
        self.requests: list[tuple[str, dict]] = []
        self.replies = ["5살 때 바다를 그린 작품이에요. 파란색으로 칠했어요."]
        self.chat_status = 200
        self.loaded = False
        self.load_delay = 0.0
        srv = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

            def do_GET(self):
                srv.requests.append((self.path, {}))
                if self.path == "/api/version":
                    return self._send(200, {"version": "0.34.0"})
                if self.path == "/api/tags":
                    return self._send(200, {"models": [{"name": oc_model()}]})
                if self.path == "/api/ps":
                    return self._send(200, {"models": [{"name": oc_model(), "expires_at": "2026-09-28T16:28:12.585369123+09:00", "context_length": 8192}] if srv.loaded else []})
                self._send(404, {})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"] or 0)) or b"{}")
                srv.requests.append((self.path, body))
                if self.path == "/api/show":
                    return self._send(200, {"modelfile": f"FROM /secret/blobs/sha256-{DIGEST}\n"})
                if self.path == "/api/generate":
                    time.sleep(srv.load_delay); srv.loaded = True
                    return self._send(200, {"done": True})
                if self.path == "/api/chat":
                    if srv.chat_status != 200:
                        return self._send(srv.chat_status, {"error": "x"})
                    load = 0 if srv.loaded else int(2.9e9)
                    srv.loaded = True
                    text = srv.replies.pop(0) if len(srv.replies) > 1 else srv.replies[0]
                    return self._send(200, {"message": {"content": text}, "load_duration": load})
                self._send(404, {})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def chats(self):
        return [b for p, b in self.requests if p == "/api/chat"]


@pytest.fixture()
def llm(monkeypatch, tmp_path):
    fake = FakeOllama()
    man = tmp_path / "manifest.yaml"
    man.write_text(f"models:\n  M6:\n    weights_sha256: {DIGEST}\n    license_confirmed: true\n    load: {{expected_seconds: 13.47}}\n")
    monkeypatch.setenv("OLLAMA_URL", fake.url)
    monkeypatch.setenv("MODEL_MANIFEST", str(man))
    monkeypatch.setenv("LLM_WARM_ON_START", "0")
    import llm_server.ollama_client as oc
    importlib.reload(oc)
    import llm_server.app as appmod
    importlib.reload(appmod)
    monkeypatch.setattr(oc, "_sleep", lambda s: None)   # 재시도 3초·6초를 건너뛴다
    yield fake, appmod, man
    fake.httpd.shutdown()


def test_caption_ok_follows_shared_server_rules(llm):
    fake, appmod, _ = llm
    c = TestClient(appmod.app)
    r = c.post("/v1/caption", json={"keywords": ["바다"], "ageAtMaking": 5, "alias": "하늘", "title": "비밀"}).json()
    assert r["outcome"] == "ok" and r["source"] == "llm" and r["generationCount"] == 1
    assert r["model"]["version"] == f"qwen3-4b-instruct-2507-q4_K_M@sha256:{DIGEST[:12]}"
    body = fake.chats()[0]
    assert body["think"] is False and body["stream"] is False and body["keep_alive"] == "5m"
    assert body["options"]["num_ctx"] == 8192 and body["options"]["num_predict"] == 160   # 가이드 §1.3 고정값
    assert body["messages"][-1]["content"].endswith("/no_think")
    sent = json.dumps(body, ensure_ascii=False)
    assert "하늘" not in sent and "비밀" not in sent        # 허용 목록 밖 필드는 보내지 않는다(BR-CAP-01)


def test_think_block_stripped_and_rule_fail_to_template(llm):
    fake, appmod, _ = llm
    fake.replies = ["", "", ""]                               # 규칙 검사 3회 실패
    r = TestClient(appmod.app).post("/v1/caption", json={"keywords": ["바다"], "tags": ["사람"], "ageAtMaking": 5}).json()
    assert (r["outcome"], r["source"], r["generationCount"], r["ruleFailCount"]) == ("ok", "template", 3, 3)
    assert r["failClasses"] == ["fail_event"] * 3             # 걸린 초안마다 분류 하나(T145)
    assert r["body"] == "5살 때 그린 작품이에요. 바다·사람을 그렸어요."    # caption 패키지 템플릿(T127, 을/를 받침)
    import llm_server.ollama_client as oc
    fake.replies = ["<think>생각</think>\n좋아요."]
    assert oc.chat([{"role": "user", "content": "x"}])["content"] == "좋아요."


def test_caption_package_rules_used(llm):
    """T127: llm-server가 저장소 루트 caption/ 패키지를 쓴다 — 규칙 버전이 /v1/ready에 보이고 내용 규칙이 걸린다."""
    fake, appmod, _ = llm
    c = TestClient(appmod.app)
    assert c.get("/v1/ready").json()["caption"] == {"rulesVersion": "tmp-2026-09-30", "provisional": True}
    fake.replies = ["바다를 그렸어요. 아이가 행복해 보여요.", "5살 때 바다를 그린 작품이에요."]
    r = c.post("/v1/caption", json={"keywords": ["바다"], "ageAtMaking": 5}).json()
    assert (r["source"], r["generationCount"], r["failClasses"]) == ("llm", 2, ["fail_emotion"])
    assert "행복" not in json.dumps(r, ensure_ascii=False)          # 걸린 초안은 돌려주지 않는다(BR-CAP-07)


def test_errors_classified(llm):
    fake, appmod, _ = llm
    c = TestClient(appmod.app)
    fake.chat_status = 404
    assert c.post("/v1/caption", json={"keywords": ["a"]}).json()["outcome"] == "model_not_ready"
    n = len(fake.chats())
    assert c.post("/v1/caption", json={"keywords": ["a"]}).json()["outcome"] == "model_not_ready"
    assert len(fake.chats()) == n                             # 404 뒤에는 같은 요청을 되풀이하지 않는다
    appmod.state.reinventory_at = time.time() - 1             # 1분 지남 → 설치 목록 한 번 다시 확인
    fake.chat_status = 500
    assert c.post("/v1/caption", json={"keywords": ["a"]}).json()["outcome"] == "engine_down"
    assert len(fake.chats()) - n == 3                         # 5xx만 3회까지
    fake.chat_status = 400
    n = len(fake.chats())
    assert c.post("/v1/caption", json={"keywords": ["a"]}).json()["outcome"] == "engine_down"
    assert len(fake.chats()) - n == 1                         # 400은 재시도 안 함
    assert c.post("/v1/caption", json={"words": "x"}).status_code == 422


def test_preload_once_at_start_then_no_polling(llm):
    """가이드 §1.7-6·10: 미리 올리기는 기동 때 1회, 그 뒤 /v1/ready는 Ollama를 두드리지 않는다."""
    fake, appmod, _ = llm
    fake.load_delay = 0.6
    import os as _os
    _os.environ["LLM_WARM_ON_START"] = "1"
    try:
        with TestClient(appmod.app) as c:
            time.sleep(0.2)
            m = c.get("/v1/ready").json()["model"]
            assert m["state"] == "loading" and m["expectedLoadSeconds"] == 13.47 and m["remainingSeconds"] is not None
            time.sleep(0.7)
            before = list(fake.requests)
            for _ in range(20):
                r = c.get("/v1/ready").json()
            m = r["model"]
            assert m["state"] == "ready" and m["estimated"] and m["loadedUntil"] and m["lastLoadSeconds"] >= 0.5
            polled = [p for p, _ in fake.requests[len(before):]]
            assert polled == []                               # ps·tags·show·version 모두 0회
            assert c.post("/v1/warmup").status_code in (404, 405)   # 수동 웜업 경로 없음
    finally:
        _os.environ["LLM_WARM_ON_START"] = "0"
    gens = [b for p, b in fake.requests if p == "/api/generate"]
    assert len(gens) == 1 and gens[0]["keep_alive"] == "5m" and gens[0]["options"]["num_ctx"] == 8192
    startup = [p for p, _ in fake.requests if p in ("/api/ps", "/api/tags", "/api/show")]
    assert sorted(startup) == ["/api/ps", "/api/show", "/api/tags"]   # 기동 때 한 번씩


def test_estimated_cold_after_keep_alive(llm):
    fake, appmod, _ = llm
    c = TestClient(appmod.app)
    assert c.get("/v1/ready").json()["model"]["state"] == "cold"
    assert c.post("/v1/caption", json={"keywords": ["바다"]}).json()["outcome"] == "ok"
    m = c.get("/v1/ready").json()["model"]
    assert m["state"] == "ready" and m["lastLoadSeconds"] == 2.9      # Ollama load_duration으로 적재 시간 기록
    appmod.state.loaded_until = time.time() - 1                       # keep_alive 5분 지남
    assert c.get("/v1/ready").json()["model"]["state"] == "cold"


def test_health_at_most_once_a_minute(llm):
    fake, appmod, _ = llm
    c = TestClient(appmod.app)
    c.get("/v1/ready")
    n = sum(p == "/api/version" for p, _ in fake.requests)
    for _ in range(10):
        c.get("/v1/ready")
    assert sum(p == "/api/version" for p, _ in fake.requests) == n
    appmod.state.health_at -= 61
    c.get("/v1/ready")
    assert sum(p == "/api/version" for p, _ in fake.requests) == n + 1


def test_client_forces_guide_constants(llm):
    fake, appmod, _ = llm
    import llm_server.ollama_client as oc
    oc.chat([{"role": "user", "content": "x"}], options={"num_ctx": 131072, "num_predict": 99999})
    b = fake.chats()[-1]
    assert b["options"]["num_ctx"] == 8192 and b["options"]["num_predict"] == 1024 and b["think"] is False
    fake.replies = ["생각 과정...</think>\n답이에요."]                  # 여는 태그 없이 새어 나온 경우(가이드 §1.4)
    assert oc.chat([{"role": "user", "content": "x"}])["content"] == "답이에요."


def test_license_or_digest_blocks(llm, monkeypatch):
    fake, appmod, man = llm
    man.write_text("models:\n  M6:\n    weights_sha256: " + "f" * 64 + "\n    license_confirmed: true\n")
    import importlib
    importlib.reload(appmod)
    c = TestClient(appmod.app)
    assert c.get("/v1/ready").json()["model"]["state"] == "disabled"
    assert c.post("/v1/caption", json={"keywords": ["a"]}).json()["outcome"] == "model_not_ready"
    assert fake.chats() == []


def test_no_model_management_calls_in_runtime_code():
    """§8.4: 런타임 코드에 pull·create·rm·stop·serve·push 호출이 없다."""
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    for f in list((root / "llm_server").glob("*.py")) + list((root / "workers").rglob("*.py")) + list((root / "model_api").glob("*.py")):
        s = f.read_text()
        for bad in ("/api/pull", "/api/create", "/api/delete", "/api/push", "/api/copy", "ollama serve", "ollama stop",
                    '"keep_alive": -1', "keep_alive=-1", '"keep_alive": 0', "/v1/chat/completions"):
            assert bad not in s, (f.name, bad)


@pytest.mark.skipif(os.environ.get("UAM_LIVE_OLLAMA") != "1", reason="공유 Ollama 실호출은 UAM_LIVE_OLLAMA=1일 때만")
def test_live_shared_ollama_once(monkeypatch):
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:11434")
    import llm_server.ollama_client as oc
    importlib.reload(oc)
    from llm_server import caption as cap
    inp = {"keywords": ["바다", "파란색"], "ageAtMaking": 5}
    t = time.monotonic()
    out = oc.chat(cap.build_messages(inp), options=cap.GEN_OPTIONS)
    assert out["content"] and "<think>" not in out["content"] and "</think>" not in out["content"]
    assert not out["content"].lstrip().lower().startswith(("okay", "let me", "let's"))   # 태그 없는 생각 과정 누출
    assert any("가" <= ch <= "힣" for ch in out["content"])
    print(f"\nlive: {time.monotonic() - t:.1f}s load={out['load_s']:.1f}s :: {out['content']}")
