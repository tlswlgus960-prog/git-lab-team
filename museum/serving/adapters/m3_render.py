"""M3 Meta Animated Drawings — 관절(judge)과 헤드리스 렌더(animate_render)를 한 모델 어댑터로 묶는다(T072·T083, R-03).

- 관절: `adapters.m3_joints` — TorchServe(네이티브, 127.0.0.1:9561) 검출 → 자세 → AD skeleton JSON
- 렌더: M3 전용 환경(serving/.venv-m3)에서 `adapters/m3_ad_run.py` 하위 프로세스 → OSMesa 헤드리스 GIF → ffmpeg MP4(H.264, 무음)
  취소·시간 초과: SIGTERM → 5초 뒤 SIGKILL(stage-job §7)
환경: TORCHSERVE_URL, M3_AD_PYTHON(.venv-m3 파이썬), M3_AD_ROOT(AD 저장소), M3_AD_RUNNER(실행기, 기본 m3_ad_run.py),
      FFMPEG(없으면 imageio-ffmpeg 고정 바이너리). 렌더 하위 프로세스에 DYLD_FALLBACK_LIBRARY_PATH=<.venv-m3>/lib(OSMesa)를 넘긴다.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import urllib.request
from pathlib import Path

from common.config import load_settings, load_yaml

from . import m3_joints
from .base import Adapter, AdapterResult, JobInput

RUNNER = Path(__file__).with_name("m3_ad_run.py")


def shape_check(gif: Path, t: dict) -> str | None:
    """렌더 뒤 모양 검사(D55). 문제 없으면 None, 있으면 진단 코드(render_torn · render_distorted)."""
    import numpy as np
    from PIL import Image, ImageSequence
    from scipy import ndimage

    areas, torn = [], 0
    with Image.open(gif) as g:
        for f in ImageSequence.Iterator(g):
            fg = (np.asarray(f.convert("RGB")) < t["background_level"]).any(axis=2)
            fg = ndimage.binary_closing(fg, np.ones((3, 3), bool))
            lab, n = ndimage.label(fg, np.ones((3, 3), bool))
            sizes = np.bincount(lab.ravel())[1:] if n else np.zeros(0, int)
            total = int(sizes.sum())
            areas.append(total)
            torn += int((sizes >= t["piece_min_share"] * total).sum() > 1) if total else 0
    if not areas or min(areas) == 0:
        return "render_torn"
    if torn / len(areas) >= t["max_torn_frame_ratio"]:
        return "render_torn"
    if max(areas) / min(areas) > t["max_area_ratio"]:
        return "render_distorted"
    return None


def _bundled_ffmpeg() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


class AnimatedDrawingsAdapter(Adapter):
    model_id = "M3"
    CONFIG = {"detector": m3_joints.DETECTOR, "pose": m3_joints.POSE, "max_side": m3_joints.MAX_SIDE,
              "motion": "dab", "retarget": "fair1_ppf", "render": "osmesa", "video": "mp4-h264-24fps",
              "shape_check": "d53-torn-area"}   # 렌더 뒤 모양 검사(D55) — 기준값은 thresholds.yaml

    def __init__(self):
        super().__init__()
        s = load_settings()
        self.ts = s.torchserve_url.rstrip("/")
        self.ad_python = os.environ.get("M3_AD_PYTHON")
        self.ad_root = os.environ.get("M3_AD_ROOT")
        self.runner = os.environ.get("M3_AD_RUNNER") or str(RUNNER)
        self.ffmpeg = os.environ.get("FFMPEG") or _bundled_ffmpeg()
        self.limits = load_yaml("thresholds")["animate_render"]
        self.min_bytes = self.limits["min_output_bytes"]

    # 적재 = TorchServe에 두 모델이 올라가 있는지 확인(가중치는 TorchServe가 들고 있다)
    def load(self) -> None:
        with urllib.request.urlopen(self.ts + "/ping", timeout=5) as r:
            if json.load(r).get("status") != "Healthy":
                raise RuntimeError("torchserve_unhealthy")

    def joints(self, job: JobInput) -> AdapterResult:
        from PIL import Image

        try:
            img = Image.open(job.inputs["original"]).convert("RGB")
        except (OSError, KeyError):
            return AdapterResult("storage", diagnostic="input_unreadable")
        try:
            res = m3_joints.extract(self.ts, img)
        except m3_joints.NoHumanoid:
            return AdapterResult("ok", values={}, diagnostic="no_humanoid")   # 관절 없음 → geometry_pass 없음 → animated 제안 안 함
        except (OSError, IndexError, KeyError, ValueError):
            return AdapterResult("engine_down", diagnostic="torchserve_joints")
        out = m3_joints.write(res, job.tmp_dir / "joints.json")
        return AdapterResult("ok", score=res["score"], outputs={"joints": str(out)})

    def _render_env(self) -> dict:
        env = dict(os.environ, TORCHSERVE_URL=self.ts, M3_AD_ROOT=str(self.ad_root), PYOPENGL_PLATFORM="osmesa")
        env["DYLD_FALLBACK_LIBRARY_PATH"] = str(Path(self.ad_python).parent.parent / "lib")   # .venv-m3/lib의 libOSMesa
        return env

    def _run_proc(self, args: list[str], job: JobInput, cwd: str | None, env: dict | None = None) -> int | None:
        p = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
        while p.poll() is None:
            if job.cancel.wait(0.5):
                os.killpg(p.pid, signal.SIGTERM)
                try:
                    p.wait(5)
                except subprocess.TimeoutExpired:
                    os.killpg(p.pid, signal.SIGKILL)
                return None
        return p.returncode

    def render(self, job: JobInput) -> AdapterResult:
        if not (self.ad_python and self.ad_root):
            return AdapterResult("model_not_ready", diagnostic="ad_env_missing")
        out_dir = job.tmp_dir / "ad"
        rc = self._run_proc([self.ad_python, self.runner, str(job.inputs["original"]), str(out_dir)],
                            job, cwd=str(Path(self.ad_root) / "examples"), env=self._render_env())
        if rc is None:
            return AdapterResult("engine_down", diagnostic="cancelled_midway")
        gif = out_dir / "video.gif"
        if rc != 0 or not gif.exists():
            # 사람 모양을 못 찾으면 AD가 실패한다 — 품질 미달로 낮춘다(인프라 오류와 구분: TorchServe가 살아 있을 때만)
            try:
                self.load()
            except Exception:
                return AdapterResult("engine_down", diagnostic="torchserve_down")
            return AdapterResult("quality_below", diagnostic="ad_failed")
        try:
            bad = shape_check(gif, self.limits)
        except OSError:
            return AdapterResult("engine_down", diagnostic="render_unreadable")
        if bad:
            return AdapterResult("quality_below", diagnostic=bad)   # 일그러진 영상은 주지 않고 낮춘다(D55)
        mp4 = job.tmp_dir / "animated.mp4"
        rc = self._run_proc([self.ffmpeg, "-y", "-loglevel", "error", "-i", str(gif), "-an", "-c:v", "libx264",
                             "-pix_fmt", "yuv420p", "-r", "24", "-movflags", "+faststart",
                             "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", str(mp4)], job, cwd=None)
        if rc is None:
            return AdapterResult("engine_down", diagnostic="cancelled_midway")
        if rc != 0 or not mp4.exists():
            return AdapterResult("engine_down", diagnostic="ffmpeg_failed")
        if mp4.stat().st_size < self.min_bytes:
            return AdapterResult("quality_below", diagnostic="empty_render")
        return AdapterResult("ok", outputs={"result_animated": str(mp4)})

    def run(self, job: JobInput) -> AdapterResult:
        if job.stage_kind == "judge":
            return self.joints(job)
        if job.stage_kind == "animate_render":
            return self.render(job)
        return AdapterResult("engine_down", diagnostic="unsupported_stage")
