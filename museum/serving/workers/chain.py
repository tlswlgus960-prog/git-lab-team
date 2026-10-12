"""낮춤 체인과 결과 기록(stage-job §5·§6, BR-FBK-01·02, FR-23, BR-APR-03).

움직임 → 2.5D → 액자. 마스크가 없으면 바로 액자. 낮춘 결과가 최종이면 result_cause='model_downgrade'.
인프라 실패는 낮춤으로 우회하지 않는다(BR-FBK-04) — 여기는 quality_below일 때만 온다.
"""
from __future__ import annotations

import os

from .records import active_version, store_output, upsert_outcome


def _has_mask(ctx) -> bool:
    return ctx.split_ok is True and "mask" in ctx.object_keys


def _enqueue(cur, ctx, stage: str, cause: str) -> None:
    model_id = {"depth_relief": "M5"}.get(stage)
    version_id = None
    if model_id:
        v = active_version(cur, model_id)
        if v is None or not v["license_confirmed"]:
            # 다음 모델이 비활성이면 모델이 없는 액자로 간다(액자는 항상 가능, BR-PRC-01)
            stage, cause, model_id = "frame_compose", "animated_to_frame", None
        else:
            version_id = v["version_id"]
    gpu = os.environ.get("GPU_ENABLED", "").lower() in ("1", "true", "yes")
    group = "gpu" if (stage == "depth_relief" and gpu) else "cpu_vision"
    cur.execute("""INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, priority)
                   VALUES (%s, %s, 'downgrade', %s, %s, %s)""",
                (ctx.artwork_id, stage, group, version_id, ctx.job.get("priority", 10)))
    return cause


def next_after_quality_below(cur, ctx) -> str:
    """현재 결과 단계가 품질 미달일 때 다음 작업을 등록하고 downgrade_cause를 돌려준다."""
    s = ctx.stage
    if s == "animate_render":
        if _has_mask(ctx):
            return _enqueue(cur, ctx, "depth_relief", "animated_to_relief")
        return _enqueue(cur, ctx, "frame_compose", "animated_to_frame")
    if s == "depth_relief":
        return _enqueue(cur, ctx, "frame_compose", "relief_to_frame")
    if s == "sculpture":
        _enqueue(cur, ctx, "depth_relief" if _has_mask(ctx) else "frame_compose", "sculpture_to_relief")
        return "sculpture_to_relief"
    # frame_compose는 품질 미달이 없다(모델 없음)
    raise ValueError("no_downgrade_for_stage")


def _result_cause(cur, ctx, result_kind: str) -> str | None:
    if ctx.origin == "downgrade":
        return "model_downgrade"
    if ctx.origin == "use_lower":
        return "guardian_switch"
    if ctx.confirmed_path == "relief" and result_kind == "frame":
        # relief 확정 + 분리 실패로 확정 트랜잭션이 frame을 등록(split_fail)
        return "model_downgrade"
    if result_kind in ("relief", "frame"):
        return "guardian_choice"
    return None   # animated·sculpture 그대로


def record_result(cur, storage, ctx, result_kind: str, outputs: dict, main_object: str | None) -> None:
    object_id = None
    for kind, path in outputs.items():
        oid = store_output(cur, storage, ctx, kind, path)
        if kind == main_object:
            object_id = oid
    # uq_rs_first: 결과 종류마다 처음 만든 결과만(재생성 금지, D11)
    cur.execute("INSERT IGNORE INTO result (artwork_id, job_id, result_kind, object_id) VALUES (%s, %s, %s, %s)",
                (ctx.artwork_id, ctx.job_id, result_kind, object_id))
    upsert_outcome(cur, ctx.artwork_id, result_kind=result_kind, result_cause=_result_cause(cur, ctx, result_kind))
    cur.execute("UPDATE artwork SET status = 'awaiting_review' WHERE artwork_id = %s AND status = 'processing'",
                (ctx.artwork_id,))
