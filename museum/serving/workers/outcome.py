"""응답 분류 기록(stage-job §4, BR-API-02) — outcome → stage_job.status·error_class·downgrade_cause 1:1.

| outcome        | status                                   | error_class | downgrade_cause |
| ok             | done                                     | NULL        | NULL            |
| quality_below  | done_downgraded (재시도 없음)             | NULL        | §6 코드          |
| 인프라 5종      | retry_wait(+10s·+60s) / failed(3회째)     | outcome     | NULL            |
| cancelled      | cancelled + stopped_at                   | NULL        | NULL            |
"""
from __future__ import annotations

from common.config import load_yaml

from .stages import judge, results, split

HANDLERS = {"split": split, "judge": judge, "animate_render": results, "depth_relief": results,
            "frame_compose": results, "sculpture": results}
INFRA = ("engine_down", "timeout", "storage", "db", "model_not_ready")

_limits = load_yaml("limits")
MAX_ATTEMPTS = _limits["retry"]["max_attempts"]
BACKOFF = _limits["retry"]["backoff_s"]


def backoff_s(attempt_count: int) -> int:
    """attempt_count(방금 끝난 시도 번호) 1 → 10초, 2 → 60초."""
    return BACKOFF[min(attempt_count, len(BACKOFF)) - 1]


def _close(cur, job_id: int, status: str, error_class=None, downgrade_cause=None) -> None:
    cur.execute("""UPDATE stage_job SET status = %s, error_class = %s, downgrade_cause = %s,
                          finished_at = UTC_TIMESTAMP(), claimed_by = NULL, claim_expires_at = NULL
                    WHERE job_id = %s""", (status, error_class, downgrade_cause, job_id))


def mark_cancelled(cur, job_id: int) -> None:
    # chk_sj_stop_after_cancel: 멈춤은 취소 요청 뒤에만 — 삭제 중 발견이면 요청 시각을 같이 남긴다
    cur.execute("""UPDATE stage_job SET status = 'cancelled', stopped_at = UTC_TIMESTAMP(),
                          cancel_requested_at = COALESCE(cancel_requested_at, UTC_TIMESTAMP()),
                          finished_at = UTC_TIMESTAMP(), claimed_by = NULL, claim_expires_at = NULL,
                          error_class = NULL, downgrade_cause = NULL
                    WHERE job_id = %s""", (job_id,))


def apply(cur, storage, ctx, res) -> str:
    """한 트랜잭션 안에서 결과를 기록하고 stage_job을 닫는다. 기록한 status를 돌려준다."""
    h = HANDLERS[ctx.stage]
    job = ctx.job
    if res.outcome == "ok":
        cause = h.on_ok(cur, storage, ctx, res)
        if ctx.stage == "frame_compose" and ctx.confirmed_path == "relief" and ctx.origin == "confirm":
            cause = "split_fail"   # relief 확정인데 분리 실패로 액자(stage-job §6 넷째 줄)
        status = "done_downgraded" if cause else "done"
        _close(cur, ctx.job_id, status, downgrade_cause=cause)
        return status
    if res.outcome == "quality_below":
        cause = h.on_quality_below(cur, storage, ctx, res)
        if ctx.stage == "judge":
            _close(cur, ctx.job_id, "done")
            return "done"
        _close(cur, ctx.job_id, "done_downgraded", downgrade_cause=cause)
        return "done_downgraded"
    if res.outcome in INFRA:
        return record_infra(cur, storage, ctx, res.outcome)
    raise ValueError("unknown_outcome")


def record_infra(cur, storage, ctx, error_class: str) -> str:
    attempt = ctx.job["attempt_count"]
    if attempt < MAX_ATTEMPTS:
        cur.execute("""UPDATE stage_job SET status = 'retry_wait', error_class = %s,
                              available_at = UTC_TIMESTAMP() + INTERVAL %s SECOND,
                              claimed_by = NULL, claim_expires_at = NULL
                        WHERE job_id = %s""", (error_class, backoff_s(attempt), ctx.job_id))
        return "retry_wait"
    _close(cur, ctx.job_id, "failed", error_class=error_class)
    HANDLERS[ctx.stage].on_exhausted(cur, storage, ctx)   # D1
    return "failed"
