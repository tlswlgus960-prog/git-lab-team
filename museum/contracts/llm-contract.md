# LLM 호출 계약 (P0.5) — 작품 설명 초안 (M6)

**소유**: D(이진우, 4인 분담 2026-09-29 — T127) — `caption/` 패키지 · 호출 경로 B(이제민)
**근거**: FR-27, FR-14, BR-CAP-01~07, D1·D6·D7, SD_01 P4(4.1~4.8)·G13~G16, UC10
**구간**: **P0.5** — P0 완료 뒤 착수. P0에서는 환경 설정 `CAPTION_ENABLED=false`(SD_03 `feature_setting`에는 3D 노출만 있음)로 모든 경로가 404/비노출이다.

## 1. 경로

```
웹(S7) ─POST /v1/artworks/{id}/captions─▶ app-api ─POST /v1/caption (동기)─▶ llm-server 127.0.0.1:8200
외부(P0.5) ─POST /v1/models/caption─▶ model-api ─POST /v1/caption (동기 프록시)─┘   (caption 패키지 import)
                                                                                     └─▶ Ollama 127.0.0.1:11434 (qwen3:4b-instruct-2507-q4_K_M)
```

- **`llm-server`** = 서빙 3종 중 "LLM 서버"의 실행 프로세스(research R-18). Python venv + FastAPI + uvicorn, pm2 이름 `llm-server`, `127.0.0.1:8200` 내부 전용. **큐 워커가 아니다** — `stage_job`을 점유하지 않고 동기 요청만 받는다. P0에서는 띄우지 않는다.
- 경로: `POST /v1/caption`(§2 입력 → §4 출력), `GET /v1/ready`(`model{state, loaded, estimated, loadedUntil, expectedLoadSeconds, maxObservedLoadSeconds, lastLoadSeconds, contextLength, elapsedSeconds, remainingSeconds, overdue}`, `queue{inFlight, waiting}`, `caption{rulesVersion, provisional}` — 2026-09-30 추가, 지금 읽혀 있는 규칙 파일 버전과 임시 여부, research R-26). `/v1/ready`는 **Ollama를 조회하지 않고** 상주 여부를 짐작으로 보고한다(`estimated: true`, 공유 서버 규칙상 `/api/ps` 폴링 금지). 수동 웜업 경로(`POST /v1/warmup`)는 두지 않는다 — M6는 `llm-server` 기동 때 한 번만 미리 올린다(공유 Ollama 규칙).
- 짧은 동기 요청(BR-SRV-01). **시간 상한 두 단계**: app-api → llm-server **30초**(보호자 화면 대기 상한 `[추론 U6]`), llm-server → Ollama **300초 이상**(공유 Ollama 규칙 — 앞 사람 요청 대기 포함). 따라서 공유 서버가 붐비면 app-api 쪽 30초가 먼저 끊기며, 이것은 **정상 동작**이다: app-api는 `timeout`으로 기록하고 재시도 뒤 G15 선택지(template / later / direct)로 간다. `llm-server` 동시 처리 1건. 스트리밍은 쓰지 않는다(쓰게 되면 진행 표시에만, D7).
- 기록: app-api가 호출 전 `stage_job(stage='caption', serving_group='llm', state='running')`을 만들고 응답 `outcome`으로 닫는다(stage-job.md §2·§11). `llm-server`는 DB에 쓰지 않는다.
- 외부 LLM API로 보내지 않는다(BR-CAP-05). 과정 제공 LLM(U3)은 데이터 처리 조건 확인 뒤 `LlmPort` 구현만 바꿔 쓴다.
- Ollama는 `OLLAMA_HOST=127.0.0.1:11434`, 외부 포트 없음(BR-SRV-04).

## 2. 입력 (허용 목록, BR-CAP-01)

app-api가 작품 기록에서 조립한다. **아래 필드 외에는 보내지 않는다.** 이미지·별칭·실명·제목은 넣지 않는다(SD_01 4.3).

```json
{
  "requestId": "stage_job public_id",
  "keywords": ["바다", "파란색"],
  "tags": ["바다"],
  "words": "엄마랑 바다 갔어",
  "ageAtMaking": 5,
  "madeOn": "2026-09-01"
}
```

| 필드 | 출처 | 제약 |
|---|---|---|
| keywords | 보호자 입력 | 1~5개, 각 20자 `[추론]` |
| tags | M2 후보 중 보호자가 고른 것(BR-CAP-06) | 0~5개 |
| words | `artwork.child_words` 원문 | 선택 |
| ageAtMaking, madeOn | 이야기 | 선택 |

keywords와 tags가 모두 비면 app-api가 422(G14, "키워드를 하나 이상 적거나 골라 주세요").

## 3. 처리 (caption 패키지)

1. 프롬프트 조립: 시스템 지시(입력에 없는 사건·감정·발달 상태를 쓰지 말 것, 2~3문장, 해요체) + 입력 JSON. 프롬프트 원문 로그 금지.
2. 생성: 모델 **Qwen3-4B-Instruct-2507**(원천 `Qwen/Qwen3-4B-Instruct-2507`, GGUF Q4_K_M — Ollama 태그 `qwen3:4b-instruct-2507-q4_K_M`, 매니페스트의 블롭 다이제스트와 일치할 때만 호출, research R-22). 호출 옵션 `temperature 0.3`, `num_predict 160`, **`num_ctx 8192` 고정**(공유 Ollama 규칙 — 값이 요청마다 다르면 모델을 다시 올림), `stream: false` `[추론]`. 태그를 바꾼 이유(A 실측, `docs/A/A_모델재현기록.md`): 공유 서버의 `qwen3:4b`는 생각 전용 모델(Thinking-2507)과 같은 블롭이라 `think: false`로도 추론 문장이 섞였다. Instruct-2507은 생각 모드가 없어 `think` 옵션이 필요 없다.
3. **규칙 검사(G16, BR-CAP-02)**: 결과 문장을 검사한다. 걸리는 분류는 `fail_event`(입력에 없는 사건) · `fail_emotion`(입력에 없는 감정) · `fail_development`(발달·재능 평가). 판별 방식은 금지어 사전 + 입력 대조, 초안 하나에 분류 하나(형식 → 지어낸 아이 말 → 발달 → 감정 → 사건 순). **지금 값은 U11 임시 기준표**(`caption/rules.yaml` `tmp-2026-09-30`, research R-26, REF D29) — 확정은 `docs/C_설명규칙검사.md`(U11)에서 하고 같은 파일 교체 + `llm-server` 재시작으로 반영한다.
4. 걸리면 재생성. **재생성 상한 2회** `[추론 U11]` — 총 생성 3회까지. 값은 규칙 파일 `max_regen`. 모두 걸리면 템플릿으로 낮춘다(`llm_to_template`).
5. 템플릿(기준선): `"{ageAtMaking}살 때 그린 작품이에요. {keywords·tags}을/를 그렸어요."` `[추론]` — 을/를은 마지막 낱말 받침으로 고르고(2026-09-30), 없는 필드는 문장에서 뺀다. 문구는 규칙 파일 `template`.
6. 검사를 통과하지 못한 문장·검사 전 문장은 **돌려주지도 저장하지도 않는다**(BR-CAP-07). 실패 분류와 횟수만 돌려준다.

## 4. 출력

```json
{
  "outcome": "ok",
  "source": "llm",
  "body": "5살 때 바다에 다녀온 날을 그린 작품이에요. 파란색으로 바다를 칠했어요.",
  "generationCount": 2,
  "ruleCheck": "pass",
  "ruleFailCount": 1,
  "lastFailClass": "fail_emotion",
  "failClasses": ["fail_emotion"],
  "model": { "id": "M6", "version": "qwen3-4b-instruct-2507-q4_K_M@sha256:<블롭 다이제스트 앞 12자>" }
}
```

| outcome | 뜻 | app-api 처리 |
|---|---|---|
| `ok` + source `llm` | 검사 통과 초안 | `caption` INSERT(`pending_approval`, `ai_authored`=1) |
| `ok` + source `template` | 재생성 상한 초과로 템플릿 | 같음, 설명 낮춤률 분자 |

`failClasses`(2026-09-28 추가, B): 걸린 초안마다 분류 하나, 순서대로(길이 = `ruleFailCount`). app-api가 `caption_check_failure(job_id, failure_class)`를 걸린 초안마다 1행씩 쓰려면(SD_03, 규칙 검사 실패율 분자) 마지막 분류만으로는 부족하다. 값 `fail_event`·`fail_emotion`·`fail_development` → SD_03 `event`·`emotion`·`development`.
| `engine_down`·`timeout`·`model_not_ready` | 인프라 | 짧은 재시도(최대 3회 시도, D1). 소진 시 503 `llm_unavailable` + 선택지 `template`·`later`·`direct`(G15). 결과 미도달·설명 낮춤률에 넣지 않음 |

## 5. 승인·고정 (BR-CAP-04, D6)

- 보호자가 고치면 `edited=1`, `source`는 `llm` 유지(D6). 직접 쓴 설명은 `source='direct'`, "AI 작성" 표시 없음.
- 승인하면 `state='approved'`, 트리거로 본문 고정. 이후 생성 요청은 409 `caption_locked`("승인한 설명은 바뀌지 않아요").
- 승인된 설명을 내리거나 교체하는 절차는 U16 — P0.5 착수 전에 정한다.

## 6. 외부 `caption` 엔드포인트와의 관계

`/v1/models/caption`(model-api.openapi.yaml, P0.5)은 같은 caption 패키지를 쓰되 입력이 외부 요청에서 오고, 결과를 저장하지 않으며(D8), 이미지·이름 필드가 있으면 422다.
