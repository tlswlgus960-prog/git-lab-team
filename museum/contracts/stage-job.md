# 단계 작업 계약 (Stage-Job Contract) — app-api ↔ 서빙군

**소유**: B(이제민) · 워커 절 공동 작성 A(최호준) — `docs/공통/역할분담.md` 경계 계약 1
**근거**: FR-4·5·23·25, BR-API-02, BR-PRC-01~08, BR-FBK-01~04, BR-SRV-01~03, D1·D2·D4·D11, SD_01 P0(0.1~0.12)·H2~H6·H12·H13
**데이터**: `design/uri_gallery_ddl.sql`(SD_03 정본) `stage_job`·`judgment`·`result`·`artwork_outcome` + [data-model.md](../data-model.md) §2.2·§6(보완 S1~S4)
**개정**: 2026-09-28 — SD_03 이름·값으로 전면 교체(이전 초안의 `segment`/`animate`/`relief`, `succeeded`/`downgraded`, `artwork_result`는 쓰지 않음)

> "작업 계약 하나"(FR-25): 세 서빙군(CPU 비전·GPU·LLM)은 모두 `stage_job` 기록과 같은 응답 분류로 끝난다. app-api는 모델을 import하지 않는다(BR-MDL-02). 워커는 어댑터를 통해서만 모델을 부른다. 전달 방식은 CPU·GPU가 **큐**, LLM이 **동기 HTTP**(§11)다.

## 1. 전달 방식

- 큐 = MariaDB `stage_job` 테이블(research R-04). 메시지 브로커 없음.
- app-api → 워커: 행 INSERT(`status='queued'`)와 `cancel_requested_at` 기록만.
- 워커 → app-api: `stage_job` 실행 컬럼, `judgment`·`tag_candidate`·`result`·`stored_object`, `artwork.status`의 워커 전이, `artwork_outcome.result_kind/result_cause`(data-model §3). HTTP 콜백 없음.
- 화면은 app-api `GET /v1/artworks/{id}`(→ `v_artwork_display`, `v_job_progress`)를 폴링한다(research R-12).

## 2. 작업 종류 (`stage_kind`)

| stage_kind | 모델 | serving_group | 입력 | 출력 | 결과 단계? |
|---|---|---|---|---|---|
| `split` | M1 BiRefNet | `cpu_vision` | 원본(`artwork_original`) | `stored_object(mask, cutout)`, `judgment.split_ok/mask_object_id/cutout_object_id` | 아님 |
| `judge` | M2 OpenCLIP + M3 관절 + M4 규칙 | `cpu_vision` | 원본, 컷아웃(있으면) | `judgment.kind_candidate/geometry_pass/person_score/suggestion/suggestion_state`, `joints_object_id`, `tag_candidate` | 아님 |
| `animate_render` | M3 Animated Drawings | `cpu_vision` | 원본, 관절 | `stored_object(result_animated)` MP4 → `result(animated)` | **예** |
| `depth_relief` | M1 마스크 + M5 Depth Anything V2 Small | `gpu`(GPU 없으면 `cpu_vision`) | 컷아웃 | `stored_object(depth, result_relief)` → `result(relief)` | **예** |
| `frame_compose` | 없음(`model_version_id` NULL) | `cpu_vision` | 원본 | `result(frame, object_id=NULL)` — 새 파일 없음, 원본 참조(research R-07) | 예(실패하지 않음) |
| `sculpture` (P1) | M7 TripoSR | `gpu` | 컷아웃 | `stored_object(result_glb)` → `result(sculpture)` | **예** |
| `caption` (P0.5) | M6 Qwen3-4B | `llm` | 허용 필드(llm-contract.md) | `caption` 행, `caption_check_failure` | 아님 — **큐로 전달하지 않음**(§11) |

**M1 마스크(D56)**: `split`의 마스크·컷아웃 알파는 닫힌 구멍을 채운 뒤 값이다(전경 비율도 채운 마스크 기준). 외부 `segment`(§9)도 같은 어댑터라 같은 값을 준다.

**모델 버전 기록**: app-api는 작업을 만들 때 그 단계 대표 모델(`split` M1 · `judge` M2 · `animate_render` M3 · `depth_relief` M5 · `sculpture` M7)의 활성 버전을 `model_version_id`에 적는다(`chk_sj_model_required`, `trg_stage_job_bi`). 활성 버전이 없으면 작업을 만들지 않는다: 판정 모델(M1·M2·M3) 중 하나라도 비활성이면 `split`·`judge`를 만들지 않고 `judgment(suggestion_state='exhausted')`를 기록해 `awaiting_confirm`으로 둔다(보호자 직접 확정, clarify 2026-09-28). 결과 모델이 비활성이면 그 확정 선택지를 막는다(openapi `unavailableChoices`).

**판정 전 확정의 순서(2026-09-28 추가)**: 보호자는 판정 중에도 확정할 수 있다(BR-SUG-05). 이때 판정 결과(마스크·컷아웃·관절)가 필요한 결과 작업(`animate_render`·`depth_relief`·`sculpture`)은 `available_at`을 먼 미래로 등록해 잠가 둔다. **워커가 `judge`를 닫을 때(성공·품질 미달·소진 모두) 같은 작품의 잠긴 `origin='confirm'` 작업을 연다**(`available_at=UTC_TIMESTAMP()`). 열 때 `relief` 확정인데 `split_ok`가 TRUE가 아니면 `depth_relief`를 `done_downgraded`·`split_fail`로 닫고 `frame_compose`를 등록한다(§6 넷째 줄과 같은 결과). `frame_compose`는 판정 결과가 필요 없어 잠그지 않는다. 판정 모델이 비활성이라 판정 작업이 없으면 잠그지 않고 곧바로 연다.

`split`과 `judge`는 접수 트랜잭션에서 함께 등록하되 `judge.available_at`(보완 S1)을 먼 미래로 두고, `split`이 끝나면(성공·낮춤·소진 모두) 워커가 `available_at=UTC_TIMESTAMP()`로 연다 `[추론]`. `frame_compose`는 모델이 없어 M3·M5가 멈춰도 동작한다(BR-PRC-01, FR-3).

## 3. 워커 생명주기

```text
claim ──▶ run(adapter) ──▶ classify outcome ──▶ commit
  │            │ heartbeat 20s: claim_expires_at 연장 + cancel 확인
  │            └─ cancel 감지 → 하위 프로세스 중단 → cancelled
  └─ SELECT … FOR UPDATE SKIP LOCKED
       WHERE serving_group=? AND status IN ('queued','retry_wait') AND available_at<=UTC_TIMESTAMP()
       ORDER BY priority, queued_at
```

1. **점유(0.1)**: 행 잠금 → `status='running'`, `attempt_count+1`, `claimed_by`, `claim_expires_at=+60s`, `started_at`(첫 시도), `model_version_id` = 해당 모델의 `release_state='active'` 버전(트리거 `trg_stage_job_bi`는 등록 시점에도 활성 버전을 강제). 작품이 `deleting`이거나 `cancel_requested_at`이 있으면 실행하지 않고 `cancelled` + `stopped_at`(D4).
2. **준비 확인**: 활성 버전이 없거나 `license_confirmed=FALSE`면 어댑터를 부르지 않고 `model_not_ready`(인프라, 재시도 대상). 등록 시점에 활성 버전이 없는 모델(평가 담당이 비활성화한 모델 포함)의 단계는 app-api가 **작업을 만들지 않는다** — 그 모델이 필요한 확정 선택지를 이유와 함께 막고(clarify `ee62c57`), 판정 모델이 비활성이면 제안 없이 직접 확정한다. 이미 대기 중이던 작업만 실행 시점 확인에서 `model_not_ready` 규칙을 따른다. 낮춤 체인으로 우회하지 않는다(BR-FBK-04).
3. **실행(0.7)**: 어댑터 `run(input) -> AdapterResult`. 시간 상한 초과 시 워커가 중단하고 `timeout`. 원본은 읽기 전용(BR-INT-04).
4. **결과 쓰기 직전 재확인(0.11)**: `SELECT status FROM artwork … FOR UPDATE`가 `deleting`이면 쓰지 않고 `cancelled`.
5. **커밋(0.10)**: §4·§5·§6 규칙대로 한 트랜잭션.
6. **임시 파일 정리(0.12, BR-PRC-08)**: 성공·낮춤·실패·취소 모두 `tmp/{job_id}/` 삭제.

이어받기(BR-PRC-05): sweeper가 `status='running' AND claim_expires_at<UTC_TIMESTAMP()`를 찾아 `attempt_count<3`이면 `retry_wait`(available_at=now), `=3`이면 소진 처리(§4.3). `deleting` 작품의 작업은 `cancelled`로 닫는다.

## 4. 응답 분류 (BR-API-02 — 어댑터 응답 ↔ `stage_job` 1:1)

### 4.1 어댑터 응답 형식 (Python)

```python
@dataclass(frozen=True)
class AdapterResult:
    outcome: Literal["ok", "quality_below", "engine_down", "timeout",
                     "storage", "db", "model_not_ready"]
    downgrade_cause: str | None = None  # quality_below일 때 SD_03 코드(§6)
    score: float | None = None          # 기록용 0~1(judgment.person_score, eval_item_result.score DECIMAL(5,4), D50). API로 내보내지 않음
    outputs: dict[str, str] = field(default_factory=dict)  # object_kind → tmp 경로
    diagnostic: str | None = None       # 정해진 코드만. 예외 원문 금지(BR-PRV-01)
```

어댑터는 예외를 밖으로 던지지 않는다. 알 수 없는 예외는 워커가 `engine_down`으로 분류한다. `cancelled`는 워커가 붙인다.

### 4.2 분류별 기록

| outcome | `status` | `error_class` | `downgrade_cause` | 다음 |
|---|---|---|---|---|
| `ok` | `done` | NULL | NULL | §5 |
| `quality_below` | `done_downgraded` | NULL | §6 코드 | **재시도 없이** §6(BR-PRC-02, `trg_stage_job_bu` — 인프라 재시도 뒤 시도에서 낮추는 것은 허용, SD_03 §19 #19) |
| `engine_down`·`timeout`·`storage`·`db`·`model_not_ready` | `retry_wait`(attempt<3, available_at=+10s·+60s) · `failed`(attempt=3) | outcome | NULL | 소진 시 §4.3 |
| `cancelled` | `cancelled` (+`stopped_at`) | NULL | NULL | 지표 제외(`v_metrics_model`), G19 해제 |

재시도율은 `attempt_count>1`로 계산한다(`v_metrics_model`). `db`는 워커가 DB 갱신에 실패했을 때 다음 연결에서 기록한다.

### 4.3 재시도 소진 처리 (D1)

| stage_kind | 소진 시 | 집계 |
|---|---|---|
| `split` | `judgment.split_ok=NULL`(마스크 없음), `judge`를 연다 | 인프라 실패만 |
| `judge` | `judgment.suggestion_state='exhausted'`, `artwork.status='awaiting_confirm'`(G7, 보호자 직접 확정) | 인프라 실패만. 확정 시 `suggestion_at_confirm='none'` → 판정 수정률 분모 제외(D14) |
| `animate_render`·`depth_relief`·`sculpture` (origin ≠ `use_lower`) | `artwork.status='failed'`(처리하지 못함, G9), `artwork_outcome.result_cause='not_delivered'` | 결과 미도달 +1(`v_metrics_service`, `v_not_delivered_trace`) |
| `depth_relief` (origin=`use_lower`, H6) | 처음 결과를 둔 채 `awaiting_review`로 복귀 | 인프라 실패만(미도달 아님) |
| `caption` | 보호자 선택지 template / later / direct(§11) | 인프라 실패만 |

## 5. 성공 전이

| stage_kind | 기록 |
|---|---|
| `split` ok | `stored_object(mask, cutout)`, `judgment.split_ok=TRUE` + 객체 참조, `judge` 열기 |
| `split` quality_below | `judgment.split_ok=FALSE`, `downgrade_cause='split_fail'`, `judge` 열기 — 제안은 계속(FR-20). 제안은 `frame`만 가능(`chk_jd_split_fail_frame`) |
| `judge` ok | `judgment`(종류·기하·점수·제안, `suggestion_state='presented'`), `tag_candidate`, 관절 객체, `artwork.status='awaiting_confirm'` — 이미 확정됐으면(판정 중 직접 확정) 상태는 두고 제안값만 기록. 이 경우 `artwork_outcome.suggestion_at_confirm`은 확정 시점의 `before`로 남는다(D14) |
| 결과 단계 ok | `stored_object` + `result`(`uq_rs_first`), `artwork_outcome.result_kind`, `result_cause`(확정이 `relief`·`frame`이면 `guardian_choice`, `animated` 그대로면 NULL), `artwork.status='awaiting_review'` |
| `frame_compose` | `result(frame, object_id=NULL)`, 같은 규칙 |

### 5.1 제안 규칙 (SD_01 0.5 `[추론]`, BR-SUG-01·04)

```text
if split_ok is FALSE:                                   suggestion = frame
elif kind_candidate == person and geometry_pass:        suggestion = animated
elif split_ok:                                          suggestion = relief
else:                                                   suggestion = frame
```

`person_score` 단독으로 `animated`를 내지 않는다(BR-SUG-04). M2 비활성(U4 미확정)이면 `judge`는 `model_not_ready` 소진 → `exhausted`.

## 6. 낮춤 체인 (BR-FBK-01·02, FR-23) — `downgrade_cause`

| 현재 | 조건 | 다음 작업(origin=`downgrade`) | `downgrade_cause` |
|---|---|---|---|
| `animate_render` quality_below | `split_ok=TRUE` | `depth_relief` | `animated_to_relief` |
| `animate_render` quality_below | 마스크 없음 | `frame_compose` | `animated_to_frame` |
| `depth_relief` quality_below | — | `frame_compose` | `relief_to_frame` |
| `relief` 확정 | `split_ok<>TRUE` | 확정 트랜잭션이 `depth_relief` 대신 `frame_compose` 등록 | `split_fail`(`split` 작업에 이미 기록) |
| `sculpture` quality_below (P1) | 마스크 있음 / 없음 | `depth_relief` / `frame_compose` | `sculpture_to_relief` |

**움직임 렌더 모양 검사(D55)**: `animate_render`는 AD가 GIF를 만든 뒤 프레임 모양을 검사한다. 전경 조각이 둘 이상으로 갈라진 프레임이 50% 이상이면 `diagnostic=render_torn`, 프레임 전경 면적 최대/최소가 `thresholds.yaml animate_render.max_area_ratio`(1.6, `[추론]`)를 넘으면 `render_distorted`로 `quality_below`를 낸다 — 위 표의 낮춤으로 간다. 기존 `ad_failed`(AD 실패) · `empty_render`(1KB 미만)와 같은 자리다.

낮춘 결과가 최종 결과가 되면 `artwork_outcome.result_cause='model_downgrade'`. 낮춤 표시는 보호자 화면 S4·S5에만(`v_job_progress.downgrade_cause`), 전시(`v_gallery`)에는 없다(D3).

## 7. 취소 (EXT1, G18·G19, H12)

- app-api(G18): 삭제 트랜잭션에서 작품의 `stage_job`(status IN queued, retry_wait, running)에 `cancel_requested_at`. `queued`·`retry_wait`는 즉시 `cancelled` + `stopped_at`.
- 워커: heartbeat(20초)마다와 결과 쓰기 직전에 확인 → 하위 작업 중단(TorchServe 요청 취소, 렌더 하위 프로세스 `SIGTERM`→5초 뒤 `SIGKILL`) → `cancelled` + `stopped_at`. 취소 뒤 결과 파일을 새로 만들지 않는다.
- sweeper(G19): `v_deletion_hold`에 작품이 없으면(또는 `claim_expires_at + 30s` 경과 `[추론]`) 파일 삭제 단계로.

## 8. 시간 상한·동시 처리 (BR-PRC-06·07, BR-SRV-03, U6)

`serving/config/limits.yaml` — 재현 시험 뒤 A가 갱신. 원천 확정값은 `animate_render` 600초 하나.

```yaml
# [추론] 기본값. 원천 확정값은 animate_render.timeout_s 뿐(BR-PRC-06).
retry:            { max_attempts: 3, backoff_s: [10, 60] }
claim:            { seconds: 60, heartbeat_s: 20 }
priority:         { guardian: 10, check: 30, eval: 50 }   # check = D20 모델 점검
stages:
  split:          { timeout_s: 60,  concurrency: 1 }   # M1 CPU 추론 RSS 8.5GB(A 실측) — T068 전까지 1
  judge:          { timeout_s: 120, concurrency: 1 }
  animate_render: { timeout_s: 600, concurrency: 1 }
  depth_relief:   { timeout_s: 180, timeout_s_cpu: 600, concurrency: 1 }
  frame_compose:  { timeout_s: 10,  concurrency: 4 }
  sculpture:      { timeout_s: 600, concurrency: 1 }   # P1
  caption:        { timeout_s: 30,  concurrency: 1 }   # P0.5, llm-server
external:         { concurrency_per_group: 1 }         # [예시값 U12]
```

워커는 프로세스당 작업 1건을 처리하므로 동시 처리 수는 pm2 인스턴스 수로 맞춘다(A 구현). 상한에 닿으면 새 행을 점유하지 않는다(거절 없음). 모델이 적재 중(`load.state='loading'`·`not_loaded`)이면 그 모델이 필요한 단계는 점유하지 않고 기다린다 — 오류가 아니다(`A_모델적재_화면요구` §2.1). 대기는 큐 적체(`v_metrics_model.queue_backlog`)에 반영된다.

## 9. 외부 작업(`external_job`)과의 관계

외부 호출(UC12)은 같은 어댑터·활성 버전을 쓰되 `external_job`에서 점유한다(보완 S4의 `claimed_by`·`claim_expires_at`·`available_at`). 워커는 매 점유 주기에 **`stage_job`을 먼저** 보고, 비었고 외부 몫(서빙군별 1)이 남을 때만 `external_job`을 점유한다(D17). 입력·출력은 `STORAGE_ROOT/ext/{ext_job_id}/`에만, `result_temp_ref`로 가리키고 전달 뒤 NULL(`chk_ej_delivered`). `pose`는 M3 관절 + M4만(렌더 없음). 결과 분류 `result_class`는 `ok`·`quality_below`, 오류는 `error_class`(배타, `chk_ej_exclusive`).

세부(2026-09-28 추가, B — T122 워커):

| func | 모델(순서) | 서빙군 | 어댑터 단계 이름 | `result.json` 필드(ExtResult) |
|---|---|---|---|---|
| `segment` | M1 | `cpu_vision` | `split` | `segment{maskPng, cutoutPng}`(base64) |
| `classify` | M2 | `cpu_vision` | `judge`(M2만) | `classify{kind, tags}` — 점수 없음 |
| `pose` | M3 → M4 규칙 | `cpu_vision` | `judge`(M3만) | `pose{joints[{name,x,y}], geometryRulePassed}` |
| `relief` | M1 → M5 | M5가 있는 서빙군(`GPU_ENABLED`면 `gpu`, 아니면 `cpu_vision`) | `split` → `depth_relief` | `relief{cutoutPng, depthPng16}` |

- **점유**: 서빙군별 외부 동시 1건은 DB 이름 잠금 `GET_LOCK('uam_ext_{group}', 0)`으로 지킨다(작업 동안 유지, 끝나면 해제). 잠금을 못 얻거나 필요한 모델이 `ready`가 아니면 점유하지 않는다. `gpu` 워커의 `relief`는 M1을 필요할 때 올린다(미리 올리지 않음, [추론 U2]).
- **분류**: `ok` → `status=done`, `result_class=ok`. `quality_below`(예: `relief`의 M1 분리 미달) → `done`, `result_class=quality_below`, 결과 필드 없이 `{}`. 인프라 5종 → 시도 3회 미만이면 `queued` + `available_at` 10초·60초 뒤, 3회째면 `failed` + `error_class`. 낮춤 체인은 타지 않는다(외부 결과는 요청한 기능 하나).
- **파일**: 어댑터 임시 결과는 `ext/{ext_job_id}/work/`에 두고, `result.json`을 쓴 뒤 `work/`를 지운다. `result_temp_ref = ext/{ext_job_id}/result.json`. 입력은 전달(또는 만료) 때 폴더째 지운다.
- **이어받기**: sweeper가 `running`이고 `claim_expires_at`이 지난 외부 작업을 `stage_job`과 같게 처리한다(3회 미만 `queued`, 3회째 `failed`·`engine_down`). heartbeat 20초마다 점유 연장.

## 10. 로그 필드 (BR-PRV-01)

JSON 한 줄: `ts, level, worker, job_id, stage_kind, model_id, version_label, attempt_count, status, error_class, downgrade_cause, duration_ms`. 객체 키·파일 경로·별칭·제목·한마디·키워드·예외 원문은 넣지 않는다.

## 11. LLM 서빙군 — 동기 전달, 같은 기록 (P0.5)

LLM 서빙군은 큐 워커가 없다. 실행 주체는 내부 동기 서버 **`llm-server`**(127.0.0.1:8200, research R-18)이고, 모델은 **Qwen3-4B-Instruct-2507**(`Qwen/Qwen3-4B-Instruct-2507`, Ollama `qwen3:4b-instruct-2507-q4_K_M`, `num_ctx 8192`, research R-22)다.

| 항목 | CPU·GPU 서빙군 | LLM 서빙군 |
|---|---|---|
| 실행 프로세스 | `worker-cpu`, `worker-gpu` (큐 워커) | `llm-server` (동기 HTTP 서버) |
| 전달 | `stage_job` 행 점유(`SKIP LOCKED`) | app-api → `POST /v1/caption` 동기 호출 |
| `stage_job` 행 | app-api가 `queued`로 생성, 워커가 닫음 | app-api가 `stage_kind='caption'`, `origin='caption'`, `status='running'`으로 생성하고 **app-api가 닫음** |
| 기록 | §4 | `done`(LLM 초안 통과) · `done_downgraded` + `llm_to_template`(재생성 상한 초과로 템플릿) · 인프라 `engine_down`·`timeout`·`model_not_ready` · `cancelled`. 규칙 검사에 걸린 초안마다 `caption_check_failure(job_id, failure_class)` — 문장은 저장하지 않음(BR-CAP-07) |
| 재시도 | 워커가 10초·60초 뒤 | app-api가 짧게(1초·3초 `[추론]`), 첫 시도 포함 최대 3회. 규칙 검사 재생성(최대 2회)은 `llm-server` 안에서 일어나며 시도로 세지 않음 |
| 소진 | §4.3 | 보호자 선택지 template / later / direct (D1) |
| 취소 | 취소 플래그 + heartbeat | app-api가 HTTP 요청 중단 → `llm-server`가 연결 종료 감지해 Ollama 생성 중단 → `cancelled` |
| 점유·이어받기 | 있음 | 없음(요청이 끊기면 끝) |

## 12. 평가 작업(`origin='eval'`) 실행 (T117, UC9 BF4·E4, SD_01 8.4) — A 워커 절, 2026-09-29 추가

app-api(G21)가 평가 요청마다 `evaluation` 1행과 항목마다 `stage_job`(`origin='eval'`, `artwork_id` NULL, `evaluation_id`·`eval_item_id`, `model_version_id`=후보, `priority` 50)을 등록한다. 워커가 이것을 처리해 항목마다 `eval_item_result`를 쓴다. 가족 데이터(`artwork`·`judgment`·`result`)는 건드리지 않는다(BR-ACC-03).

- **점유 순서**: 워커는 매 주기에 보호자 작업(`origin<>'eval'`) → 평가 작업 → 외부 작업(§9) 순으로 본다 `[추론]`. 평가는 서빙군별 동시 1건(`GET_LOCK('uam_eval_{group}', 0)`) — 처리 시간·메모리 측정이 다른 평가 항목과 겹치지 않게 한다.
- **같은 어댑터**: 워커에 올라간 어댑터를 그대로 쓴다. 어댑터는 매니페스트 리비전으로 가중치를 올리므로, 실행 직전에 후보 버전의 `weights_sha256`·`config_hash`가 매니페스트와 같은지 다시 본다. 다르면(평가 요청 뒤 매니페스트가 바뀜) 재시도 없이 `incomplete`로 닫는다.
- **평가 대상**(D51): 평가 요청이 모델마다 항목을 고른다 — M1·M2·M5는 `caption_input`을 뺀 사진 항목 전체, **M3는 `category='person'`만**, M6은 `caption_input`만. 대상이 0개면 409 `no_eval_items`(G21).
- **입력**: `eval_item.object_id` → `stored_object`(`owner_kind='eval_set'`, `evalset/…`)의 파일을 `original`로 준다. `caption_input` 항목(M6)은 P0.5에서, M7은 GPU가 있을 때만(UC9 A4) 처리한다 — 그 전에는 점유하지 않는다.
- **채점(D57)**: 일치 여부는 기대 경로를 그 모델이 낼 수 있는 답으로 바꿔 본다 — M1·M5는 기대 `animated`를 `relief`로(분리·깊이가 되면 `relief`), M2·M3·M6은 그대로. 저장값 `eval_item.expected_path`는 바꾸지 않고, 평가 기록 응답 `expectedPath`와 보고서 일치율에서만 적용한다.
- **모델별 실행과 `result_path`**(기대 경로 `eval_item.expected_path`와 비교하는 값). 나머지 단계는 성공한다고 보고 이 모델의 결과가 이르는 경로를 적는다 `[추론]`:

  | 후보 | 단계(어댑터) | `ok` | `quality_below` |
  |---|---|---|---|
  | M1 | `split` | `relief`(마스크 있음) | `frame` |
  | M2 | `judge`(M2 + 활성 M3 관절 + M4) | 제안 규칙(§5.1)을 `split_ok=TRUE`로 돌린 제안 | 같음 |
  | M3 | `animate_render` | `animated` | `relief` |
  | M5 | 활성 M1 `split` → `depth_relief` | `relief` | `frame`(M1 미달 포함) |

- **분류**: `ok`·`quality_below` → `eval_item_result.status='done'`, `stage_job.status='done'`(평가에는 낮춤 체인이 없다). 인프라(`engine_down`·`storage`·`db`·`model_not_ready`)는 §4.2와 같게 10초·60초 뒤 재시도, 3회째 `stage_job.failed` + `eval_item_result.status='incomplete'`(E4). **`timeout`은 재시도하지 않고** 곧바로 `status='timeout'`으로 닫는다 — 시간 상한 초과 자체가 측정 결과이기 때문이다(E4 "시간 초과로 기록하고 나머지 항목은 계속", `[추론]`).
- **측정**: `processing_ms` = 어댑터 실행 시간(모델 적재 시간 제외). `memory_mb` = 실행 중 워커 프로세스와 그 하위 프로세스의 RSS 합의 최댓값(0.5초 간격 표본) — TorchServe(M3)·Ollama(M6)처럼 워커 밖 런타임의 메모리는 포함하지 않는다. `score` = 어댑터 점수 0~1(기록만, BR-PRC-04 · D50 — M1 전경 비율, M2 종류 확률 최댓값, M3 검출 점수, M5 깊이 표준편차÷255). 결과 저장이 DB 오류로 실패하면 로그에 errno만 남긴다.
- **이어받기**: sweeper가 점유 만료 평가 작업을 `failed`로 닫으면 `eval_item_result`가 없다. 워커의 평가 실행기가 주기마다 "끝났는데 결과가 없는 평가 작업"에 `incomplete`를 채운다(sweeper는 가족 흐름만 다룬다).
- **보고**: `eval/runner.py report <evaluation_id>`가 SD_01 8.5 보고서(기대 경로 일치율, 불일치·오인 후보 목록, 처리 시간 p50·p95·최대, 메모리 최대, 미완료·시간 초과 수)를 만든다. `eval/runner.py run`은 pm2 없이 평가 작업만 처리하는 일회성 워커다.

## 13. 점검 작업(`origin='check'`) 실행 (D20, SD_01 §10-4 7.8~7.10, SD_04 §8) — 2026-09-29 추가

app-api(G30)가 점검 요청마다 `model_check` 1행과 `stage_job` 1행(`origin='check'`, `artwork_id` NULL, `model_check_id`, `eval_item_id`, `model_version_id`=점검 대상 버전, `priority` 30)을 한 트랜잭션에 등록한다. 워커의 점검 실행기가 처리해 `model_check`에 결과를 쓴다. 가족 데이터는 건드리지 않는다(BR-OPS-05).

- **점유 순서**: 보호자 작업(`origin NOT IN ('eval','check')`) → **점검 작업** → 평가 작업 → 외부 작업. 지금 보호자 점유 조건 `origin <> 'eval'`(`workers/runner.py`)은 점검 작업을 보호자 작업으로 잡으므로 **점검 실행기와 함께 바꾼다**. 그 전에는 app-api가 `MODEL_CHECK_ENABLED` 꺼짐으로 점검 등록을 막는다(503 `check_runner_missing`).
- **단계와 서빙군**: 평가와 같은 대응 — M1 `split`·M2 `judge`·M3 `animate_render`는 `cpu_vision`, M5 `depth_relief`는 `gpu`(GPU 없으면 `cpu_vision`), M7 `sculpture`는 `gpu`. M4는 없음(규칙), M6은 P0.5에 llm-server 동기 호출로 따로 한다(큐 없음, §11).
- **실행**: 그 모델의 어댑터만 한 번. 입력은 `eval_item.object_id` → `stored_object`(`owner_kind='eval_set'`)의 파일. M2는 M2 분류만(어댑터 단계 `judge`), M3는 관절 추정까지(어댑터 단계 `judge` — 렌더 제외), M5는 깊이 추정까지(부조 합성 제외 — M1을 거치지 않고 점검 그림 전체를 불투명 컷아웃으로 넣는다). 대상 모델이 이 워커에서 `disabled`·`failed`면 기다리지 않고 `model_not_ready`로 닫는다. 점검 버전의 가중치·설정 해시가 매니페스트와 다르면 `model_not_ready`(평가와 같음). M7은 GPU 서빙군 전용 환경 하위 프로세스(T131). (2026-09-29 A 확정, T155) 모델이 적재 중이면 평가와 같이 기다린다(오류 아님) — 15분 안에 시작되지 않으면 app-api가 조회 때 `failed`·`model_not_ready`로 닫고 작업을 `cancelled`로 둔다.
- **판정(재시도 없음)**:

  | 어댑터 결과 | 출력 형식 확인 | `model_check` | `stage_job` |
  |---|---|---|---|
  | `ok`·`quality_below` | 통과 | `status='passed'`, `outcome`=그 값 | `done` |
  | `ok`·`quality_below` | 불량 | `status='failed'`, `fail_reason='bad_output'`, `outcome`=그 값 | `failed`(`error_class` NULL) |
  | 인프라 5종 | — | `status='failed'`, `fail_reason`=그 분류 | `failed`, `error_class`=그 분류 |

  `quality_below`는 모델 자신의 품질 규칙이 낸 결과라 출력 파일이 없어도 통과로 본다. 형식 확인은 `ok`일 때만 한다. 출력 형식 기준은 SD_01 §10-4 표(M1 마스크 크기·전경 · M2 제안 값 · M3 관절 개수 · M5 깊이 크기·값 분산 · M7 GLB 다시 읽기·면 수). 점수는 쓰지 않는다(BR-OPS-06).
- **측정**: `processing_ms`·`memory_mb`는 §12 평가와 같은 방식(적재 시간 제외, 워커 밖 런타임 메모리 제외). `started_at`은 점유 때, `finished_at`은 판정 때.
- **정리**: 출력 파일은 `tmp/{job_id}/`에만 두고 판정 뒤 지운다. `stored_object`·`result`에 쓰지 않는다.
- **이어받기**: 점유 만료 점검 작업은 다시 돌리지 않는다. sweeper(`api/src/sweeper/takeover.ts`)가 `stage_job`과 `model_check`를 함께 `failed`·`engine_down`으로 닫는다.
- **로그**: 허용 목록(모델 ID·버전·단계·결과 분류·처리 시간)만. 객체 키·파일 경로를 남기지 않는다(BR-PRV-01).
