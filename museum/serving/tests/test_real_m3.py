"""M3 실제 어댑터 — UAM_REAL_MODELS=1이고 TorchServe(127.0.0.1:9561)가 떠 있을 때만(T072·T083, R-03).

필요 환경: M3_AD_PYTHON=serving/.venv-m3/bin/python, M3_AD_ROOT=<MODEL_ROOT>/m3/AnimatedDrawings.
입력은 AD 저장소 예제 그림(팀원 그림이 아니므로 평가 묶음 측정이 아니다 — BR-MDL-04).
"""
import json
import os
import threading
import time
import urllib.request
from pathlib import Path

import pytest

from adapters.base import JobInput

pytestmark = pytest.mark.skipif(os.environ.get("UAM_REAL_MODELS") != "1", reason="실제 모델은 UAM_REAL_MODELS=1")


@pytest.fixture(scope="module")
def adapter():
    from adapters.m3_render import AnimatedDrawingsAdapter
    a = AnimatedDrawingsAdapter()
    try:
        a.ensure_loaded()
    except Exception:
        pytest.skip("TorchServe가 떠 있지 않다(ops/torchserve/config.properties로 기동)")
    return a


@pytest.fixture(scope="module")
def example():
    root = os.environ.get("M3_AD_ROOT")
    p = Path(root or "", "examples", "drawings", "garlic.png")
    if not root or not p.exists():
        pytest.skip("M3_AD_ROOT 없음")
    return p


def test_joints_real(tmp_path, adapter, example):
    from rules.m4_geometry import evaluate_file
    t = time.monotonic()
    r = adapter.run(JobInput(1, "judge", tmp_path, {"original": example}, threading.Event()))
    print(f"\nM3 joints {time.monotonic() - t:.1f}s outcome={r.outcome} score={r.score}")
    assert r.outcome == "ok" and r.score > 0.9
    j = json.loads(Path(r.outputs["joints"]).read_text())
    assert len(j["skeleton"]) == 16 and max(j["size"]) == 1000
    print("M4 geometry_pass =", evaluate_file(r.outputs["joints"]))


def test_render_real(tmp_path, adapter, example):
    if not (os.environ.get("M3_AD_PYTHON") and Path(os.environ["M3_AD_PYTHON"]).exists()):
        pytest.skip("M3_AD_PYTHON 없음")
    t = time.monotonic()
    r = adapter.run(JobInput(2, "animate_render", tmp_path, {"original": example}, threading.Event()))
    print(f"\nM3 render {time.monotonic() - t:.1f}s outcome={r.outcome} diag={r.diagnostic}")
    assert r.outcome == "ok", r.diagnostic
    mp4 = Path(r.outputs["result_animated"])
    assert mp4.read_bytes()[4:8] == b"ftyp" and mp4.stat().st_size > adapter.min_bytes


def test_torchserve_loopback_only():
    """관리 포트가 루프백에만 열려 있다(BR-SRV-04) — 설정 파일 기준."""
    cfg = (Path(__file__).resolve().parents[2] / "ops" / "torchserve" / "config.properties").read_text()
    addrs = [l.split("=", 1)[1] for l in cfg.splitlines() if l.endswith(("9561", "9562", "9563")) and "=" in l]
    assert len(addrs) == 3 and all(a.startswith("http://127.0.0.1:") for a in addrs)
    with urllib.request.urlopen("http://127.0.0.1:9561/ping", timeout=5) as r:
        assert json.load(r)["status"] == "Healthy"
