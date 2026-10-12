"""split 단계(M1) — 마스크·컷아웃 저장, judgment.split_ok, 성공·낮춤·소진 모두 judge를 연다(FR-20)."""
from __future__ import annotations

from ..records import open_judge, store_output


def _judgment(cur, artwork_id: int, split_ok, mask_id=None, cutout_id=None) -> None:
    cur.execute("""INSERT INTO judgment (artwork_id, split_ok, mask_object_id, cutout_object_id)
                   VALUES (%s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE split_ok = VALUES(split_ok),
                     mask_object_id = VALUES(mask_object_id), cutout_object_id = VALUES(cutout_object_id)""",
                (artwork_id, split_ok, mask_id, cutout_id))


def on_ok(cur, storage, ctx, res) -> str | None:
    mask_id = store_output(cur, storage, ctx, "mask", res.outputs["mask"])
    cutout_id = store_output(cur, storage, ctx, "cutout", res.outputs["cutout"])
    _judgment(cur, ctx.artwork_id, True, mask_id, cutout_id)
    open_judge(cur, ctx.artwork_id)
    return None


def on_quality_below(cur, storage, ctx, res) -> str:
    _judgment(cur, ctx.artwork_id, False)   # 마스크 없음. 제안은 계속(frame만)
    open_judge(cur, ctx.artwork_id)
    return "split_fail"


def on_exhausted(cur, storage, ctx) -> None:
    _judgment(cur, ctx.artwork_id, None)    # 인프라 실패 — 마스크 없음, 판정은 계속
    open_judge(cur, ctx.artwork_id)
