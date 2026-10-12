"""M2 실제 어댑터 — UAM_REAL_MODELS=1일 때만(가중치 605MB)."""
import os
import threading

import pytest

from adapters.base import JobInput

pytestmark = pytest.mark.skipif(os.environ.get("UAM_REAL_MODELS") != "1", reason="실제 모델은 UAM_REAL_MODELS=1")


def test_kind_and_tags(tmp_path):
    from adapters.m2_openclip import OpenClipAdapter
    from tests.test_real_m1 import drawing
    src = tmp_path / "o.png"; drawing(src)
    a = OpenClipAdapter()
    took = a.ensure_loaded()
    r = a.run(JobInput(1, "judge", tmp_path, {"original": src}, threading.Event()))
    print(f"\nM2 device={a.device} load={took:.1f}s {r.values}")
    assert r.outcome == "ok" and r.values["kind_candidate"] in ("person", "animal", "house", "object")
    assert 0 <= r.values["person_score"] <= 1 and len(r.values["tags"]) <= 5
