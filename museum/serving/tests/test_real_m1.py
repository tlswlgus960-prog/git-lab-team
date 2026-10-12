"""M1 실제 어댑터 — UAM_REAL_MODELS=1일 때만(가중치 444MB)."""
import os
import threading

import numpy as np
import pytest
from PIL import Image, ImageDraw

from adapters.base import JobInput

pytestmark = pytest.mark.skipif(os.environ.get("UAM_REAL_MODELS") != "1", reason="실제 모델은 UAM_REAL_MODELS=1")


def drawing(path, blank=False):
    img = Image.new("RGB", (800, 600), (245, 243, 236))       # 종이
    if not blank:
        d = ImageDraw.Draw(img)
        d.ellipse((320, 80, 480, 240), outline=(20, 20, 20), width=8, fill=(250, 210, 90))
        d.line((400, 240, 400, 440), fill=(20, 20, 20), width=10)
        d.line((400, 300, 300, 360), fill=(20, 20, 20), width=10); d.line((400, 300, 500, 360), fill=(20, 20, 20), width=10)
        d.line((400, 440, 330, 560), fill=(20, 20, 20), width=10); d.line((400, 440, 470, 560), fill=(20, 20, 20), width=10)
    img.save(path)


def test_split_drawing(tmp_path):
    from adapters.m1_birefnet import BiRefNetAdapter
    src = tmp_path / "o.png"; drawing(src)
    a = BiRefNetAdapter()
    took = a.ensure_loaded()
    r = a.run(JobInput(1, "split", tmp_path, {"original": src}, threading.Event()))
    print(f"\nM1 load={took:.1f}s outcome={r.outcome} fg={r.score:.3f}")
    assert r.outcome in ("ok", "quality_below")
    if r.outcome == "ok":
        cut = Image.open(r.outputs["cutout"])
        assert cut.mode == "RGBA" and cut.size == (800, 600)
        assert np.array_equal(np.asarray(cut)[..., :3], np.asarray(Image.open(src)))   # 원본 픽셀 불변(FR-22)
    blank = tmp_path / "b.png"; drawing(blank, blank=True)
    r2 = a.run(JobInput(2, "split", tmp_path, {"original": blank}, threading.Event()))
    print(f"blank outcome={r2.outcome} fg={r2.score}")
