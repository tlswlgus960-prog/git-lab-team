"""외부 작업 실행(T122 워커 쪽, stage-job §9, D8·D13·D17) — model-api가 등록한 `external_job`을 같은 어댑터·활성 버전으로 처리한다.

- 보호자 작업(`stage_job`)이 없을 때만 본다(낮은 우선순위). 서빙군별 동시 1건은 `GET_LOCK('uam_ext_{group}', 0)`.
- 입력 `ext/{id}/input.*` → 어댑터 임시 `ext/{id}/work/` → `ext/{id}/result.json`(ExtResult 기능 필드) → `result_temp_ref`.
- 낮춤 체인은 타지 않는다(외부 결과는 요청한 기능 하나). 인프라 5종은 10초·60초 뒤 재시도, 3회째 failed.
- 점수·경로·입력은 로그에 남기지 않는다(BR-PRV-01).
"""
from __future__ import annotations

import base64
import json
import shutil
import threading
import time
from pathlib import Path

import pymysql

from adapters.base import INFRA, AdapterResult, JobInput
from common.db import connect, tx
from rules.m4_geometry import evaluate_file

from .records import active_version

# func → (모델, 어댑터 단계 이름) 순서
CHAIN = {
    "segment": (("M1", "split"),),
    "classify": (("M2", "judge"),),
    "pose": (("M3", "judge"),),
    "relief": (("M1", "split"), ("M5", "depth_relief")),
}
PRIMARY = {"segment": "M1", "classify": "M2", "pose": "M3", "relief": "M5"}


def _b64(path: str | Path) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


class ExternalRunner:
    def __init__(self, worker):
        self.w = worker

    # ── 이 워커가 맡을 수 있는 기능 ─────────────────────────────────────
    def funcs(self) -> list[str]:
        out = []
        for f, chain in CHAIN.items():
            owner = "M5" if f == "relief" else chain[0][0]
            if owner not in self.w.models:           # relief는 M5가 있는 서빙군, 나머지는 cpu_vision
                continue
            ok = True
            for m, _ in chain:
                if m in self.w.models:
                    ok = ok and self.w.board.get(m).state == "ready"
                # gpu 워커의 relief용 M1은 필요할 때 올린다(stage-job §9, [추론 U2])
            if ok:
                out.append(f)
        return out

    def _lock_name(self) -> str:
        return f"uam_ext_{self.w.group}"

    # ── 한 건 ──────────────────────────────────────────────────────────
    def run_once(self):
        funcs = self.funcs()
        if not funcs:
            return None
        conn = self.w.conn
        with tx(conn) as cur:
            cur.execute("SELECT GET_LOCK(%s, 0) g", (self._lock_name(),))
            if cur.fetchone()["g"] != 1:
                return None                          # 이 서빙군에서 외부 작업이 이미 돌고 있다
        try:
            job = self._claim(funcs)
            if job is None or isinstance(job, str):
                return job
            return self._process(job)
        finally:
            with tx(conn) as cur:
                cur.execute("SELECT RELEASE_LOCK(%s)", (self._lock_name(),))

    def _claim(self, funcs):
        ph = ",".join(["%s"] * len(funcs))
        claim_s = self.w.limits["claim"]["seconds"]
        with tx(self.w.conn) as cur:
            cur.execute(f"""SELECT * FROM external_job WHERE status = 'queued' AND available_at <= UTC_TIMESTAMP()
                              AND func IN ({ph}) ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED""", tuple(funcs))
            job = cur.fetchone()
            if not job:
                return None
            cur.execute("""UPDATE external_job SET status = 'running', attempt_count = attempt_count + 1, claimed_by = %s,
                                  claim_expires_at = UTC_TIMESTAMP() + INTERVAL %s SECOND,
                                  started_at = COALESCE(started_at, UTC_TIMESTAMP()), error_class = NULL
                            WHERE ext_job_id = %s""", (self.w.worker_id, claim_s, job["ext_job_id"]))
            job["attempt_count"] += 1
            # 등록 뒤 비활성화·라이선스 철회된 모델이면 부르지 않는다(G25)
            for m, _ in CHAIN[job["func"]]:
                v = active_version(cur, m)
                if v is None or not v["license_confirmed"]:
                    return self._finish_infra(cur, job, "model_not_ready")
        return job

    def _run_chain(self, job, work: Path) -> tuple[AdapterResult, dict]:
        d = self.w.storage.root / "ext" / str(job["ext_job_id"])
        inp = next(iter(sorted(d.glob("input.*"))), None)
        if inp is None:
            return AdapterResult("storage", diagnostic="ext_input_missing"), {}
        inputs = {"original": inp}
        outputs: dict[str, str] = {}
        values: dict = {}
        for m, stage in CHAIN[job["func"]]:
            if m in self.w.models and self.w.board.get(m).state != "ready":
                return AdapterResult("model_not_ready", diagnostic="model_" + self.w.board.get(m).state), {}
            a = self.w.adapter(m)
            a.ensure_loaded()
            sub = work / stage
            sub.mkdir(parents=True, exist_ok=True)
            r = a.run(JobInput(job_id=job["ext_job_id"], stage_kind=stage, tmp_dir=sub, inputs=dict(inputs)))
            if r.outcome != "ok":
                return r, {}
            outputs.update(r.outputs)
            values.update(r.values)
            if stage == "split":                     # relief: M5는 M1 컷아웃·마스크를 입력으로
                inputs.update({k: Path(v) for k, v in r.outputs.items() if k in ("cutout", "mask")})
        return AdapterResult("ok", outputs=outputs, values=values), outputs | {"_values": values}

    def _payload(self, func: str, out: dict) -> dict:
        v = out.get("_values", {})
        if func == "segment":
            return {"segment": {"maskPng": _b64(out["mask"]), "cutoutPng": _b64(out["cutout"])}}
        if func == "classify":                       # 종류와 태그만. 점수 없음(BR-SUG-02)
            return {"classify": {"kind": v.get("kind_candidate"), "tags": list(v.get("tags") or [])[:5]}}
        if func == "pose":
            sk = json.loads(Path(out["joints"]).read_text("utf-8")).get("skeleton", [])
            return {"pose": {"joints": [{"name": j["name"], "x": j["loc"][0], "y": j["loc"][1]} for j in sk],
                             "geometryRulePassed": bool(evaluate_file(Path(out["joints"])))}}
        return {"relief": {"cutoutPng": _b64(out["cutout"]), "depthPng16": _b64(out["result_relief"])}}

    def _timeout(self, func: str) -> float:
        st = self.w.limits["stages"]
        total = 0.0
        for _, stage in CHAIN[func]:
            s = st[stage]
            total += s.get("timeout_s_cpu", s["timeout_s"]) if (stage == "depth_relief" and self.w.group == "cpu_vision") else s["timeout_s"]
        return total

    def _heartbeat(self, job_id: int, done: threading.Event) -> None:
        hb, claim_s = self.w.limits["claim"]["heartbeat_s"], self.w.limits["claim"]["seconds"]
        conn = connect(self.w.s)
        try:
            while not done.wait(hb):
                with tx(conn) as cur:
                    cur.execute("""UPDATE external_job SET claim_expires_at = UTC_TIMESTAMP() + INTERVAL %s SECOND
                                    WHERE ext_job_id = %s AND status = 'running' AND claimed_by = %s""",
                                (claim_s, job_id, self.w.worker_id))
        except pymysql.MySQLError:
            pass                                     # 점유가 만료되면 sweeper가 이어받는다
        finally:
            conn.close()

    def _process(self, job) -> str:
        t0 = time.monotonic()
        jid = job["ext_job_id"]
        base = self.w.storage.root / "ext" / str(jid)
        work = base / "work"
        box: dict = {}
        done = threading.Event()

        def target():
            try:
                box["r"] = self._run_chain(job, work)
            except Exception:
                box["r"] = (AdapterResult("engine_down", diagnostic="adapter_exception"), {})

        threading.Thread(target=self._heartbeat, args=(jid, done), daemon=True).start()
        th = threading.Thread(target=target, daemon=True)
        th.start()
        th.join(self._timeout(job["func"]))
        res, out = box.get("r") or (AdapterResult("timeout", diagnostic="stage_timeout"), {})
        done.set()
        try:
            with tx(self.w.conn) as cur:
                if res.outcome == "ok":
                    payload = self._payload(job["func"], out)
                    status = self._finish(cur, job, base, payload, "ok")
                elif res.outcome == "quality_below":
                    status = self._finish(cur, job, base, {}, "quality_below")
                elif res.outcome in INFRA:
                    status = self._finish_infra(cur, job, res.outcome)
                else:
                    status = self._finish_infra(cur, job, "engine_down")
        except (pymysql.MySQLError, OSError):
            with tx(self.w.conn) as cur:
                status = self._finish_infra(cur, job, "storage")
        finally:
            shutil.rmtree(work, ignore_errors=True)
        self.w.log.info("ext_job_end", job_id=jid, model_id=PRIMARY[job["func"]], attempt_count=job["attempt_count"],
                        status=status, error_class=res.outcome if res.outcome in INFRA else None,
                        duration_ms=int((time.monotonic() - t0) * 1000))
        return status

    def _finish(self, cur, job, base: Path, payload: dict, result_class: str) -> str:
        (base / "result.json").write_text(json.dumps(payload), encoding="utf-8")
        cur.execute("""UPDATE external_job SET status = 'done', result_class = %s, error_class = NULL, result_temp_ref = %s,
                              finished_at = UTC_TIMESTAMP(), claimed_by = NULL, claim_expires_at = NULL
                        WHERE ext_job_id = %s""", (result_class, f"ext/{job['ext_job_id']}/result.json", job["ext_job_id"]))
        return "done"

    def _finish_infra(self, cur, job, error_class: str) -> str:
        backoff = self.w.limits["retry"]["backoff_s"]
        if job["attempt_count"] < self.w.limits["retry"]["max_attempts"]:
            cur.execute("""UPDATE external_job SET status = 'queued', error_class = %s, claimed_by = NULL, claim_expires_at = NULL,
                                  available_at = UTC_TIMESTAMP() + INTERVAL %s SECOND WHERE ext_job_id = %s""",
                        (error_class, backoff[min(job["attempt_count"], len(backoff)) - 1], job["ext_job_id"]))
            return "retry_wait"
        cur.execute("""UPDATE external_job SET status = 'failed', error_class = %s, finished_at = UTC_TIMESTAMP(),
                              claimed_by = NULL, claim_expires_at = NULL WHERE ext_job_id = %s""", (error_class, job["ext_job_id"]))
        return "failed"
