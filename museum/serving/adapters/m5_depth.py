"""M5 Depth Anything V2 Small — 컷아웃 → 상대 깊이맵 16bit PNG(result_relief, research R-07).

`depth-anything/Depth-Anything-V2-Small-hf`(Apache-2.0, 약 24.8M). Base·Large는 비상업이라 쓰지 않는다(R-22).
장치: MPS(Apple Silicon) → exec_device='gpu', runtime에 mps 표기 / 없으면 CPU. 원본 픽셀은 바꾸지 않는다(FR-22).
"""
from __future__ import annotations

import os
from pathlib import Path

from common.config import load_manifest, load_settings, load_yaml

from .base import Adapter, AdapterResult, JobInput

HF_ID = "depth-anything/Depth-Anything-V2-Small-hf"


class DepthAnythingAdapter(Adapter):
    model_id = "M5"
    CONFIG = {"hf_id": HF_ID, "output": "png16", "normalize": "minmax_in_mask", "background": "white"}

    def __init__(self):
        super().__init__()
        m = (load_manifest().get("models") or {}).get("M5") or {}
        self.revision = os.environ.get("M5_REVISION") or m.get("revision")
        self.cache_dir = load_settings().model_root / "hf"
        self.device = "cpu"
        self.min_std = load_yaml("thresholds")["depth_relief"]["min_depth_std"]

    def load(self) -> None:
        import torch
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation

        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        kw = dict(revision=self.revision, cache_dir=str(self.cache_dir))
        self.processor = AutoImageProcessor.from_pretrained(HF_ID, **kw)
        self.model = AutoModelForDepthEstimation.from_pretrained(HF_ID, **kw).to(self.device).eval()

    def run(self, job: JobInput) -> AdapterResult:
        import numpy as np
        import torch
        from PIL import Image

        src = job.inputs.get("cutout")
        if src is None or not Path(src).exists():
            return AdapterResult("quality_below", diagnostic="no_cutout")   # 체인이 액자로 낮춘다
        try:
            rgba = Image.open(src).convert("RGBA")
        except OSError:
            return AdapterResult("storage", diagnostic="input_unreadable")
        alpha = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255.0
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        rgb = Image.alpha_composite(bg, rgba).convert("RGB")
        with torch.inference_mode():
            inputs = self.processor(images=rgb, return_tensors="pt").to(self.device)
            pred = self.model(**inputs).predicted_depth.float().cpu()   # MPS에는 bicubic 업샘플이 없다(torch 2.4)
            pred = torch.nn.functional.interpolate(pred.unsqueeze(1), size=rgb.size[::-1], mode="bicubic",
                                                   align_corners=False).squeeze().numpy()
        if job.cancel.is_set():
            return AdapterResult("engine_down", diagnostic="cancelled_midway")   # 워커가 cancelled로 바꾼다
        mask = alpha > 0.5
        if mask.sum() < 16:
            return AdapterResult("quality_below", diagnostic="empty_mask")
        vals = pred[mask]
        lo, hi = float(vals.min()), float(vals.max())
        norm = np.zeros_like(pred)
        if hi > lo:
            norm = (pred - lo) / (hi - lo)
        norm[~mask] = 0.0
        std255 = float((norm[mask] * 255).std())
        score = round(std255 / 255, 4)                          # 점수는 0~1(D50). 평면 기준은 0~255 척도 그대로
        if std255 < self.min_std:
            return AdapterResult("quality_below", score=score, diagnostic="flat_depth")
        out = job.tmp_dir / "depth.png"
        Image.fromarray((norm * 65535).astype(np.uint16), mode="I;16").save(out)
        return AdapterResult("ok", score=score, outputs={"result_relief": str(out)})
