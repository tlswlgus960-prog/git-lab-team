"""단계 → 모델, 모델 → 어댑터. 실제 어댑터는 무거운 의존성(torch 등)을 쓰므로 필요할 때만 import한다."""
from __future__ import annotations

import importlib

from .base import Adapter
from .fake import FakeAdapter

# 단계가 부르는 모델(순서대로). frame_compose는 모델 없음(BR-PRC-01)
STAGE_MODELS: dict[str, tuple[str, ...]] = {
    "split": ("M1",),
    "judge": ("M2", "M3"),          # M2 종류·태그 → M3 관절 → M4 규칙(코드)
    "animate_render": ("M3",),
    "depth_relief": ("M5",),
    "frame_compose": (),
    "sculpture": ("M7",),
}
# stage_job.model_version_id가 가리키는 모델
PRIMARY_MODEL = {"split": "M1", "judge": "M2", "animate_render": "M3",
                 "depth_relief": "M5", "sculpture": "M7", "caption": "M6"}

_REAL = {
    "M1": "adapters.m1_birefnet:BiRefNetAdapter",
    "M2": "adapters.m2_openclip:OpenClipAdapter",
    "M3": "adapters.m3_render:AnimatedDrawingsAdapter",
    "M5": "adapters.m5_depth:DepthAnythingAdapter",
    "M7": "adapters.m7_triposr:TripoSRAdapter",   # P1 — 전용 환경 하위 프로세스(research R-22)
}


def build_adapter(model_id: str, fake: bool) -> Adapter:
    if fake:
        return FakeAdapter(model_id)
    target = _REAL.get(model_id)
    if not target:
        raise KeyError(model_id)
    mod, cls = target.split(":")
    return getattr(importlib.import_module(mod), cls)()
