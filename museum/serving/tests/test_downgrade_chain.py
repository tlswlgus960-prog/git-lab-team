"""낮춤 체인·결과 기록 시험(T073 일부, T076·T077) — 움직임 → 2.5D → 액자, 결과 원인."""
from __future__ import annotations

from tests.test_stage_job_contract import make_worker, run_all


def _with_mask(env, a):
    env.job(a, "split"); env.job(a, "judge", future=True)
    make_worker().run_once(); make_worker().run_once()


def test_animated_ok_result(env):
    a = env.artwork()
    _with_mask(env, a)
    env.confirmed(a, "animated")
    jid = env.job(a, "animate_render", origin="confirm")
    assert make_worker().run_once() == "done"
    r = env.one("SELECT r.result_kind, so.object_kind FROM result r JOIN stored_object so ON so.object_id=r.object_id WHERE r.artwork_id=%s", a)
    assert (r["result_kind"], r["object_kind"]) == ("animated", "result_animated")
    o = env.one("SELECT result_kind, result_cause FROM artwork_outcome WHERE artwork_id=%s", a)
    assert (o["result_kind"], o["result_cause"]) == ("animated", None)
    assert env.one("SELECT status FROM artwork WHERE artwork_id=%s", a)["status"] == "awaiting_review"
    assert env.job_row(jid)["status"] == "done"


def test_chain_animated_to_relief_to_frame(env):
    a = env.artwork()
    _with_mask(env, a)
    env.confirmed(a, "animated")
    env.job(a, "animate_render", origin="confirm")
    w = make_worker({"animate_render": ("quality_below", None), "depth_relief": ("quality_below", None)})
    assert run_all(w) == ["done_downgraded", "done_downgraded", "done"]
    rows = env.q("SELECT stage_kind, origin, status, downgrade_cause, error_class FROM stage_job WHERE artwork_id=%s AND stage_kind NOT IN ('split','judge') ORDER BY job_id", a)
    assert [(r["stage_kind"], r["origin"], r["downgrade_cause"]) for r in rows] == [
        ("animate_render", "confirm", "animated_to_relief"),
        ("depth_relief", "downgrade", "relief_to_frame"),
        ("frame_compose", "downgrade", None)]
    assert all(r["error_class"] is None for r in rows)          # 낮춤과 오류는 배타
    res = env.one("SELECT result_kind, object_id FROM result WHERE artwork_id=%s", a)
    assert (res["result_kind"], res["object_id"]) == ("frame", None)    # 액자는 새 파일 없음
    o = env.one("SELECT result_kind, result_cause FROM artwork_outcome WHERE artwork_id=%s", a)
    assert (o["result_kind"], o["result_cause"]) == ("frame", "model_downgrade")


def test_animated_without_mask_goes_to_frame(env):
    a = env.artwork()
    env.job(a, "split"); env.job(a, "judge", future=True)
    w = make_worker({"split": ("quality_below", None), "animate_render": ("quality_below", None)})
    w.run_once(); w.run_once()
    env.confirmed(a, "animated", suggestion="frame")
    env.job(a, "animate_render", origin="confirm")
    assert run_all(w) == ["done_downgraded", "done"]
    assert env.one("SELECT downgrade_cause FROM stage_job WHERE artwork_id=%s AND stage_kind='animate_render'", a)["downgrade_cause"] == "animated_to_frame"


def test_relief_ok_guardian_choice(env):
    a = env.artwork()
    _with_mask(env, a)
    env.confirmed(a, "relief")
    env.job(a, "depth_relief", origin="confirm")
    assert make_worker().run_once() == "done"
    assert env.one("SELECT result_cause FROM artwork_outcome WHERE artwork_id=%s", a)["result_cause"] == "guardian_choice"


def test_relief_confirmed_but_split_failed_frame_is_split_fail(env):
    a = env.artwork()
    env.job(a, "split"); env.job(a, "judge", future=True)
    w = make_worker({"split": ("quality_below", None)})
    w.run_once(); w.run_once()
    env.confirmed(a, "relief", suggestion="frame")
    jid = env.job(a, "frame_compose", origin="confirm")
    assert w.run_once() == "done_downgraded"
    assert env.job_row(jid)["downgrade_cause"] == "split_fail"
    assert env.one("SELECT result_cause FROM artwork_outcome WHERE artwork_id=%s", a)["result_cause"] == "model_downgrade"


def test_use_lower_exhausted_returns_to_review(env):
    a = env.artwork()
    _with_mask(env, a)
    env.confirmed(a, "animated")
    env.job(a, "animate_render", origin="confirm")
    make_worker().run_once()
    env.q("UPDATE artwork SET status='processing' WHERE artwork_id=%s", a)
    jid = env.job(a, "depth_relief", origin="use_lower")
    w = make_worker({"depth_relief": ("engine_down", None)})
    for _ in range(3):
        w.run_once(); env.make_ready(jid)
    assert env.one("SELECT status FROM artwork WHERE artwork_id=%s", a)["status"] == "awaiting_review"
    assert env.one("SELECT result_cause FROM artwork_outcome WHERE artwork_id=%s", a)["result_cause"] is None
    assert env.one("SELECT COUNT(*) n FROM result WHERE artwork_id=%s", a)["n"] == 1   # 처음 결과 보관


def test_first_result_kept(env):
    a = env.artwork()
    _with_mask(env, a)
    env.confirmed(a, "relief")
    env.job(a, "depth_relief", origin="confirm")
    w = make_worker()
    w.run_once()
    env.q("UPDATE artwork SET status='processing' WHERE artwork_id=%s", a)
    env.job(a, "depth_relief", origin="confirm")
    w.run_once()
    assert env.one("SELECT COUNT(*) n FROM result WHERE artwork_id=%s AND result_kind='relief'", a)["n"] == 1   # uq_rs_first


def test_sculpture_ok_and_downgrade_to_relief(env):
    """T132 serving 쪽(P1): 3D 결과는 GLB, 품질 미달이면 2.5D로 낮춘다(D10). 가짜 M7로(GPU 서빙군)."""
    m7 = env.version("M7")
    env.cur.execute("INSERT INTO feature_setting (setting_key, enabled) VALUES ('sculpture_exposure', TRUE) "
                    "ON DUPLICATE KEY UPDATE enabled = TRUE")                  # G17 — 노출 설정이 켜진 뒤에만 3D 확정
    a = env.artwork()
    _with_mask(env, a)
    env.confirmed(a, "sculpture")
    env.job(a, "sculpture", origin="confirm", group="gpu", version_id=m7)
    assert make_worker(group="gpu").run_once() == "done"
    r = env.one("SELECT r.result_kind, so.object_kind FROM result r JOIN stored_object so ON so.object_id=r.object_id WHERE r.artwork_id=%s", a)
    assert (r["result_kind"], r["object_kind"]) == ("sculpture", "result_glb")

    b = env.artwork()
    _with_mask(env, b)
    env.confirmed(b, "sculpture")
    env.job(b, "sculpture", origin="confirm", group="gpu", version_id=m7)
    assert make_worker({"sculpture": ("quality_below", None)}, group="gpu").run_once() == "done_downgraded"
    nxt = env.one("SELECT stage_kind, origin FROM stage_job WHERE artwork_id=%s AND origin='downgrade'", b)
    assert (nxt["stage_kind"], nxt["origin"]) == ("depth_relief", "downgrade")
    assert env.one("SELECT downgrade_cause FROM stage_job WHERE artwork_id=%s AND stage_kind='sculpture'", b)["downgrade_cause"] == "sculpture_to_relief"
    env.cur.execute("DELETE FROM feature_setting")
