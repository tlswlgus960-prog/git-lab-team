"""T122 워커 쪽 — model-api가 등록한 외부 작업을 워커가 같은 어댑터로 처리하고, 결과를 1회 수령한다(stage-job §9, D8·D17)."""
from __future__ import annotations

import base64

from tests.test_model_api import api, post  # noqa: F401 (fixture 재사용)
from tests.test_stage_job_contract import make_worker


def _run(api, fn, k, faults=None):
    jid = post(api.client, fn, k).json()["jobId"]
    return jid, make_worker(faults)


def _result(api, k, jid):
    return api.client.get(f"/v1/models/jobs/{jid}/result", headers={"X-API-Key": k})


def test_segment_end_to_end(api):
    k = api.key()
    jid, w = _run(api, "segment", k)
    assert w.run_once() == "done"
    st = api.client.get(f"/v1/models/jobs/{jid}", headers={"X-API-Key": k}).json()
    assert st["status"] == "done" and st["outcome"] == "ok" and st["durationMs"] is not None
    r = _result(api, k, jid).json()
    assert base64.b64decode(r["segment"]["maskPng"]).startswith(b"\x89PNG") and r["model"]["id"] == "M1"
    assert not (api.store / "ext" / jid).exists()                  # 전달 즉시 삭제(D8)


def test_classify_pose_relief_payloads(api):
    k = api.key()
    w = make_worker()
    ids = {fn: post(api.client, fn, k).json()["jobId"] for fn in ("classify", "pose")}
    assert w.run_once() == "done" and w.run_once() == "done"
    c = _result(api, k, ids["classify"]).json()["classify"]
    assert c == {"kind": "person", "tags": ["바다", "사람"]}            # 점수 없음
    p = _result(api, k, ids["pose"]).json()["pose"]
    assert p["geometryRulePassed"] is True and {"name", "x", "y"} <= set(p["joints"][0])
    rid = post(api.client, "relief", k).json()["jobId"]               # GPU 없음 → cpu_vision이 M1 → M5
    assert w.run_once() == "done"
    rel = _result(api, k, rid).json()["relief"]
    assert base64.b64decode(rel["cutoutPng"]).startswith(b"\x89PNG") and rel["depthPng16"]


def test_stage_jobs_first(api):
    k = api.key()
    jid = post(api.client, "segment", k).json()["jobId"]
    a = api.artwork()
    sj = api.job(a, "split")
    w = make_worker()
    w.run_once()
    assert api.job_row(sj)["status"] == "done"                        # 보호자 작업 먼저(D17)
    assert api.one("SELECT status FROM external_job WHERE ext_job_id=%s", int(jid))["status"] == "queued"
    assert w.run_once() == "done"


def test_infra_retry_then_failed_and_quality_below(api):
    k = api.key()
    jid, w = _run(api, "segment", k, {"split": ("timeout", None)})
    for expect in ("retry_wait", "retry_wait", "failed"):
        api.cur.execute("UPDATE external_job SET available_at = UTC_TIMESTAMP() WHERE ext_job_id = %s", (int(jid),))
        assert w.run_once() == expect
    row = api.one("SELECT status, error_class, attempt_count, result_class FROM external_job WHERE ext_job_id=%s", int(jid))
    assert row == {"status": "failed", "error_class": "timeout", "attempt_count": 3, "result_class": None}
    rid, w2 = _run(api, "relief", k, {"split": ("quality_below", None)})
    assert w2.run_once() == "done"
    r = _result(api, k, rid).json()
    assert r["outcome"] == "quality_below" and "relief" not in r


def test_one_external_per_group(api):
    k = api.key()
    post(api.client, "segment", k)
    from common.db import connect, tx
    c = connect()
    with tx(c) as cur:
        cur.execute("SELECT GET_LOCK('uam_ext_cpu_vision', 0) g")
        assert cur.fetchone()["g"] == 1                               # 다른 워커가 외부 작업 중인 상태
    try:
        assert make_worker().run_once() is None
    finally:
        with tx(c) as cur:
            cur.execute("SELECT RELEASE_LOCK('uam_ext_cpu_vision')")
        c.close()
    assert make_worker().run_once() == "done"
