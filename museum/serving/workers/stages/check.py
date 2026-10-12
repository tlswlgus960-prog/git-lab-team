"""모델 점검 실행(T155, D20, stage-job §13, SD_01 7.9) — app-api(G30)가 등록한 `origin='check'` 작업을 처리한다.

- 점유 순서: 보호자 작업 → **점검 작업** → 평가 작업 → 외부 작업(`workers/runner.py`).
- 그 모델의 어댑터만 한 번. M2는 M2 분류만, M3는 관절 추정까지(렌더 제외), M5는 깊이 추정까지(부조 합성 제외 —
  점검 그림 전체를 불투명 컷아웃으로 넣는다). **재시도 없음.**
- 판정: `ok` + 출력 형식 확인(SD_01 §10-4 표) 통과 → passed. `quality_below`는 모델 자신의 품질 규칙이 낸 결과라
  출력 파일이 없어도 passed. 형식 불량 → failed·bad_output. 인프라 5종 → failed·그 분류.
- 기록: `model_check`(결과·처리 시간·메모리·시각)와 `stage_job`만. 출력 파일은 임시 영역에서 지운다.
  가족 데이터·`stored_object`·`result`·`eval_item_result`에 쓰지 않는다(BR-OPS-05). 점수는 남기지 않는다(BR-OPS-06).
- 로그는 허용 목록만(모델·단계·결과 분류·처리 시간). 파일 경로·객체 키를 남기지 않는다(BR-PRV-01).
"""
from __future__ import annotations

import json
import os
import threading
import time
import types
from pathlib import Path

import pymysql

from adapters.base import INFRA, AdapterResult, JobInput
from common.config import load_manifest, load_yaml
from common.db import tx
from common.storage import StorageError

from .. import outcome
from .eval import _Peak

# 점검 모델 → 어댑터 단계(app-api의 작업 단계와 다를 수 있다: M2·M3는 judge 단계에서 그 모델 몫만 돈다)
ADAPTER_STAGE = {"M1": "split", "M2": "judge", "M3": "judge", "M5": "depth_relief", "M7": "sculpture"}
# Animated Drawings 골격 16개(adapters/m3_joints.extract와 같은 이름)
AD_SKELETON = ("root", "hip", "torso", "neck", "right_shoulder", "right_elbow", "right_hand", "left_shoulder",
               "left_elbow", "left_hand", "right_hip", "right_knee", "right_foot", "left_hip", "left_knee", "left_foot")


def _image_size(path) -> tuple[int, int] | None:
    from PIL import Image
    try:
        with Image.open(path) as im:
            return im.size
    except (OSError, TypeError):
        return None


def output_ok(model_id: str, res: AdapterResult, input_size: tuple[int, int] | None) -> bool:
    """SD_01 §10-4 출력 형식 확인. `ok` 결과에만 쓴다."""
    from PIL import Image
    try:
        if model_id == "M1":
            with Image.open(res.outputs["mask"]) as m:
                return m.size == input_size and m.getbbox() is not None
        if model_id == "M2":
            return res.values.get("kind_candidate") in (load_yaml("m2_prompts").get("kinds") or {})
        if model_id == "M3":
            skel = json.loads(Path(res.outputs["joints"]).read_text()).get("skeleton") or []
            locs = {j.get("name"): j.get("loc") for j in skel if isinstance(j, dict)}
            return all(isinstance(locs.get(n), list) and len(locs[n]) == 2
                       and all(isinstance(v, (int, float)) for v in locs[n]) for n in AD_SKELETON)
        if model_id == "M5":
            with Image.open(res.outputs["result_relief"]) as d:
                lo, hi = d.convert("I").getextrema()
                return d.size == input_size and lo != hi
        if model_id == "M7":
            # GLB 머리글(glTF) + 전용 환경이 다시 읽은 면 수(m7_run.py가 알려 준다)
            with open(res.outputs["result_glb"], "rb") as f:
                return f.read(4) == b"glTF" and res.values.get("reload_faces", 1) > 0
    except (KeyError, OSError, ValueError, TypeError, json.JSONDecodeError):
        return False
    return False


class CheckRunner:
    def __init__(self, worker):
        self.w = worker

    def _models(self) -> list[str]:
        """점유할 수 있는 점검 대상: 이 서빙군 모델 가운데 적재 중이 아닌 것(적재 중이면 평가와 같이 기다린다)."""
        return [m for m in self.w.models if self.w.board.get(m).state in ("ready", "failed", "disabled")]

    def run_once(self):
        models = self._models()
        if not models:
            return None
        job = self._claim(models)
        if job is None or isinstance(job, str):
            return job
        return self._process(job)

    # ── 점유 ──────────────────────────────────────────────────────────
    def _claim(self, models):
        ph = ",".join(["%s"] * len(models))
        claim_s = self.w.limits["claim"]["seconds"]
        with tx(self.w.conn) as cur:
            cur.execute(f"""SELECT j.*, c.model_id AS check_model_id FROM stage_job j
                              JOIN model_check c ON c.check_id = j.model_check_id
                             WHERE j.origin = 'check' AND j.serving_group = %s AND j.status IN ('queued','retry_wait')
                               AND j.available_at <= UTC_TIMESTAMP() AND c.model_id IN ({ph})
                             ORDER BY j.priority, j.queued_at LIMIT 1 FOR UPDATE SKIP LOCKED""",
                        (self.w.group, *models))
            job = cur.fetchone()
            if not job:
                return None
            cur.execute("""UPDATE model_check SET status = 'running', started_at = UTC_TIMESTAMP()
                            WHERE check_id = %s AND status = 'queued'""", (job["model_check_id"],))
            if job["cancel_requested_at"] is not None or cur.rowcount == 0:
                outcome.mark_cancelled(cur, job["job_id"])   # app-api가 시작 대기 초과로 이미 닫았다
                return "cancelled"
            cur.execute("""UPDATE stage_job SET status = 'running', attempt_count = attempt_count + 1, claimed_by = %s,
                                  claim_expires_at = UTC_TIMESTAMP() + INTERVAL %s SECOND,
                                  started_at = COALESCE(started_at, UTC_TIMESTAMP()), error_class = NULL
                            WHERE job_id = %s""", (self.w.worker_id, claim_s, job["job_id"]))
            job["attempt_count"] += 1
            job["model_id"] = job.pop("check_model_id")
            cur.execute("""SELECT mv.weights_sha256, mv.config_hash, so.object_key
                             FROM model_version mv
                             JOIN eval_item ei ON ei.item_id = %s
                             LEFT JOIN stored_object so ON so.object_id = ei.object_id
                            WHERE mv.version_id = %s""", (job["eval_item_id"], job["model_version_id"]))
            job.update(cur.fetchone() or {})
            m = job["model_id"]
            st = self.w.board.get(m).state
            if st != "ready":
                return self._close(cur, job, AdapterResult("model_not_ready", diagnostic="model_" + st))
            man = (load_manifest().get("models") or {}).get(m) or {}
            if man.get("weights_sha256") != job.get("weights_sha256") or man.get("config_hash") != job.get("config_hash"):
                return self._close(cur, job, AdapterResult("model_not_ready", diagnostic="manifest_changed"))
            if not job.get("object_key"):
                return self._close(cur, job, AdapterResult("storage", diagnostic="check_input_missing"))
        return job

    # ── 실행 ──────────────────────────────────────────────────────────
    def _inputs(self, job, tmp: Path) -> tuple[dict, tuple[int, int] | None]:
        src = self.w.storage.path(job["object_key"])
        size = _image_size(src)
        if size is None:
            raise StorageError("check input unreadable")
        if job["model_id"] == "M5":
            from PIL import Image
            p = tmp / "check_cutout.png"
            with Image.open(src) as im:
                im.convert("RGBA").save(p)          # 알파 전부 불투명 = 그림 전체를 컷아웃으로
            return {"cutout": p}, size
        return {"original": src}, size

    def _process(self, job) -> str:
        t0 = time.monotonic()
        m = job["model_id"]
        stage = ADAPTER_STAGE[m]
        cancel, user_cancel, done = threading.Event(), threading.Event(), threading.Event()
        tmp = self.w.storage.tmp_dir(job["job_id"])
        ctx = types.SimpleNamespace(job_id=job["job_id"], artwork_id=None)
        box: dict = {}

        def target():
            try:
                inputs, box["size"] = self._inputs(job, tmp)
                box["r"] = self.w.adapter(m).run(JobInput(job_id=job["job_id"], stage_kind=stage, tmp_dir=tmp,
                                                          inputs=inputs, cancel=cancel))
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
            th.join(self.w._timeout(job["stage_kind"]))
            if th.is_alive():
                cancel.set()
                res = AdapterResult("timeout", diagnostic="stage_timeout")
            else:
                res = box["r"]
            ms = int((time.monotonic() - run_t0) * 1000)
        done.set()
        try:
            status = self._commit(job, res, box.get("size"), ms, peak.peak, user_cancel)
        finally:
            self.w.storage.clear_tmp(job["job_id"])
        self.w.log.info("check_end", job_id=job["job_id"], stage_kind=job["stage_kind"], model_id=m, status=status,
                        error_class=res.outcome if res.outcome in INFRA else None,
                        duration_ms=int((time.monotonic() - t0) * 1000))
        return status

    def _commit(self, job, res: AdapterResult, size, ms: int, mb: int, user_cancel) -> str:
        try:
            with tx(self.w.conn) as cur:
                cur.execute("SELECT cancel_requested_at FROM stage_job WHERE job_id = %s FOR UPDATE", (job["job_id"],))
                if user_cancel.is_set() or cur.fetchone()["cancel_requested_at"] is not None:
                    outcome.mark_cancelled(cur, job["job_id"])
                    cur.execute("""UPDATE model_check SET status = 'failed', fail_reason = 'model_not_ready',
                                          finished_at = UTC_TIMESTAMP() WHERE check_id = %s AND status = 'running'""",
                                (job["model_check_id"],))
                    return "cancelled"
                return self._close(cur, job, res, size=size, ms=ms, mb=mb)
        except pymysql.MySQLError:
            return "db_error"   # 점유가 만료되면 sweeper가 engine_down으로 닫는다(stage-job §13)

    def _close(self, cur, job, res: AdapterResult, size=None, ms=None, mb=None) -> str:
        if res.outcome == "quality_below" or (res.outcome == "ok" and output_ok(job["model_id"], res, size)):
            cur.execute("""UPDATE model_check SET status = 'passed', outcome = %s, processing_ms = %s, memory_mb = %s,
                                  finished_at = UTC_TIMESTAMP() WHERE check_id = %s""",
                        (res.outcome, ms, mb, job["model_check_id"]))
            outcome._close(cur, job["job_id"], "done")
            return "passed"
        if res.outcome == "ok":
            reason, err, oc = "bad_output", None, "ok"
        else:
            reason = err = res.outcome if res.outcome in INFRA else "engine_down"
            oc = None
        cur.execute("""UPDATE model_check SET status = 'failed', outcome = %s, fail_reason = %s, processing_ms = %s,
                              memory_mb = %s, finished_at = UTC_TIMESTAMP() WHERE check_id = %s""",
                    (oc, reason, ms, mb, job["model_check_id"]))
        outcome._close(cur, job["job_id"], "failed", error_class=err)
        return "failed"
