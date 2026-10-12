"""M7 TripoSR 어댑터(T131, FR-29, P1) — 컷아웃 → GLB(정점 색).

numpy 1.x·transformers 4.35·torchmcubes가 필요해 `serving/.venv`와 같이 쓸 수 없으므로(research R-22 M7 실행 환경)
전용 환경 `M7_PYTHON`(serving/.venv-m7)에서 `m7_run.py`를 작업마다 하위 프로세스로 돌린다 — M3 AD 렌더와 같은 격리.
적재(load)는 환경·가중치가 있는지만 확인한다. 가중치 적재(약 3초)는 작업마다 한다.
라이선스 팀 확정 전이라 활성화하지 않는다(매니페스트 license_confirmed false).
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
from pathlib import Path

from common.config import load_settings

from .base import Adapter, AdapterResult, JobInput

RUNNER = Path(__file__).with_name("m7_run.py")


class TripoSRAdapter(Adapter):
    model_id = "M7"
    CONFIG = {"mc_resolution": 256, "foreground_ratio": 0.85, "bg": 0.5, "output": "glb-vertex-color"}

    def __init__(self):
        super().__init__()
        self.python = os.environ.get("M7_PYTHON")
        self.model_root = Path(load_settings().model_root) / "m7"

    def load(self) -> None:
        if not (self.python and Path(self.python).exists()):
            raise RuntimeError("m7_env_missing")
        for p in ("TripoSR/model.ckpt", "TripoSR/config.yaml", "TripoSR-src/tsr/system.py"):
            if not (self.model_root / p).exists():
                raise RuntimeError("m7_files_missing")
        self.device = "mps"   # 하위 프로세스가 MPS가 없으면 CPU로 돈다

    def run(self, job: JobInput) -> AdapterResult:
        if not (self.python and Path(self.python).exists()):
            return AdapterResult("model_not_ready", diagnostic="m7_env_missing")
        src = job.inputs.get("cutout") or job.inputs.get("original")
        if src is None or not Path(src).exists():
            return AdapterResult("storage", diagnostic="input_missing")
        out = job.tmp_dir / "sculpture.glb"
        env = dict(os.environ, MODEL_ROOT=str(self.model_root.parent), PYTORCH_ENABLE_MPS_FALLBACK="1")
        p = subprocess.Popen([self.python, str(RUNNER), str(src), str(out), "--res", str(self.CONFIG["mc_resolution"])],
                             env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        while p.poll() is None:
            if job.cancel.wait(0.5):
                os.killpg(p.pid, signal.SIGTERM)
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    os.killpg(p.pid, signal.SIGKILL)
                return AdapterResult("engine_down", diagnostic="cancelled_midway")
        stdout = p.stdout.read().decode("utf-8", "replace") if p.stdout else ""
        if p.returncode == 2:
            return AdapterResult("storage", diagnostic="input_unreadable")
        if p.returncode == 3:
            return AdapterResult("quality_below", downgrade_cause="sculpture_to_relief", diagnostic="empty_mesh")
        if p.returncode != 0 or not out.exists():
            return AdapterResult("engine_down", diagnostic="m7_failed")
        try:
            info = json.loads(stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return AdapterResult("engine_down", diagnostic="m7_bad_report")
        return AdapterResult("ok", outputs={"result_glb": str(out)},
                             values={"faces": info.get("faces"), "reload_faces": info.get("reload_faces")})
