"""가짜 어댑터(R-19) — `UAM_FAKE_MODELS=1`. 모델 없이 전체 흐름과 장애 주입 시험을 돌린다.

장애 주입: 환경 변수 `UAM_FAKE_FAULTS="stage=outcome[*n],…"`
  예) `judge=engine_down*2`  → judge의 처음 2회 시도만 engine_down, 3회째 ok
      `animate_render=quality_below` → 매번 quality_below
적재 지연: `UAM_FAKE_LOAD_S=3` (적재 중 화면 확인용)
"""
from __future__ import annotations

import json
import os
import struct
import time
import zlib
from pathlib import Path

from .base import OUTCOMES, Adapter, AdapterResult, JobInput


def parse_faults(spec: str | None) -> dict[str, tuple[str, int | None]]:
    out: dict[str, tuple[str, int | None]] = {}
    for part in (spec or "").split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        stage, rhs = part.split("=", 1)
        n = None
        if "*" in rhs:
            rhs, cnt = rhs.split("*", 1)
            n = int(cnt)
        if rhs not in OUTCOMES:
            raise ValueError(f"unknown outcome {rhs}")
        out[stage.strip()] = (rhs.strip(), n)
    return out


def _png(path: Path, w: int = 8, h: int = 8, channels: int = 1, bit16: bool = False) -> None:
    """의존성 없는 아주 작은 PNG(가짜 결과물)."""
    color = {1: 0, 4: 6}[channels]
    depth = 16 if bit16 else 8
    bpp = channels * (2 if bit16 else 1)
    raw = b"".join(b"\x00" + bytes([0x40 + y * 8]) * (w * bpp) for y in range(h))   # 줄마다 값이 달라 깊이 맵이 평평하지 않다(점검 형식 확인)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, depth, color, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


_PRIMARY = {"split": "M1", "judge": "M2", "animate_render": "M3", "depth_relief": "M5", "sculpture": "M7"}


class FakeAdapter(Adapter):
    def __init__(self, model_id: str, faults: dict | None = None, load_s: float | None = None):
        super().__init__()
        self.model_id = model_id
        self.faults = faults if faults is not None else parse_faults(os.environ.get("UAM_FAKE_FAULTS"))
        self.load_s = float(os.environ.get("UAM_FAKE_LOAD_S", "0")) if load_s is None else load_s
        self.calls: dict[str, int] = {}

    def load(self) -> None:
        if self.load_s:
            time.sleep(self.load_s)

    def _fault(self, stage: str) -> str | None:
        if _PRIMARY.get(stage, self.model_id) != self.model_id:
            return None   # 여러 모델을 부르는 단계(judge)는 대표 모델에만 주입한다
        n = self.calls[stage] = self.calls.get(stage, 0) + 1
        f = self.faults.get(stage)
        if not f:
            return None
        outcome, limit = f
        return outcome if (limit is None or n <= limit) else None

    def run(self, job: JobInput) -> AdapterResult:
        injected = self._fault(job.stage_kind)
        if injected and injected != "ok":
            return AdapterResult(outcome=injected, diagnostic="fake_injected")
        t = job.tmp_dir
        if job.stage_kind == "split":
            _png(t / "mask.png"); _png(t / "cutout.png", channels=4)
            return AdapterResult("ok", score=0.9, outputs={"mask": str(t / "mask.png"), "cutout": str(t / "cutout.png")})
        if job.stage_kind == "judge":
            if self.model_id == "M3":  # 관절만
                (t / "joints.json").write_text(json.dumps(FAKE_JOINTS))
                return AdapterResult("ok", outputs={"joints": str(t / "joints.json")})
            kind = job.params.get("fake_kind", "person")
            return AdapterResult("ok", score=0.81, values={"kind_candidate": kind, "tags": ["바다", "사람"]})
        if job.stage_kind == "animate_render":
            (t / "animated.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42fake")
            return AdapterResult("ok", outputs={"result_animated": str(t / "animated.mp4")})
        if job.stage_kind == "depth_relief":
            _png(t / "depth.png", bit16=True)
            return AdapterResult("ok", outputs={"result_relief": str(t / "depth.png")})
        if job.stage_kind == "sculpture":
            (t / "s.glb").write_bytes(b"glTF")
            return AdapterResult("ok", outputs={"result_glb": str(t / "s.glb")})
        return AdapterResult("engine_down", diagnostic="fake_unknown_stage")


# M4 규칙을 통과하는 사람 모양 관절(좌우 대칭)
FAKE_JOINTS = {"skeleton": [
    {"name": "root", "loc": [50, 60]}, {"name": "hip", "loc": [50, 60]}, {"name": "torso", "loc": [50, 40]},
    {"name": "neck", "loc": [50, 25]}, {"name": "head", "loc": [50, 15]},
    {"name": "left_shoulder", "loc": [40, 27]}, {"name": "left_elbow", "loc": [32, 37]}, {"name": "left_hand", "loc": [26, 47]},
    {"name": "right_shoulder", "loc": [60, 27]}, {"name": "right_elbow", "loc": [68, 37]}, {"name": "right_hand", "loc": [74, 47]},
    {"name": "left_hip", "loc": [44, 62]}, {"name": "left_knee", "loc": [42, 78]}, {"name": "left_foot", "loc": [40, 94]},
    {"name": "right_hip", "loc": [56, 62]}, {"name": "right_knee", "loc": [58, 78]}, {"name": "right_foot", "loc": [60, 94]},
]}
