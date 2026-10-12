"""T117 — 평가 작업 실행(stage-job §12, UC9 BF4·E4, SD_01 8.4): 가짜 모델로."""
from __future__ import annotations

import time
import uuid

import pytest
import yaml

from adapters.base import AdapterResult
from adapters.fake import FakeAdapter
from tests.seed import H
from tests.test_split_judge import M2
from tests.test_stage_job_contract import make_worker
from workers.stages.eval import EvalRunner, result_path


@pytest.fixture()
def ev(env, tmp_path):
    """평가 묶음·후보 버전·매니페스트. env.eval(model, [(category, expected)...]) → (evaluation_id, job_ids)."""
    for t in ("eval_item_result", "evaluation", "eval_item", "team_member_role", "team_member"):
        env.cur.execute(f"DELETE FROM {t}")
    env.cur.execute("INSERT INTO team_member (email, password_hash) VALUES ('eval@team.test', 'x')")
    member = env.cur.lastrowid
    (tmp_path / "manifest.yaml").write_text(yaml.safe_dump(
        {"models": {m: {"weights_sha256": H, "config_hash": H} for m in ("M1", "M2", "M3", "M5")}}))

    def make(model_id, items, group="cpu_vision"):
        vid = env.version(model_id, state="candidate", label=f"{model_id}-cand-{uuid.uuid4().hex[:4]}")
        env.cur.execute("INSERT INTO evaluation (version_id, requested_by, item_total) VALUES (%s, %s, %s)",
                        (vid, member, len(items)))
        eid = env.cur.lastrowid
        jobs = []
        stage = {"M1": "split", "M2": "judge", "M3": "animate_render", "M5": "depth_relief"}[model_id]
        for category, expected in items:
            key = f"evalset/{uuid.uuid4().hex}.png"
            p = env.store / key
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"\x89PNG fake eval input")
            env.cur.execute("INSERT INTO stored_object (owner_kind, object_kind, object_key) VALUES ('eval_set', 'eval_input', %s)",
                            (key,))
            env.cur.execute("""INSERT INTO eval_item (category, expected_path, object_id, created_by, maker_attested)
                               VALUES (%s, %s, %s, %s, TRUE)""", (category, expected, env.cur.lastrowid, member))
            iid = env.cur.lastrowid
            env.cur.execute("""INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, evaluation_id,
                                                      eval_item_id, priority) VALUES (%s, 'eval', %s, %s, %s, %s, 50)""",
                            (stage, group, vid, eid, iid))
            jobs.append(env.cur.lastrowid)
        return eid, jobs

    env.eval = make
    return env


def results(env, eid):
    return env.q("""SELECT r.item_id, r.status, r.result_path, r.processing_ms, r.memory_mb, i.expected_path
                      FROM eval_item_result r JOIN eval_item i ON i.item_id = r.item_id
                     WHERE r.evaluation_id = %s ORDER BY r.item_id""", eid)


def test_m2_eval_records_path_time_memory_and_leaves_family_data(ev):
    eid, jobs = ev.eval("M2", [("person", "animated"), ("non_person", "relief")])
    w = make_worker()
    assert w.run_once() == "done" and w.run_once() == "done" and w.run_once() is None
    rs = results(ev, eid)
    assert [(r["status"], r["result_path"]) for r in rs] == [("done", "animated"), ("done", "animated")]  # 가짜 M2는 늘 person
    assert all(r["processing_ms"] is not None and r["memory_mb"] > 0 for r in rs)
    assert all(ev.job_row(j)["status"] == "done" for j in jobs)
    assert ev.one("SELECT COUNT(*) n FROM judgment")["n"] == 0 and ev.one("SELECT COUNT(*) n FROM artwork")["n"] == 0
    p = ev.one("SELECT done_count, incomplete_count FROM v_promotion_eligibility WHERE evaluation_id=%s", eid)
    assert (p["done_count"], p["incomplete_count"]) == (2, 0)


def test_house_item_mismatch_is_visible(ev):
    """집 그림 항목에서 후보 M2가 house면 기대 경로 relief와 일치, person이면 불일치로 남는다(오인 후보)."""
    eid, _ = ev.eval("M2", [("non_person", "relief")])
    w = make_worker(extra={"M2": M2("house", 0.946)})
    assert w.run_once() == "done"
    assert results(ev, eid)[0]["result_path"] == "relief"


def test_guardian_job_goes_first(ev):
    eid, jobs = ev.eval("M1", [("person", "animated")])
    a = ev.artwork()
    sj = ev.job(a, "split"); jj = ev.job(a, "judge", future=True)
    w = make_worker()
    assert w.run_once() == "done" and ev.job_row(sj)["status"] == "done"        # 보호자 작업 먼저
    assert w.run_once() == "done" and ev.job_row(jj)["status"] == "done"        # 분리가 연 판정도 보호자 작업
    assert ev.job_row(jobs[0])["status"] == "queued"
    assert w.run_once() == "done" and ev.job_row(jobs[0])["status"] == "done"


def test_infra_retries_then_incomplete(ev):
    eid, jobs = ev.eval("M1", [("person", "relief")])
    w = make_worker({"split": ("engine_down", None)})
    for want in ("retry_wait", "retry_wait", "failed"):
        assert w.run_once() == want
        ev.make_ready(jobs[0])
    r = results(ev, eid)[0]
    assert (r["status"], r["result_path"]) == ("incomplete", None)
    assert ev.job_row(jobs[0])["error_class"] == "engine_down" and ev.job_row(jobs[0])["attempt_count"] == 3
    assert ev.one("SELECT eligible FROM v_promotion_eligibility WHERE evaluation_id=%s", eid)["eligible"] == 0


class Slow(FakeAdapter):
    def run(self, job):
        job.cancel.wait(5)
        return AdapterResult("ok")


def test_timeout_is_recorded_without_retry(ev):
    eid, jobs = ev.eval("M1", [("person", "relief")])
    w = make_worker(extra={"M1": Slow("M1", faults={})})
    w.limits["stages"]["split"]["timeout_s"] = 0.5
    t = time.monotonic()
    assert w.run_once() == "failed" and time.monotonic() - t < 5
    r = results(ev, eid)[0]
    assert r["status"] == "timeout" and r["processing_ms"] >= 400
    j = ev.job_row(jobs[0])
    assert (j["status"], j["error_class"], j["attempt_count"]) == ("failed", "timeout", 1)


def test_manifest_changed_after_request_is_incomplete(ev, tmp_path):
    eid, jobs = ev.eval("M1", [("person", "relief")])
    (tmp_path / "manifest.yaml").write_text(yaml.safe_dump({"models": {"M1": {"weights_sha256": "f" * 64, "config_hash": H}}}))
    w = make_worker()
    assert w.run_once() == "failed"
    assert results(ev, eid)[0]["status"] == "incomplete" and ev.job_row(jobs[0])["attempt_count"] == 1


def test_sweeper_failed_job_gets_incomplete(ev):
    eid, jobs = ev.eval("M1", [("person", "relief")])
    ev.cur.execute("""UPDATE stage_job SET status='failed', error_class='engine_down', attempt_count=3,
                      finished_at=UTC_TIMESTAMP() WHERE job_id=%s""", (jobs[0],))
    w = make_worker()
    assert EvalRunner(w).reconcile() == 1
    assert results(ev, eid)[0]["status"] == "incomplete"


def test_m5_chain_uses_split_then_depth(ev):
    eid, _ = ev.eval("M5", [("sculpture", "relief"), ("capture_condition", "frame")])
    w = make_worker()
    assert w.run_once() == "done"
    w.adapter("M1").faults = {"split": ("quality_below", None)}         # 두 번째 항목은 분리 미달
    assert w.run_once() == "done"
    assert [r["result_path"] for r in results(ev, eid)] == ["relief", "frame"]


@pytest.mark.parametrize("model,res,want", [
    ("M1", AdapterResult("ok"), "relief"), ("M1", AdapterResult("quality_below"), "frame"),
    ("M3", AdapterResult("ok"), "animated"), ("M3", AdapterResult("quality_below"), "relief"),
    ("M5", AdapterResult("ok"), "relief"), ("M5", AdapterResult("quality_below"), "frame"),
    ("M2", AdapterResult("ok", values={"kind_candidate": "animal"}), "relief"),
])
def test_result_path_table(model, res, want):
    assert result_path(model, res) == want


# ── eval/runner.py 보고서(SD_01 8.5) ────────────────────────────────────
def _cli():
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location("eval_runner", Path(__file__).resolve().parents[2] / "eval" / "runner.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def test_report_candidate_vs_active_and_misclass_first(ev, capsys):
    cli = _cli()
    # 활성 버전의 지난 평가: 집 그림을 relief로(맞음)
    a_eid, _ = ev.eval("M2", [("non_person", "relief")])
    make_worker(extra={"M2": M2("house", 0.9)}).run_once()
    ev.cur.execute("UPDATE model_version SET release_state='retired' WHERE model_id='M2' AND release_state='active'")
    ev.cur.execute("UPDATE model_version SET release_state='active' WHERE version_id=(SELECT version_id FROM evaluation WHERE evaluation_id=%s)", (a_eid,))
    # 후보: 사람 항목은 맞고, 집 항목을 animated로(오인)
    eid, _ = ev.eval("M2", [("person", "animated"), ("non_person", "relief"), ("person", "animated")])
    w = make_worker()
    for _ in range(3):
        w.run_once()
    rep = cli.report(eid)
    c = rep["candidate_summary"]
    assert (c["item_total"], c["done"], c["incomplete"], c["match_rate"]) == (3, 3, 0, round(2 / 3, 4))
    assert c["mismatches"][0]["expected"] == "relief" and c["mismatches"][0]["got"] == "animated"
    assert rep["active_summary"]["match_rate"] == 1.0 and rep["eligible"] is False     # 판단 미기록·라이선스 전
    cli._print(rep)
    out = capsys.readouterr().out
    assert "기대 경로 일치율" in out and "기대 relief → 결과 animated" in out and "score" not in out


def test_run_cli_processes_only_eval_jobs(ev):
    cli = _cli()
    eid, jobs = ev.eval("M1", [("person", "relief"), ("person", "relief")])
    a = ev.artwork(); sj = ev.job(a, "split")
    assert cli.run("cpu_vision") == 0
    assert all(ev.job_row(j)["status"] == "done" for j in jobs)
    assert ev.job_row(sj)["status"] == "queued"                                  # 보호자 작업은 건드리지 않는다


def test_summary_scores_by_model_expected_path():
    """채점(D57): M1·M5는 기대 animated를 relief로 본다 — 분리가 되면 맞음. M2·M3는 그대로."""
    cli = _cli()
    rows = [{"item_id": 1, "status": "done", "result_path": "relief", "expected_path": "animated", "category": "person",
             "processing_ms": 10, "memory_mb": 1, "misclass_label": None},
            {"item_id": 2, "status": "done", "result_path": "frame", "expected_path": "relief", "category": "non_person",
             "processing_ms": 10, "memory_mb": 1, "misclass_label": None}]
    assert cli.summarize(rows, 2, "M1")["match_rate"] == 0.5          # 1은 맞음, 2는 분리 실패라 틀림
    assert cli.summarize(rows, 2, "M5")["match_rate"] == 0.5
    assert cli.summarize(rows, 2, "M2")["match_rate"] == 0.0          # 판정 제안은 그대로 비교
