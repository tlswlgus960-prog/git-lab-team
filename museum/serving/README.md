# serving/ — 모델 서빙 (담당 A 최호준)

워커(`worker-cpu`·`worker-gpu`)·어댑터(M1~M7)·model-api 내부 경로·llm-server. 앱 API는 모델을 import하지 않는다(BR-MDL-02).

```bash
/opt/homebrew/bin/python3.11 -m venv .venv
.venv/bin/pip install --require-hashes -r requirements.lock      # 가짜 모델만: 이것으로 충분
.venv/bin/pip install --require-hashes -r requirements-models.lock   # 실제 M1·M2·M5(torch 등)
.venv/bin/python -m pytest -q                                      # 임시 MariaDB를 스스로 띄운다
UAM_LIVE_OLLAMA=1 .venv/bin/python -m pytest -q -k live            # 공유 Ollama 실호출 1회
UAM_REAL_MODELS=1 MODEL_ROOT=../models .venv/bin/python -m pytest -q tests/test_real_m*.py   # 실제 가중치
```

| 진입점 | 포트 |
|---|---|
| `python -m model_api.main` | 127.0.0.1:9541 — `/internal/ready`, `/internal/models`, `/internal/console` |
| `python -m workers.main --group cpu_vision\|gpu` | — |
| `python -m llm_server.main` (P0.5) | 127.0.0.1:8200 — `/v1/caption`, `/v1/ready`, `/v1/warmup` |
| `python -m ops.models …` | 모델 준비·적재 시간 측정·버전 등록 |

환경 변수: `DB_*`(또는 `DB_SOCKET`), `STORAGE_ROOT`, `MODEL_MANIFEST`, `UAM_RUN_DIR`, `UAM_FAKE_MODELS`(1 또는 `M3,M7` 목록), `UAM_FAKE_FAULTS`, `M1_REVISION`·`M2_REVISION`·`M5_REVISION`(매니페스트보다 우선), `M3_AD_PYTHON`·`M3_AD_ROOT`·`FFMPEG`, `TORCHSERVE_URL`, `UAM_FAKE_LOAD_S`, `GPU_ENABLED`, `OLLAMA_URL`, `OLLAMA_CHAT_MODEL`, `LLM_SERVER_URL`, `LLM_WARM_ON_START`.
Ollama는 공유 서버다 — `docs/참고/Ollama 유저 가이드.md`(원본 `/Users/Shared/ollama/ollama-user-guide.md`) 규칙을 따른다: `num_ctx` 8192 고정, `keep_alive` 5m, 동시 1건, `/api/ps`·`/api/tags` 폴링 금지, 미리 올리기는 기동 때 1회, 런타임에 pull·rm·stop 없음, `qwen3:4b` 대신 `qwen3:4b-instruct-2507-q4_K_M`.
