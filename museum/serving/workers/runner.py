"""워커 실행기(stage-job §3) — 점유 → 실행(어댑터) → 분류 → 커밋 → 임시 파일 정리.

- 점유: `SELECT … FOR UPDATE SKIP LOCKED` (serving_group·status·available_at·priority), 60초 점유, 20초 heartbeat
- 활성 버전 기록. 활성 버전이 없거나 라이선스 미확인이면 어댑터를 부르지 않고 model_not_ready
  (새 작업은 app-api가 만들지 않으므로 이미 대기 중이던 작업만 해당)
- 취소 감지(heartbeat마다·결과 쓰기 직전), 결과 쓰기 직전 `deleting` 재확인(0.11)
- 모델 적재 시간: 워커는 기동 때 모델을 미리 올리고 적재 상태를 게시한다(common.model_state).
  적재 중인 모델이 필요한 단계는 점유하지 않는다 — 작업은 큐에서 기다리고, 화면은 "모델을 불러오는 중"을 보여 준다.
  적재에 실패한 모델의 단계는 점유해서 model_not_ready로 기록한다(재시도·소진 규칙을 그대로 탄다).
"""
from __future__ import annotations

import os
import socket
import threading
import time
from pathlib import Path

import pymysql

from adapters.base import AdapterResult, JobInput
from adapters.registry import PRIMARY_MODEL, STAGE_MODELS, build_adapter
from common.config import Settings, load_manifest, load_settings, load_yaml
from common.db import connect, tx
from common.logging import get_logger
from common.model_state import ModelStateBoard
from common.storage import LocalStorage, StorageError

from . import outcome
from .context import load_context
from .records import active_version

GROUP_MODELS = {"cpu_vision": ("M1", "M2", "M3"), "gpu": ("M5", "M7")}
FAILED_RELOAD_AFTER_S = 60


def group_models(group: str, gpu_enabled: bool) -> tuple[str, ...]:
    ms = GROUP_MODELS[group]
    if group == "cpu_vision" and not gpu_enabled:
        ms = ms + ("M5",)          # GPU가 없으면 depth_relief는 cpu_vision에서(BR-SRV-02)
    return ms


class Worker:
    def __init__(self, group: str, settings: Settings | None = None, worker_id: str | None = None,
                 adapters: dict | None = None, preload: bool = True):
        self.s = settings or load_settings()
        self.group = group
        self.worker_id = worker_id or f"{group}@{socket.gethostname()}:{os.getpid()}"
        self.limits = load_yaml("limits")
        self.storage = LocalStorage(self.s.storage_root)
        self.log = get_logger(worker=self.worker_id)
        self.board = ModelStateBoard(self.s.run_dir, self.worker_id.replace("/", "_").replace(":", "_"), group)
        self.models = group_models(group, self.s.gpu_enabled)
        self.adapters = adapters if adapters is not None else {}
        self.conn = connect(self.s)
        self._stop = threading.Event()
        manifest = load_manifest(self.s.manifest_path).get("models", {})
        for m in self.models:
            exp = ((manifest.get(m) or {}).get("load") or {}).get("expected_seconds")
            self.board.set(m, state="not_loaded", expected_s=exp)
        self.refresh_enabled()
        if preload:
            threading.Thread(target=self.preload_all, name="preload", daemon=True).start()

    # ── 모델 적재 ──────────────────────────────────────────────────────
    def refresh_enabled(self) -> None:
        """활성 버전·라이선스 확인(G25). 없으면 disabled — 적재하지 않는다."""
        with tx(self.conn) as cur:
            for m in self.models:
                v = active_version(cur, m)
                st = self.board.get(m).state
                if v is None or not v["license_confirmed"]:
                    if st != "disabled":
                        self.board.set(m, state="disabled", diagnostic="no_active_version" if v is None else "license_unconfirmed")
                elif st == "disabled":
                    self.board.set(m, state="not_loaded", diagnostic=None)

    def adapter(self, model_id: str):
        a = self.adapters.get(model_id)
        if a is None:
            a = self.adapters[model_id] = build_adapter(model_id, self.s.fake_models or model_id in self.s.fake_set)
        return a

    def load_model(self, model_id: str) -> bool:
        st = self.board.get(model_id)
        if st.state in ("disabled", "loading", "ready"):
            return st.state == "ready"
        self.board.set(model_id, state="loading", started_at=time.time(), finished_at=None, diagnostic=None)
        self.log.info("model_load", model_id=model_id, load_state="loading")
        t = time.monotonic()
        try:
            a = self.adapter(model_id)
            a.ensure_loaded()
        except Exception:
            self.board.set(model_id, state="failed", finished_at=time.time(), diagnostic="load_failed")
            self.log.warning("model_load", model_id=model_id, load_state="failed")
            return False
        took = time.monotonic() - t
        self.board.set(model_id, state="ready", finished_at=time.time(), last_load_s=round(took, 2),
                       device=getattr(a, "device", None))
        self.log.info("model_load", model_id=model_id, load_state="ready", load_ms=int(took * 1000))
        return True

    def preload_all(self) -> None:
        for m in self.models:
            if self._stop.is_set():
                return
            try:
                self.load_model(m)
            except Exception:
                self.board.set(m, state="failed", finished_at=time.time(), diagnostic="load_crashed")

    def check_load_timeouts(self) -> None:
        """적재가 limits.load.timeout_s를 넘으면 failed — 멈춘 적재가 작업을 영원히 붙잡지 않게."""
        limit = self.limits.get("load", {}).get("timeout_s", 300)
        now = time.time()
        for m in self.models:
            st = self.board.get(m)
            if st.state == "loading" and st.started_at and now - st.started_at > limit:
                self.board.set(m, state="failed", finished_at=now, diagnostic="load_timeout")
                self.log.warning("model_load", model_id=m, load_state="failed", diagnostic="load_timeout")

    def poll_warmup_requests(self) -> None:
        """운영 화면(S11)의 "지금 불러오기" — model-api가 `{run_dir}/warmup/{model}` 파일을 남긴다."""
        d = self.s.run_dir / "warmup"
        now = time.time()
        for m in self.models:
            st = self.board.get(m)
            flag = d / m
            wanted = flag.exists()
            retry_failed = st.state == "failed" and st.finished_at and now - st.finished_at > FAILED_RELOAD_AFTER_S
            if (wanted or retry_failed) and st.state in ("not_loaded", "failed"):
                threading.Thread(target=self.load_model, args=(m,), daemon=True).start()
            if wanted and st.state in ("ready", "disabled"):
                flag.unlink(missing_ok=True)

    def claimable_stages(self) -> list[str]:
        out = []
        for stage, models in STAGE_MODELS.items():
            states = [self.board.get(m).state for m in models if m in self.models]
            if len(states) != len(models):
                continue                     # 이 서빙군에 없는 모델
            if all(s in ("ready", "failed", "disabled") for s in states):
                out.append(stage)            # loading·not_loaded면 기다린다
        return out

    # ── 점유 ──────────────────────────────────────────────────────────
    def claim(self):
        stages = self.claimable_stages()
        if not stages:
            return None
        ph = ",".join(["%s"] * len(stages))
        claim_s = self.limits["claim"]["seconds"]
        with tx(self.conn) as cur:
            cur.execute(f"""SELECT * FROM stage_job
                             WHERE serving_group = %s AND status IN ('queued','retry_wait')
                               AND available_at <= UTC_TIMESTAMP() AND stage_kind IN ({ph})
                               AND origin NOT IN ('eval','check')   -- 평가·점검 작업은 각 실행기(stages/eval.py §12·check.py §13)가 맡는다
                             ORDER BY priority, queued_at LIMIT 1 FOR UPDATE SKIP LOCKED""",
                        (self.group, *stages))
            job = cur.fetchone()
            if not job:
                return None
            ctx = load_context(cur, job, self.worker_id)
            if ctx.artwork_status == "deleting" or job["cancel_requested_at"] is not None:
                outcome.mark_cancelled(cur, job["job_id"])
                self.log.info("job_end", job_id=job["job_id"], stage_kind=job["stage_kind"], status="cancelled")
                return "cancelled"
            version = None
            model_id = PRIMARY_MODEL.get(job["stage_kind"])
            if model_id:
                v = active_version(cur, model_id)
                if v is not None and v["license_confirmed"]:
                    version = v
            cur.execute("""UPDATE stage_job SET status = 'running', attempt_count = attempt_count + 1,
                                  claimed_by = %s, claim_expires_at = UTC_TIMESTAMP() + INTERVAL %s SECOND,
                                  started_at = COALESCE(started_at, UTC_TIMESTAMP()),
                                  model_version_id = COALESCE(%s, model_version_id), error_class = NULL
                            WHERE job_id = %s""",
                        (self.worker_id, claim_s, version["version_id"] if version else None, job["job_id"]))
            job["attempt_count"] += 1
            if model_id and version is None:
                # 준비 확인(stage-job §3.2): 어댑터를 부르지 않는다
                st = outcome.record_infra(cur, self.storage, ctx, "model_not_ready")
                self._log_end(ctx, st, "model_not_ready", None, 0, model_id)
                return "model_not_ready"
            if job["stage_kind"] == "judge" and "M3" in STAGE_MODELS["judge"]:
                m3 = active_version(cur, "M3")
                if m3 is None or not m3["license_confirmed"]:
                    st = outcome.record_infra(cur, self.storage, ctx, "model_not_ready")
                    self._log_end(ctx, st, "model_not_ready", None, 0, "M3")
                    return "model_not_ready"
            ctx.version_label = version["version_label"] if version else None
        return ctx

    # ── 실행 ──────────────────────────────────────────────────────────
    def _inputs(self, ctx) -> dict[str, Path]:
        d = {}
        if ctx.original_key:
            d["original"] = self.storage.path(ctx.original_key)
        for k, key in ctx.object_keys.items():
            d[k] = self.storage.path(key)
        return d

    def _timeout(self, stage: str) -> float:
        st = self.limits["stages"][stage]
        if stage == "depth_relief" and self.group == "cpu_vision":
            return st.get("timeout_s_cpu", st["timeout_s"])
        return st["timeout_s"]

    def _execute(self, ctx, jin: JobInput) -> AdapterResult:
        if ctx.stage == "frame_compose":
            return AdapterResult("ok")
        values, outputs, score = {}, {}, None
        for m in STAGE_MODELS[ctx.stage]:
            if self.board.get(m).state != "ready":
                return AdapterResult("model_not_ready", diagnostic="model_" + self.board.get(m).state)
            r = self.adapter(m).run(jin)
            if r.outcome != "ok":
                return r
            values.update(r.values); outputs.update(r.outputs)
            score = r.score if score is None else score
        return AdapterResult("ok", score=score, outputs=outputs, values=values)

    def _heartbeat(self, ctx, cancel: threading.Event, user_cancel: threading.Event, done: threading.Event) -> None:
        hb = self.limits["claim"]["heartbeat_s"]
        claim_s = self.limits["claim"]["seconds"]
        conn = connect(self.s)
        try:
            while not done.wait(hb):
                with tx(conn) as cur:
                    cur.execute("""UPDATE stage_job SET claim_expires_at = UTC_TIMESTAMP() + INTERVAL %s SECOND
                                    WHERE job_id = %s AND status = 'running' AND claimed_by = %s""",
                                (claim_s, ctx.job_id, self.worker_id))
                    if self._cancel_requested(cur, ctx):
                        user_cancel.set()
                        cancel.set()
                        return
        except pymysql.MySQLError:
            pass   # heartbeat 실패는 점유 만료로 이어지고 sweeper가 이어받는다
        finally:
            conn.close()

    @staticmethod
    def _cancel_requested(cur, ctx) -> bool:
        cur.execute("SELECT cancel_requested_at FROM stage_job WHERE job_id = %s", (ctx.job_id,))
        r = cur.fetchone()
        if r and r["cancel_requested_at"] is not None:
            return True
        if ctx.artwork_id is None:
            return False
        cur.execute("SELECT status FROM artwork WHERE artwork_id = %s", (ctx.artwork_id,))
        a = cur.fetchone()
        return bool(a and a["status"] == "deleting")

    def process(self, ctx) -> str:
        t0 = time.monotonic()
        # cancel: 어댑터에 멈추라는 신호(취소·시간 초과 공통) / user_cancel: 취소 요청·삭제 중 감지
        cancel, user_cancel, done = threading.Event(), threading.Event(), threading.Event()
        jin = JobInput(job_id=ctx.job_id, stage_kind=ctx.stage, tmp_dir=self.storage.tmp_dir(ctx.job_id),
                       inputs=self._inputs(ctx), cancel=cancel)
        box: dict = {}

        def target():
            try:
                box["r"] = self._execute(ctx, jin)
            except StorageError:
                box["r"] = AdapterResult("storage", diagnostic="storage_error")
            except Exception:
                box["r"] = AdapterResult("engine_down", diagnostic="adapter_exception")  # 예외 원문은 남기지 않는다

        hb = threading.Thread(target=self._heartbeat, args=(ctx, cancel, user_cancel, done), daemon=True)
        hb.start()
        th = threading.Thread(target=target, daemon=True)
        th.start()
        th.join(self._timeout(ctx.stage))
        if th.is_alive():
            cancel.set()   # 어댑터에 중단 요청(하위 프로세스 SIGTERM → 5초 뒤 SIGKILL은 어댑터 몫)
            res = AdapterResult("timeout", diagnostic="stage_timeout")
        else:
            res = box["r"]
        done.set()
        try:
            status = self.commit(ctx, res, user_cancel)
        finally:
            self.storage.clear_tmp(ctx.job_id)   # 0.12 임시 파일 정리
        self._log_end(ctx, status, res.outcome if res.outcome not in ("ok",) else None,
                      None, int((time.monotonic() - t0) * 1000), PRIMARY_MODEL.get(ctx.stage))
        return status

    def commit(self, ctx, res: AdapterResult, user_cancel: threading.Event) -> str:
        try:
            with tx(self.conn) as cur:
                # 0.11 결과 쓰기 직전 재확인
                if ctx.artwork_id is not None:
                    cur.execute("SELECT status FROM artwork WHERE artwork_id = %s FOR UPDATE", (ctx.artwork_id,))
                    a = cur.fetchone()
                    if a is None or a["status"] == "deleting":
                        outcome.mark_cancelled(cur, ctx.job_id)
                        return "cancelled"
                cur.execute("SELECT cancel_requested_at FROM stage_job WHERE job_id = %s FOR UPDATE", (ctx.job_id,))
                if user_cancel.is_set() or cur.fetchone()["cancel_requested_at"] is not None:
                    outcome.mark_cancelled(cur, ctx.job_id)
                    return "cancelled"
                return outcome.apply(cur, self.storage, ctx, res)
        except StorageError:
            return self._record_infra_fresh(ctx, "storage")
        except pymysql.MySQLError:
            return self._record_infra_fresh(ctx, "db")

    def _record_infra_fresh(self, ctx, error_class: str) -> str:
        """결과 쓰기 트랜잭션이 실패하면 새 연결에서 인프라 오류로 기록한다(§4.2 db)."""
        try:
            self.conn.close()
        except Exception:
            pass
        self.conn = connect(self.s)
        with tx(self.conn) as cur:
            cur.execute("SELECT * FROM stage_job WHERE job_id = %s FOR UPDATE", (ctx.job_id,))
            ctx.job = cur.fetchone()
            return outcome.record_infra(cur, self.storage, ctx, error_class)

    def _log_end(self, ctx, status, error_class, cause, ms, model_id) -> None:
        self.log.info("job_end", job_id=ctx.job_id, stage_kind=ctx.stage, model_id=model_id,
                      version_label=getattr(ctx, "version_label", None), attempt_count=ctx.job["attempt_count"],
                      status=status, error_class=error_class if error_class != "quality_below" else None,
                      downgrade_cause=cause, duration_ms=ms)

    # ── 루프 ──────────────────────────────────────────────────────────
    def run_once(self):
        got = self.claim()
        if got is None:
            # 보호자 작업이 없을 때만 점검 작업(stage-job §13, D20) → 평가 작업(§12) → 외부 작업(§9, D17 낮은 우선순위)
            from .stages.check import CheckRunner
            got = CheckRunner(self).run_once()
            if got is not None:
                return got
            from .stages.eval import EvalRunner
            got = EvalRunner(self).run_once()
            if got is not None:
                return got
            from .external import ExternalRunner
            return ExternalRunner(self).run_once()
        if isinstance(got, str):
            return got
        return self.process(got)

    def run_forever(self) -> None:
        idle = self.limits["poll"]["idle_s"]
        last_refresh = 0.0
        while not self._stop.is_set():
            if time.time() - last_refresh > 20:
                self.refresh_enabled()
                last_refresh = time.time()
            self.poll_warmup_requests()
            self.check_load_timeouts()
            self.board.flush()           # 생존 신호(updated_at)
            try:
                got = self.run_once()
            except pymysql.MySQLError:
                self.log.warning("db_unavailable", serving_group=self.group)
                time.sleep(idle)
                self.conn = connect(self.s)
                continue
            if got is None:
                self._stop.wait(idle)

    def stop(self) -> None:
        self._stop.set()
        self.board.remove()
