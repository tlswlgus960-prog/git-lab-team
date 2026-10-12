"""평가 작업 실행(T117, stage-job §12, UC9 BF4·E4, SD_01 8.4) — app-api(G21)가 등록한 `origin='eval'` 작업을 같은 어댑터로 처리한다.

- 보호자 작업이 없을 때 본다(점유 순서: 보호자 → 평가 → 외부). 서빙군별 동시 1건은 `GET_LOCK('uam_eval_{group}', 0)`.
- 실행 직전 후보 버전 해시를 매니페스트와 다시 대조한다(다르면 재시도 없이 incomplete).
- 결과는 `eval_item_result`에만 쓴다. 가족 데이터는 건드리지 않는다(BR-ACC-03). 낮춤 체인은 타지 않는다.
- 인프라 오류는 10초·60초 뒤 재시도, 3회째 incomplete(E4). timeout은 재시도 없이 timeout.
- 로그에 입력 경로·점수를 남기지 않는다(BR-PRV-01).
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
import types

import pymysql

from adapters.base import INFRA, AdapterResult, JobInput
from common.config import load_manifest
from common.db import tx
from common.storage import StorageError
from rules.m4_geometry import evaluate_file, suggest

from .. import outcome

# 후보 모델 → (모델, 어댑터 단계) 순서. M5는 활성 M1 분리 뒤 깊이(stage-job §12 표)
CHAIN = {
    "M1": (("M1", "split"),),
    "M2": (("M2", "judge"), ("M3", "judge")),
    "M3": (("M3", "animate_render"),),
    "M5": (("M1", "split"), ("M5", "depth_relief")),
}
SAMPLE_S = 0.5


def result_path(model_id: str, res: AdapterResult) -> str:
    """이 모델의 결과가 이르는 경로(나머지 단계는 성공한다고 본다, stage-job §12 `[추론]`)."""
    ok = res.outcome == "ok"
    if model_id == "M1":
        return "relief" if ok else "frame"
    if model_id == "M2":
        geo = evaluate_file(res.outputs["joints"]) if "joints" in res.outputs else None
        return suggest(True, res.values.get("kind_candidate"), geo)
    if model_id == "M3":
        return "animated" if ok else "relief"
    if model_id == "M5":
        return "relief" if ok else "frame"
    raise KeyError(model_id)


def _rss_tree_mb(pid: int) -> int:
    """프로세스와 그 하위 프로세스의 RSS 합(MB). ps 한 번으로 읽는다."""
    try:
        out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,rss="], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return 0
    rows = [tuple(int(x) for x in line.split()) for line in out.splitlines() if len(line.split()) == 3]
    kids: dict[int, list[int]] = {}
    rss = {}
    for p, pp, r in rows:
        kids.setdefault(pp, []).append(p)
        rss[p] = r
    total, stack = 0, [pid]
    while stack:
        p = stack.pop()
        total += rss.get(p, 0)
        stack.extend(kids.get(p, []))
    return total // 1024


class _Peak:
    def __init__(self, pid: int):
        self.pid, self.peak, self._stop = pid, 0, threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while True:
            self.peak = max(self.peak, _rss_tree_mb(self.pid))
            if self._stop.wait(SAMPLE_S):
                return

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self._t.join(5)


class EvalRunner:
    def __init__(self, worker):
        self.w = worker

    # ── 이 워커가 맡을 수 있는 후보 모델 ─────────────────────────────────
    def models(self) -> list[str]:
        """평가할 후보 모델은 이 서빙군에 있고 ready여야 한다. 사슬 앞의 보조 모델(M5의 M1)이 이 서빙군에
        없으면 필요할 때 올린다(§9 외부 작업과 같음, [추론 U2])."""
        out = []
        for m, chain in CHAIN.items():
            if m not in self.w.models:
                continue
            if all(self.w.board.get(x).state == "ready" for x, _ in chain if x in self.w.models):
                out.append(m)
        return out

    def _lock_name(self) -> str:
        return f"uam_eval_{self.w.group}"

    def reconcile(self) -> int:
        """이어받기로 failed가 된 평가 작업에 결과가 없으면 incomplete를 채운다(stage-job §12)."""
        with tx(self.w.conn) as cur:
            cur.execute("""INSERT IGNORE INTO eval_item_result (evaluation_id, item_id, status)
                           SELECT j.evaluation_id, j.eval_item_id, 'incomplete' FROM stage_job j
                            WHERE j.origin = 'eval' AND j.status = 'failed'
                              AND NOT EXISTS (SELECT 1 FROM eval_item_result r
                                               WHERE r.evaluation_id = j.evaluation_id AND r.item_id = j.eval_item_id)""")
            return cur.rowcount

    # ── 한 건 ──────────────────────────────────────────────────────────
    def run_once(self):
        models = self.models()
        if not models:
            return None
        self.reconcile()
        with tx(self.w.conn) as cur:
            cur.execute("SELECT GET_LOCK(%s, 0) g", (self._lock_name(),))
            if cur.fetchone()["g"] != 1:
                return None
        try:
            job = self._claim(models)
            if job is None or isinstance(job, str):
                return job
            return self._process(job)
        finally:
            with tx(self.w.conn) as cur:
                cur.execute("SELECT RELEASE_LOCK(%s)", (self._lock_name(),))

    def _claim(self, models):
        ph = ",".join(["%s"] * len(models))
        claim_s = self.w.limits["claim"]["seconds"]
        with tx(self.w.conn) as cur:
            cur.execute(f"""SELECT * FROM stage_job
                             WHERE origin = 'eval' AND serving_group = %s AND status IN ('queued','retry_wait')
                               AND available_at <= UTC_TIMESTAMP()
                               AND model_version_id IN (SELECT version_id FROM model_version WHERE model_id IN ({ph}))
                             ORDER BY priority, queued_at LIMIT 1 FOR UPDATE SKIP LOCKED""", (self.w.group, *models))
            job = cur.fetchone()
            if not job:
                return None
            if job["cancel_requested_at"] is not None:
                outcome.mark_cancelled(cur, job["job_id"])
                return "cancelled"
            cur.execute("""UPDATE stage_job SET status = 'running', attempt_count = attempt_count + 1, claimed_by = %s,
                                  claim_expires_at = UTC_TIMESTAMP() + INTERVAL %s SECOND,
                                  started_at = COALESCE(started_at, UTC_TIMESTAMP()), error_class = NULL
                            WHERE job_id = %s""", (self.w.worker_id, claim_s, job["job_id"]))
            job["attempt_count"] += 1
            cur.execute("""SELECT mv.model_id, mv.weights_sha256, mv.config_hash, so.object_key
                             FROM model_version mv
                             JOIN eval_item ei ON ei.item_id = %s
                             LEFT JOIN stored_object so ON so.object_id = ei.object_id
                            WHERE mv.version_id = %s""", (job["eval_item_id"], job["model_version_id"]))
            job.update(cur.fetchone())
            man = (load_manifest().get("models") or {}).get(job["model_id"]) or {}
            if man.get("weights_sha256") != job["weights_sha256"] or man.get("config_hash") != job["config_hash"]:
                return self._close(cur, job, "incomplete", AdapterResult("model_not_ready", diagnostic="manifest_changed"),
                                   final=True)
            if not job["object_key"]:
                return self._close(cur, job, "incomplete", AdapterResult("storage", diagnostic="eval_input_missing"),
                                   final=True)
        return job

    def _run_chain(self, job, jin_base: JobInput) -> AdapterResult:
        inputs = {"original": self.w.storage.path(job["object_key"])}
        values, outputs, score = {}, {}, None
        for m, stage in CHAIN[job["model_id"]]:
            if m in self.w.models and self.w.board.get(m).state != "ready":
                return AdapterResult("model_not_ready", diagnostic="model_" + self.w.board.get(m).state)
            a = self.w.adapter(m)
            a.ensure_loaded()
            sub = jin_base.tmp_dir / f"{m}_{stage}"
            sub.mkdir(parents=True, exist_ok=True)
            r = a.run(JobInput(job_id=job["job_id"], stage_kind=stage, tmp_dir=sub,
                                               inputs=dict(inputs), cancel=jin_base.cancel))
            if r.outcome != "ok":
                return r
            values.update(r.values); outputs.update(r.outputs)
            inputs.update({k: v for k, v in r.outputs.items()})
            if m == job["model_id"]:
                score = r.score
        return AdapterResult("ok", score=score, outputs=outputs, values=values)

    def _timeout(self, model_id: str) -> float:
        return sum(self.w._timeout(stage) for stage in dict.fromkeys(st for _, st in CHAIN[model_id]))

    def _process(self, job) -> str:
        t0 = time.monotonic()
        cancel, user_cancel, done = threading.Event(), threading.Event(), threading.Event()
        jin = JobInput(job_id=job["job_id"], stage_kind=job["stage_kind"], tmp_dir=self.w.storage.tmp_dir(job["job_id"]),
                       inputs={}, cancel=cancel)
        ctx = types.SimpleNamespace(job_id=job["job_id"], artwork_id=None)
        box: dict = {}

        def target():
            try:
                box["r"] = self._run_chain(job, jin)
            except StorageError:
                box["r"] = AdapterResult("storage", diagnostic="storage_error")
            except Exception:
                box["r"] = AdapterResult("engine_down", diagnostic="adapter_exception")

        hb = threading.Thread(target=self.w._heartbeat, args=(ctx, cancel, user_cancel, done), daemon=True)
        hb.start()
        with _Peak(os.getpid()) as peak:
            run_t0 = time.monotonic()
            th = threading.Thread(target=target, daemon=True)
            th.start()
            th.join(self._timeout(job["model_id"]))
            if th.is_alive():
                cancel.set()
                res = AdapterResult("timeout", diagnostic="stage_timeout")
            else:
                res = box["r"]
            ms = int((time.monotonic() - run_t0) * 1000)
        done.set()
        try:
            status = self._commit(job, res, ms, peak.peak, user_cancel)
        finally:
            self.w.storage.clear_tmp(job["job_id"])
        self.w.log.info("eval_end", job_id=job["job_id"], stage_kind=job["stage_kind"], model_id=job["model_id"],
                        attempt_count=job["attempt_count"], status=status,
                        error_class=res.outcome if res.outcome in INFRA else None,
                        duration_ms=int((time.monotonic() - t0) * 1000))
        return status

    def _commit(self, job, res: AdapterResult, ms: int, mb: int, user_cancel) -> str:
        try:
            with tx(self.w.conn) as cur:
                cur.execute("SELECT cancel_requested_at FROM stage_job WHERE job_id = %s FOR UPDATE", (job["job_id"],))
                if user_cancel.is_set() or cur.fetchone()["cancel_requested_at"] is not None:
                    outcome.mark_cancelled(cur, job["job_id"])
                    return "cancelled"
                if res.outcome in ("ok", "quality_below"):
                    return self._close(cur, job, "done", res, ms=ms, mb=mb)
                if res.outcome == "timeout":
                    return self._close(cur, job, "timeout", res, ms=ms, mb=mb, final=True)
                return self._close(cur, job, "incomplete", res, final=False)
        except pymysql.MySQLError as e:
            self.w.log.warning("eval_db_error", job_id=job["job_id"], errno=e.args[0] if e.args else None)  # D50, 원문 금지
            return "db_error"

    def _close(self, cur, job, eval_status: str, res: AdapterResult, ms=None, mb=None, final=False) -> str:
        if eval_status == "incomplete" and not final and job["attempt_count"] < outcome.MAX_ATTEMPTS:
            cur.execute("""UPDATE stage_job SET status = 'retry_wait', error_class = %s,
                                  available_at = UTC_TIMESTAMP() + INTERVAL %s SECOND, claimed_by = NULL, claim_expires_at = NULL
                            WHERE job_id = %s""", (res.outcome, outcome.backoff_s(job["attempt_count"]), job["job_id"]))
            return "retry_wait"
        path = result_path(job["model_id"], res) if eval_status == "done" else None
        score = res.score if eval_status == "done" and res.score is not None else None
        cur.execute("""INSERT INTO eval_item_result (evaluation_id, item_id, status, result_path, score, processing_ms, memory_mb)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       ON DUPLICATE KEY UPDATE status = VALUES(status), result_path = VALUES(result_path), score = VALUES(score),
                         processing_ms = VALUES(processing_ms), memory_mb = VALUES(memory_mb)""",
                    (job["evaluation_id"], job["eval_item_id"], eval_status, path,
                     round(score, 4) if score is not None else None, ms, mb))
        if eval_status == "done":
            outcome._close(cur, job["job_id"], "done")
            return "done"
        err = res.outcome if res.outcome in INFRA else "engine_down"
        outcome._close(cur, job["job_id"], "failed", error_class=err)
        return "failed"
