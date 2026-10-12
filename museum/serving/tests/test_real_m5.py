"""M5 실제 어댑터 — UAM_REAL_MODELS=1일 때만(가중치 99MB를 받는다)."""
import os
import threading

import numpy as np
import pytest
from PIL import Image, ImageDraw

from adapters.base import JobInput

pytestmark = pytest.mark.skipif(os.environ.get("UAM_REAL_MODELS") != "1", reason="실제 모델은 UAM_REAL_MODELS=1")


def test_depth_png16_from_cutout(tmp_path):
    from adapters.m5_depth import DepthAnythingAdapter
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((60, 30, 196, 150), fill=(250, 200, 60, 255), outline=(0, 0, 0, 255), width=4)   # 얼굴
    d.rectangle((100, 150, 156, 240), fill=(60, 120, 220, 255), outline=(0, 0, 0, 255), width=4)  # 몸
    src = tmp_path / "cutout.png"; img.save(src)
    a = DepthAnythingAdapter()
    took = a.ensure_loaded()
    r = a.run(JobInput(job_id=1, stage_kind="depth_relief", tmp_dir=tmp_path, inputs={"cutout": src},
                       cancel=threading.Event()))
    assert r.outcome == "ok", r.diagnostic
    out = Image.open(r.outputs["result_relief"])
    arr = np.asarray(out)
    assert out.size == (256, 256) and arr.dtype in (np.uint16, np.int32) and arr.max() > 1000
    assert arr[0, 0] == 0                                   # 마스크 밖은 0
    assert 0 < r.score <= 1                                 # 점수는 0~1(D50) — eval_item_result.score DECIMAL(5,4)
    print(f"\nM5 device={a.device} load={took:.1f}s")
    wide = Image.new("RGBA", (800, 600), (0, 0, 0, 0))            # 정사각형이 아닌 입력(DINOv2 위치 임베딩 보간)
    ImageDraw.Draw(wide).ellipse((200, 100, 600, 500), fill=(250, 200, 60, 255))
    wide.save(tmp_path / "wide.png")
    r = a.run(JobInput(job_id=2, stage_kind="depth_relief", tmp_dir=tmp_path, inputs={"cutout": tmp_path / "wide.png"},
                       cancel=threading.Event()))
    assert r.outcome == "ok" and Image.open(r.outputs["result_relief"]).size == (800, 600)
