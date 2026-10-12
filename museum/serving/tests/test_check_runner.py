"""T155 — 모델 점검 실행(D20, stage-job §13, SD_01 7.9·§10-4 출력 형식 확인): 가짜 모델로."""
from __future__ import annotations

import uuid

import pytest
import yaml

from adapters.base import AdapterResult
from adapters.fake import FAKE_JOINTS, FakeAdapter, _png
from tests.seed import H
from tests.test_split_judge import M2, M3
from tests.test_stage_job_contract import make_worker


@pytest.fixture()
def ck(env, tmp_path):
    """점검 그림·점검 기록·점검 작업. env.check(model, category) → (check_id, job_id)."""
    for t in ("model_check", "eval_item_result", "evaluation", "eval_item", "team_member_role", "team_member"):
        env.cur.execute(f"DELETE FROM {t}")
    env.cur.execute("INSERT INTO team_member (email, password_hash) VALUES ('ops@team.test', 'x')")
    member = env.cur.lastrowid
    (tmp_path / "manifest.yaml").write_text(yaml.safe_dump(
        {"models": {m: {"weights_sha256": H, "config_hash": H} for m in ("M1", "M2", "M3", "M5")}}))

    def make(model_id, category="person", stage=None, group="cpu_vision"):
        vid = env.versions.get(model_id) or env.version(model_id)
        key = f"evalset/{uuid.uuid4().hex}.png"
        p = env.store / key
        p.parent.mkdir(parents=True, exist_ok=True)
        _png(p)                                   # 8×8 — 가짜 어댑터 출력과 같은 크기
        env.cur.execute("INSERT INTO stored_object (owner_kind, object_kind, object_key) VALUES ('eval_set', 'eval_input', %s)",
                        (key,))
        env.cur.execute("""INSERT INTO eval_item (category, expected_path, object_id, created_by, maker_attested)
                           VALUES (%s, 'relief', %s, %s, TRUE)""", (category, env.cur.lastrowid, member))
        iid = env.cur.lastrowid
        env.cur.execute("INSERT INTO model_check (model_id, version_id, eval_item_id, requested_by) VALUES (%s, %s, %s, %s)",
                        (model_id, vid, iid, member))
        cid = env.cur.lastrowid
        stage = stage or {"M1": "split", "M2": "judge", "M3": "animate_render", "M5": "depth_relief"}[model_id]
        env.cur.execute("""INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, eval_item_id,
                                                  model_check_id, priority) VALUES (%s, 'check', %s, %s, %s, %s, 30)""",
                        (stage, group, vid, iid, cid))
        return cid, env.cur.lastrowid

    env.check = make
    env.mc = lambda cid: env.one("SELECT * FROM model_check WHERE check_id = %s", cid)
    for m in ("M1", "M2", "M3", "M5"):
        if m not in env.versions:
            env.version(m)
    yield env
    env.cur.execute("DELETE FROM stage_job WHERE origin = 'check'")
    env.cur.execute("DELETE FROM model_check")   # 다른 시험의 eval_item·team_member 정리를 막지 않게


def _no_family_or_eval_writes(env):
    for t in ("judgment", "result", "eval_item_result", "artwork"):
        assert env.one(f"SELECT COUNT(*) n FROM {t}")["n"] == 0, t
    assert env.one("SELECT COUNT(*) n FROM stored_object WHERE owner_kind <> 'eval_set'")["n"] == 0


@pytest.mark.parametrize("model_id", ["M1", "M2", "M3", "M5"])
def test_check_passes_records_time_memory_and_writes_nothing_else(ck, model_id):
    cid, jid = ck.check(model_id)
    w = make_worker()
    assert w.run_once() == "passed" and w.run_once() is None
    c = ck.mc(cid)
    assert (c["status"], c["outcome"], c["fail_reason"]) == ("passed", "ok", None)
    assert c["processing_ms"] is not None and c["memory_mb"] > 0 and c["started_at"] and c["finished_at"]
    j = ck.job_row(jid)
    assert (j["status"], j["attempt_count"], j["error_class"]) == ("done", 1, None)
    _no_family_or_eval_writes(ck)
    assert not any(w.storage.tmp_dir(jid).iterdir())      # 출력 파일은 임시 영역에서 지웠다


def test_guardian_before_check_before_eval(ck):
    """점유 순서: 보호자 → 점검 → 평가. 보호자 점유 조건이 점검 작업을 잡지 않는다."""
    ck.cur.execute("INSERT INTO evaluation (version_id, requested_by, item_total) SELECT %s, MIN(member_id), 1 FROM team_member",
                   (ck.versions["M1"],))
    eid = ck.cur.lastrowid
    cid, cj = ck.check("M1")
    item = ck.one("SELECT eval_item_id FROM stage_job WHERE job_id = %s", cj)["eval_item_id"]
    ck.cur.execute("""INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, evaluation_id, eval_item_id, priority)
                      VALUES ('split', 'eval', 'cpu_vision', %s, %s, %s, 50)""", (ck.versions["M1"], eid, item))
    ej = ck.cur.lastrowid
    gj = ck.job(ck.artwork(), "split")
    w = make_worker()
    w.run_once()
    assert ck.job_row(gj)["status"] != "queued" and ck.job_row(cj)["status"] == "queued"
    ck.cur.execute("UPDATE stage_job SET available_at = UTC_TIMESTAMP() + INTERVAL 1 DAY WHERE origin NOT IN ('check','eval')")
    assert w.run_once() == "passed" and ck.job_row(ej)["status"] == "queued"
    w.run_once()
    assert ck.job_row(ej)["status"] == "done"


def test_bad_output_fails_without_error_class(ck):
    cid, jid = ck.check("M2")
    w = make_worker(extra={"M2": M2("dragon", 0.9)})     # 정의된 종류 4개 밖
    assert w.run_once() == "failed"
    c, j = ck.mc(cid), ck.job_row(jid)
    assert (c["status"], c["outcome"], c["fail_reason"]) == ("failed", "ok", "bad_output")
    assert (j["status"], j["error_class"]) == ("failed", None)


def test_m3_no_humanoid_is_bad_output(ck):
    cid, _ = ck.check("M3")
    w = make_worker(extra={"M3": M3(None, 0.0)})
    assert w.run_once() == "failed" and ck.mc(cid)["fail_reason"] == "bad_output"


def test_m3_missing_joint_is_bad_output(ck):
    cid, _ = ck.check("M3")
    skel = {"skeleton": [j for j in FAKE_JOINTS["skeleton"] if j["name"] != "left_foot"]}
    w = make_worker(extra={"M3": M3(skel, 0.9)})
    assert w.run_once() == "failed" and ck.mc(cid)["fail_reason"] == "bad_output"


def test_quality_below_passes(ck):
    cid, _ = ck.check("M1")
    w = make_worker(faults={"split": ("quality_below", None)})
    assert w.run_once() == "passed"
    c = ck.mc(cid)
    assert (c["status"], c["outcome"]) == ("passed", "quality_below")


def test_infra_error_fails_without_retry(ck):
    cid, jid = ck.check("M1")
    w = make_worker(faults={"split": ("engine_down", None)})
    assert w.run_once() == "failed" and w.run_once() is None
    c, j = ck.mc(cid), ck.job_row(jid)
    assert (c["status"], c["fail_reason"], c["outcome"]) == ("failed", "engine_down", None)
    assert (j["status"], j["error_class"], j["attempt_count"]) == ("failed", "engine_down", 1)


def test_manifest_changed_is_model_not_ready(ck, tmp_path):
    (tmp_path / "manifest.yaml").write_text(yaml.safe_dump({"models": {"M1": {"weights_sha256": "f" * 64, "config_hash": H}}}))
    cid, _ = ck.check("M1")
    assert make_worker().run_once() == "failed"
    assert ck.mc(cid)["fail_reason"] == "model_not_ready"


def test_failed_model_is_closed_without_waiting(ck):
    class Broken(FakeAdapter):
        def load(self):
            raise RuntimeError("load")
    cid, _ = ck.check("M1")
    w = make_worker(extra={"M1": Broken("M1", faults={})})
    assert w.board.get("M1").state == "failed"
    assert w.run_once() == "failed" and ck.mc(cid)["fail_reason"] == "model_not_ready"


def test_loading_model_waits(ck):
    ck.check("M1")
    w = make_worker(preload=False)                          # 적재 전(not_loaded) — 점유하지 않는다
    assert w.run_once() is None


def test_already_closed_by_app_is_cancelled(ck):
    cid, jid = ck.check("M1")
    ck.cur.execute("UPDATE model_check SET status = 'failed', fail_reason = 'model_not_ready', finished_at = UTC_TIMESTAMP() "
                   "WHERE check_id = %s", (cid,))
    assert make_worker().run_once() == "cancelled"
    assert ck.job_row(jid)["status"] == "cancelled" and ck.mc(cid)["fail_reason"] == "model_not_ready"


def test_output_check_rules_directly(tmp_path):
    from workers.stages.check import output_ok
    m = tmp_path / "m.png"
    _png(m)
    assert output_ok("M1", AdapterResult("ok", outputs={"mask": str(m)}), (8, 8))
    assert not output_ok("M1", AdapterResult("ok", outputs={"mask": str(m)}), (9, 8))      # 크기 다름
    assert not output_ok("M1", AdapterResult("ok", outputs={}), (8, 8))                    # 마스크 없음
    d = tmp_path / "d.png"
    _png(d, bit16=True)
    assert output_ok("M5", AdapterResult("ok", outputs={"result_relief": str(d)}), (8, 8))
    from PIL import Image
    Image.new("I;16", (8, 8), 500).save(tmp_path / "flat.png")
    assert not output_ok("M5", AdapterResult("ok", outputs={"result_relief": str(tmp_path / "flat.png")}), (8, 8))
    assert output_ok("M2", AdapterResult("ok", values={"kind_candidate": "house"}), None)
