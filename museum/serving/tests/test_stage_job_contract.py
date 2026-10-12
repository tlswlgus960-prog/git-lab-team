"""단계 작업 계약 시험(T034) — 가짜 어댑터로 점유·분류 8종·재시도·소진·취소·쓰기 직전 재확인·적재 대기."""
from __future__ import annotations

import json
import threading
import time

import pytest

from adapters.base import AdapterResult
from adapters.fake import FakeAdapter
from workers.runner import Worker


def make_worker(faults=None, group="cpu_vision", load_s=0.0, preload=True, extra=None):
    faults = faults or {}
    adapters = {m: FakeAdapter(m, faults=faults, load_s=load_s) for m in ("M1", "M2", "M3", "M5", "M7")}
    adapters.update(extra or {})
    w = Worker(group, adapters=adapters, preload=False)
    if preload:
        w.preload_all()
    return w


def run_all(w, limit=20):
    out = []
    for _ in range(limit):
        r = w.run_once()
        if r is None:
            break
        out.append(r)
    return out


# ── 성공 흐름 ──────────────────────────────────────────────────────────
def test_split_ok_opens_judge_and_judge_presents(env):
    a = env.artwork()
    sj = env.job(a, "split")
    jj = env.job(a, "judge", future=True)
    w = make_worker()
    assert w.run_once() == "done"
    j = env.one("SELECT * FROM judgment WHERE artwork_id=%s", a)
    assert j["split_ok"] == 1 and j["mask_object_id"] and j["cutout_object_id"]
    assert env.job_row(sj)["status"] == "done" and env.job_row(sj)["model_version_id"] == env.versions["M1"]
    assert w.run_once() == "done"                     # judge가 열렸다
    j = env.one("SELECT * FROM judgment WHERE artwork_id=%s", a)
    assert (j["kind_candidate"], j["geometry_pass"], j["suggestion"], j["suggestion_state"]) == ("person", 1, "animated", "presented")
    assert j["joints_object_id"] and j["judge_job_id"] == jj
    assert {r["label"] for r in env.q("SELECT label FROM tag_candidate WHERE artwork_id=%s", a)} == {"바다", "사람"}
    assert env.one("SELECT status FROM artwork WHERE artwork_id=%s", a)["status"] == "awaiting_confirm"
    # 임시 파일 정리(0.12)
    assert not any((env.store / "tmp").glob("*/*"))


def test_split_quality_below_frame_only(env):
    a = env.artwork()
    sj = env.job(a, "split"); env.job(a, "judge", future=True)
    w = make_worker({"split": ("quality_below", None)})
    assert w.run_once() == "done_downgraded"
    r = env.job_row(sj)
    assert (r["status"], r["downgrade_cause"], r["error_class"], r["attempt_count"]) == ("done_downgraded", "split_fail", None, 1)
    w.run_once()
    j = env.one("SELECT split_ok, suggestion FROM judgment WHERE artwork_id=%s", a)
    assert (j["split_ok"], j["suggestion"]) == (0, "frame")   # chk_jd_split_fail_frame


# ── 인프라 분류 5종 + 재시도 간격 ───────────────────────────────────────
@pytest.mark.parametrize("stage,path", [("animate_render", "animated"), ("depth_relief", "relief")])
@pytest.mark.parametrize("err", ["engine_down", "timeout", "storage", "db", "model_not_ready"])
def test_infra_classes_retry_then_fail(env, err, stage, path):
    """5종 오류 × 결과 단계(T073): 재시도 10초·60초 → 소진 시 failed + not_delivered, 낮춤으로 집계 0건."""
    a = env.artwork(status="processing")
    env.confirmed(a, path)
    jid = env.job(a, stage, origin="confirm")
    w = make_worker({stage: (err, None)})
    delays = []
    for attempt in (1, 2):
        assert w.run_once() == "retry_wait"
        r = env.job_row(jid)
        assert (r["status"], r["error_class"], r["attempt_count"], r["downgrade_cause"]) == ("retry_wait", err, attempt, None)
        delays.append(env.one("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), available_at) d FROM stage_job WHERE job_id=%s", jid)["d"])
        env.make_ready(jid)
    assert delays[0] in (9, 10) and delays[1] in (59, 60)
    assert w.run_once() == "failed"
    r = env.job_row(jid)
    assert (r["status"], r["error_class"], r["attempt_count"]) == ("failed", err, 3)
    # D1 결과 단계 소진: 처리하지 못함 + 결과 미도달, 승인율 분모 제외
    assert env.one("SELECT status FROM artwork WHERE artwork_id=%s", a)["status"] == "failed"
    o = env.one("SELECT result_cause, in_approval_base FROM artwork_outcome WHERE artwork_id=%s", a)
    assert (o["result_cause"], o["in_approval_base"]) == ("not_delivered", 0)
    assert env.one("SELECT COUNT(*) n FROM stage_job WHERE artwork_id=%s AND origin='downgrade'", a)["n"] == 0  # 낮춤으로 우회 안 함


def test_recover_after_two_failures(env):
    a = env.artwork()
    env.job(a, "split"); jid = env.job(a, "judge")
    w = make_worker({"judge": ("engine_down", 2)})
    w.run_once()                                   # split
    for _ in range(2):
        assert w.run_once() == "retry_wait"; env.make_ready(jid)
    assert w.run_once() == "done"
    assert env.job_row(jid)["attempt_count"] == 3 and env.job_row(jid)["error_class"] is None


def test_judge_exhausted_goes_to_direct_confirm(env):
    a = env.artwork()
    jid = env.job(a, "judge")
    w = make_worker({"judge": ("engine_down", None)})
    for _ in range(3):
        w.run_once(); env.make_ready(jid)
    j = env.one("SELECT suggestion, suggestion_state FROM judgment WHERE artwork_id=%s", a)
    assert (j["suggestion"], j["suggestion_state"]) == (None, "exhausted")
    assert env.one("SELECT status FROM artwork WHERE artwork_id=%s", a)["status"] == "awaiting_confirm"   # G7


def test_split_exhausted_opens_judge_without_mask(env):
    a = env.artwork()
    sj = env.job(a, "split"); jj = env.job(a, "judge", future=True)
    w = make_worker({"split": ("storage", None)})
    for _ in range(3):
        w.run_once(); env.make_ready(sj)
    assert env.job_row(sj)["status"] == "failed"
    assert env.one("SELECT split_ok FROM judgment WHERE artwork_id=%s", a)["split_ok"] is None
    assert w.run_once() == "done" and env.job_row(jj)["status"] == "done"


def test_real_timeout_classified(env, monkeypatch):
    class Slow(FakeAdapter):
        def run(self, job):
            job.cancel.wait(5)
            return AdapterResult("ok")
    a = env.artwork()
    jid = env.job(a, "split")
    w = make_worker(extra={"M1": Slow("M1", faults={})})
    w.limits["stages"]["split"]["timeout_s"] = 0.3
    assert w.run_once() == "retry_wait"
    assert env.job_row(jid)["error_class"] == "timeout"


def test_unknown_exception_is_engine_down(env):
    class Boom(FakeAdapter):
        def run(self, job):
            raise RuntimeError("secret path /family/x")   # 원문은 기록·로그에 남지 않는다
    a = env.artwork()
    jid = env.job(a, "split")
    w = make_worker(extra={"M1": Boom("M1", faults={})})
    w.run_once()
    assert env.job_row(jid)["error_class"] == "engine_down"


# ── 활성 버전 ──────────────────────────────────────────────────────────
def test_deactivated_model_queued_job_model_not_ready(env):
    a = env.artwork()
    jid = env.job(a, "split")
    env.q("UPDATE model_version SET release_state='retired' WHERE version_id=%s", env.versions["M1"])
    called = []

    class Spy(FakeAdapter):
        def run(self, job):
            called.append(1); return super().run(job)
    w = make_worker(extra={"M1": Spy("M1", faults={})})
    assert w.board.get("M1").state == "disabled"
    assert w.run_once() == "model_not_ready"
    r = env.job_row(jid)
    assert (r["status"], r["error_class"], r["model_version_id"]) == ("retry_wait", "model_not_ready", env.versions["M1"])
    assert called == []


def test_claim_records_current_active_version(env):
    a = env.artwork()
    jid = env.job(a, "split")
    env.q("UPDATE model_version SET release_state='retired' WHERE version_id=%s", env.versions["M1"])
    new = env.version("M1")
    w = make_worker()
    w.run_once()
    assert env.job_row(jid)["model_version_id"] == new


# ── 취소 ──────────────────────────────────────────────────────────────
def test_cancel_requested_before_claim(env):
    a = env.artwork()
    jid = env.job(a, "split")
    env.q("UPDATE stage_job SET cancel_requested_at=UTC_TIMESTAMP() WHERE job_id=%s", jid)
    assert make_worker().run_once() == "cancelled"
    r = env.job_row(jid)
    assert r["status"] == "cancelled" and r["stopped_at"] is not None and r["attempt_count"] == 0


def test_deleting_rechecked_before_write(env):
    a = env.artwork(status="processing")
    env.confirmed(a, "animated")
    jid = env.job(a, "animate_render", origin="confirm")
    seed = env

    class DeleteDuring(FakeAdapter):
        def run(self, job):
            seed.q("UPDATE artwork SET status='deleting', deleting_since=UTC_TIMESTAMP() WHERE artwork_id=%s", a)
            return super().run(job)
    w = make_worker(extra={"M3": DeleteDuring("M3", faults={})})
    assert w.run_once() == "cancelled"
    r = env.job_row(jid)
    assert r["status"] == "cancelled" and r["stopped_at"] and r["cancel_requested_at"]
    assert env.one("SELECT COUNT(*) n FROM result WHERE artwork_id=%s", a)["n"] == 0
    assert env.one("SELECT COUNT(*) n FROM stored_object WHERE artwork_id=%s AND object_kind LIKE 'result%%'", a)["n"] == 0


def test_cancel_detected_by_heartbeat(env):
    a = env.artwork(status="processing")
    env.confirmed(a, "animated")
    jid = env.job(a, "animate_render", origin="confirm")
    seen = []

    class Long(FakeAdapter):
        def run(self, job):
            seen.append(job.cancel.wait(5)); return AdapterResult("ok")
    w = make_worker(extra={"M3": Long("M3", faults={})})
    w.limits["claim"]["heartbeat_s"] = 0.2
    threading.Timer(0.3, lambda: env.q("UPDATE stage_job SET cancel_requested_at=UTC_TIMESTAMP() WHERE job_id=%s", jid)).start()
    assert w.run_once() == "cancelled"
    assert seen == [True]


# ── 점유 ──────────────────────────────────────────────────────────────
def test_skip_locked_two_workers(env):
    a1, a2 = env.artwork(), env.artwork()
    j1, j2 = env.job(a1, "split"), env.job(a2, "split")
    w1, w2 = make_worker(), make_worker()
    c1 = w1.claim(); c2 = w2.claim()
    assert {c1.job_id, c2.job_id} == {j1, j2}
    r = env.job_row(j1)
    assert r["status"] == "running" and r["claimed_by"] and r["claim_expires_at"] is not None


def test_priority_order(env):
    a1, a2 = env.artwork(), env.artwork()
    low = env.job(a1, "split"); high = env.job(a2, "split")
    env.q("UPDATE stage_job SET priority=50 WHERE job_id=%s", low)
    assert make_worker().claim().job_id == high


# ── 모델 적재 시간 ──────────────────────────────────────────────────────
def test_loading_model_blocks_claim_and_is_published(env):
    a = env.artwork()
    env.job(a, "split")
    w = make_worker(load_s=0.6, preload=False)
    t = threading.Thread(target=w.load_model, args=("M1",)); t.start()
    time.sleep(0.2)
    assert w.board.get("M1").state == "loading"
    assert "split" not in w.claimable_stages()
    assert w.run_once() is None                   # 적재 중에는 점유하지 않는다(작업은 대기)
    state = json.loads(w.board.file.read_text())
    assert state["models"]["M1"]["state"] == "loading" and state["models"]["M1"]["started_at"]
    t.join()
    assert w.board.get("M1").state == "ready" and w.board.get("M1").last_load_s >= 0.5
    assert w.run_once() == "done"


def test_load_failure_turns_into_model_not_ready(env):
    class Broken(FakeAdapter):
        def load(self):
            raise OSError("weights missing")
    a = env.artwork()
    jid = env.job(a, "split")
    w = make_worker(extra={"M1": Broken("M1", faults={})})
    assert w.board.get("M1").state == "failed"
    assert w.run_once() == "retry_wait"
    assert env.job_row(jid)["error_class"] == "model_not_ready"


def test_concurrent_flush_and_load_timeout(env):
    w = make_worker(preload=False)
    errs = []

    def spam():
        try:
            for _ in range(200):
                w.board.flush()
        except Exception as e:      # pragma: no cover
            errs.append(e)
    ts = [threading.Thread(target=spam) for _ in range(4)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert errs == []
    w.board.set("M1", state="loading", started_at=time.time() - 400)
    w.check_load_timeouts()
    assert w.board.get("M1").state == "failed" and w.board.get("M1").diagnostic == "load_timeout"


def test_overdue_hides_remaining():
    from common.model_state import describe
    d = describe({"state": "loading", "started_at": 100.0, "expected_s": 2.0}, now=120.0)
    assert d["overdue"] is True and d["remainingSeconds"] is None
    d = describe({"state": "loading", "started_at": 100.0, "expected_s": 10.0}, now=103.0)
    assert d["overdue"] is False and d["remainingSeconds"] == 7.0
