"""결과 단계 — animate_render(M3, 600초) · depth_relief(M1 마스크 + M5) · frame_compose(모델 없음) · sculpture(P1).

frame_compose는 새 파일 없이 result(frame, object_id=NULL)만 기록한다(research R-07).
"""
from __future__ import annotations

from ..chain import next_after_quality_below, record_result
from ..records import upsert_outcome

RESULT_KIND = {"animate_render": "animated", "depth_relief": "relief", "frame_compose": "frame", "sculpture": "sculpture"}
RESULT_OBJECT = {"animate_render": "result_animated", "depth_relief": "result_relief", "sculpture": "result_glb"}


def on_ok(cur, storage, ctx, res) -> str | None:
    record_result(cur, storage, ctx, RESULT_KIND[ctx.stage], res.outputs, RESULT_OBJECT.get(ctx.stage))
    return None


def on_quality_below(cur, storage, ctx, res) -> str:
    return next_after_quality_below(cur, ctx)


def on_exhausted(cur, storage, ctx) -> None:
    if ctx.stage == "depth_relief" and ctx.origin == "use_lower":
        # H6: 처음 결과를 둔 채 확인 대기로 복귀. 미도달 아님
        cur.execute("UPDATE artwork SET status = 'awaiting_review' WHERE artwork_id = %s AND status = 'processing'",
                    (ctx.artwork_id,))
        return
    # D1 · G9: 처리하지 못함 + 결과 미도달
    cur.execute("UPDATE artwork SET status = 'failed' WHERE artwork_id = %s AND status = 'processing'", (ctx.artwork_id,))
    cur.execute("SELECT in_approval_base FROM artwork_outcome WHERE artwork_id = %s", (ctx.artwork_id,))
    row = cur.fetchone()
    base = False if (row and row["in_approval_base"]) else (row["in_approval_base"] if row else None)
    upsert_outcome(cur, ctx.artwork_id, result_cause="not_delivered", in_approval_base=base)
