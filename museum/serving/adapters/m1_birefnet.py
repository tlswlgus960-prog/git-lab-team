"""M1 BiRefNet — 원본 → 1채널 마스크 PNG + RGBA 컷아웃 PNG(split, research R-22).

`ZhengPeng7/BiRefNet` 일반용 가중치, 입력 1024×1024로 줄였다가 마스크를 원본 크기로 되돌린다.
모델 코드는 HF 저장소의 원격 코드(trust_remote_code)다 — 매니페스트 revision(커밋)을 고정해서 그 커밋의 코드만 실행한다.
후처리(D56): 0.5 이진화 → 닫힌 구멍 채우기 → 알파 = max(원 마스크, 채움). 선 그림의 안쪽까지 작품으로 본다.
품질: 채운 마스크의 전경 비율이 thresholds.yaml split 범위 밖이면 quality_below(split_fail) — U5 전에는 "명백한 실패"만.
"""
from __future__ import annotations

import os
from pathlib import Path

from common.config import load_manifest, load_settings, load_yaml

from .base import Adapter, AdapterResult, JobInput

HF_ID = "ZhengPeng7/BiRefNet"
SIZE = 1024


def fill_holes(m, threshold: float):
    """원 마스크(0~1) → (알파 0~1, 전경 비율). 채운 안쪽은 1, 가장자리의 부드러운 값은 그대로(D56)."""
    import numpy as np
    from scipy import ndimage

    filled = ndimage.binary_fill_holes(m > threshold)
    return np.maximum(m, filled.astype(np.float32)), float(filled.mean())


class BiRefNetAdapter(Adapter):
    model_id = "M1"
    CONFIG = {"hf_id": HF_ID, "input": SIZE, "normalize": "imagenet", "threshold": 0.5, "postprocess": "fill_holes"}

    def __init__(self):
        super().__init__()
        m = (load_manifest().get("models") or {}).get("M1") or {}
        self.revision = os.environ.get("M1_REVISION") or m.get("revision")
        self.cache_dir = load_settings().model_root / "hf"
        self.device = "cpu"      # R-22: worker-cpu. MPS는 T068 자원 확인 뒤
        self.th = load_yaml("thresholds")["split"]

    def load(self) -> None:
        import torch
        from transformers import AutoModelForImageSegmentation

        if not self.revision and os.environ.get("UAM_ALLOW_UNPINNED") != "1":
            raise RuntimeError("revision_not_pinned")   # 원격 코드를 고정 없이 실행하지 않는다
        self.model = AutoModelForImageSegmentation.from_pretrained(
            HF_ID, trust_remote_code=True, revision=self.revision, cache_dir=str(self.cache_dir)).to(self.device).eval()
        torch.set_float32_matmul_precision("high")

    def run(self, job: JobInput) -> AdapterResult:
        import numpy as np
        import torch
        from PIL import Image
        from torchvision import transforms

        src = job.inputs.get("original")
        try:
            img = Image.open(src)
            img.load()
        except (OSError, TypeError):
            return AdapterResult("storage", diagnostic="input_unreadable")
        rgb = img.convert("RGB")
        tf = transforms.Compose([transforms.Resize((SIZE, SIZE)), transforms.ToTensor(),
                                 transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
        with torch.inference_mode():
            pred = self.model(tf(rgb).unsqueeze(0).to(self.device))[-1].sigmoid().cpu()[0].squeeze()
        if job.cancel.is_set():
            return AdapterResult("engine_down", diagnostic="cancelled_midway")
        mask_img = transforms.functional.to_pil_image(pred).resize(rgb.size, Image.BILINEAR)
        alpha, ratio = fill_holes(np.asarray(mask_img, dtype=np.float32) / 255.0, self.CONFIG["threshold"])
        mask_img = Image.fromarray(np.round(alpha * 255).astype(np.uint8), "L")
        if not (self.th["min_foreground_ratio"] <= ratio <= self.th["max_foreground_ratio"]):
            return AdapterResult("quality_below", downgrade_cause="split_fail", score=ratio, diagnostic="foreground_ratio")
        mask_p, cut_p = job.tmp_dir / "mask.png", job.tmp_dir / "cutout.png"
        mask_img.save(mask_p)
        cut = rgb.copy()
        cut.putalpha(mask_img)          # 원본 픽셀은 그대로, 알파만 더한다
        cut.save(cut_p)
        return AdapterResult("ok", score=ratio, outputs={"mask": str(mask_p), "cutout": str(cut_p)})
