"""judge 단계 — M2 종류·태그 → M3 관절 → M4 기하 규칙 → 제안 규칙(stage-job §5.1, FR-21, G7)."""
from __future__ import annotations

from rules.m4_geometry import evaluate_file, suggest

from ..records import open_confirmed, store_output

_WAITING = ("received", "judging")


def _to_awaiting_confirm(cur, ctx) -> None:
    # 이미 확정됐으면(판정 중 직접 확정) 상태는 두고 제안값만 기록한다
    cur.execute("UPDATE artwork SET status = 'awaiting_confirm' WHERE artwork_id = %s AND status IN ('received','judging')",
                (ctx.artwork_id,))
    open_confirmed(cur, ctx.artwork_id)   # 판정 중 확정으로 잠가 둔 결과 작업을 연다(T144)


def on_ok(cur, storage, ctx, res) -> str | None:
    v = res.values
    joints_id = None
    geometry_pass = None
    if "joints" in res.outputs:
        geometry_pass = evaluate_file(res.outputs["joints"])
        joints_id = store_output(cur, storage, ctx, "joints", res.outputs["joints"])
    kind = v.get("kind_candidate")
    suggestion = suggest(ctx.split_ok, kind, geometry_pass)
    cur.execute("""INSERT INTO judgment (artwork_id, judge_job_id, joints_object_id, kind_candidate, geometry_pass,
                                         person_score, suggestion, suggestion_state)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'presented')
                   ON DUPLICATE KEY UPDATE judge_job_id = VALUES(judge_job_id), joints_object_id = VALUES(joints_object_id),
                     kind_candidate = VALUES(kind_candidate), geometry_pass = VALUES(geometry_pass),
                     person_score = VALUES(person_score), suggestion = VALUES(suggestion), suggestion_state = 'presented'""",
                (ctx.artwork_id, ctx.job_id, joints_id, kind, geometry_pass, v.get("person_score", res.score), suggestion))
    for label in (v.get("tags") or [])[:5]:
        cur.execute("INSERT IGNORE INTO tag_candidate (artwork_id, label) VALUES (%s, %s)", (ctx.artwork_id, label[:40]))
    _to_awaiting_confirm(cur, ctx)
    return None


# 판정의 quality_below는 계약에 낮춤 구간이 없다. 확신이 낮아도 제안 규칙은 같게 돈다(점수 단독 판정 금지, BR-SUG-04)
on_quality_below = on_ok


def on_exhausted(cur, storage, ctx) -> None:
    cur.execute("""INSERT INTO judgment (artwork_id, judge_job_id, suggestion, suggestion_state)
                   VALUES (%s, %s, NULL, 'exhausted')
                   ON DUPLICATE KEY UPDATE judge_job_id = VALUES(judge_job_id), suggestion = NULL, suggestion_state = 'exhausted'""",
                (ctx.artwork_id, ctx.job_id))
    _to_awaiting_confirm(cur, ctx)   # G7: 보호자 직접 확정
