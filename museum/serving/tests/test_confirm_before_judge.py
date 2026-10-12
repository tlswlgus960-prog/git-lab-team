"""T144 — 판정 전 확정의 순서(stage-job §2, BR-SUG-05): 잠긴 확정 결과 작업은 judge가 끝난 뒤에만 열린다."""
from __future__ import annotations

from tests.test_stage_job_contract import make_worker


def _setup(env, path, split_fault=None):
    a = env.artwork()
    env.job(a, "split")
    jj = env.job(a, "judge", future=True)
    env.confirmed(a, path)                                         # 판정 중에 보호자가 확정
    stage = {"animated": "animate_render", "relief": "depth_relief"}[path]
    rj = env.job(a, stage, origin="confirm", future=True)          # 앱이 잠가서 등록한 결과 작업
    w = make_worker({"split": (split_fault, None)} if split_fault else None)
    return a, jj, rj, w


def test_result_job_runs_only_after_judge(env):
    a, jj, rj, w = _setup(env, "animated")
    assert w.run_once() == "done"                                  # split → judge 열림
    assert env.job_row(rj)["status"] == "queued" and env.job_row(jj)["status"] == "queued"
    assert w.run_once() == "done"                                  # judge 끝 → 결과 작업 열림
    assert env.job_row(jj)["status"] == "done"
    assert env.one("SELECT available_at <= UTC_TIMESTAMP() open FROM stage_job WHERE job_id=%s", rj)["open"] == 1
    assert env.one("SELECT status FROM artwork WHERE artwork_id=%s", a)["status"] == "processing"   # 판정이 끝나도 확정 상태 유지
    assert w.run_once() == "done"                                  # 이제야 움직임 렌더
    assert env.job_row(rj)["status"] == "done"
    assert env.one("SELECT status FROM artwork WHERE artwork_id=%s", a)["status"] == "awaiting_review"


def test_relief_with_split_failure_goes_to_frame(env):
    a, jj, rj, w = _setup(env, "relief", split_fault="quality_below")
    assert w.run_once() == "done_downgraded"                       # 분리 미달
    assert w.run_once() == "done"                                  # judge 끝
    r = env.job_row(rj)
    assert (r["status"], r["downgrade_cause"], r["attempt_count"]) == ("done_downgraded", "split_fail", 1)
    fc = env.one("SELECT stage_kind, origin FROM stage_job WHERE artwork_id=%s AND stage_kind='frame_compose'", a)
    assert fc == {"stage_kind": "frame_compose", "origin": "downgrade"}
