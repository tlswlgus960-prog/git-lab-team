"""M3 어댑터 연결부 — 가짜 TorchServe와 가짜 렌더 실행기로(T072·T083). 실제 환경 시험은 test_real_m3.py."""
from __future__ import annotations

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PIL import Image, ImageDraw

from adapters.base import JobInput
from rules.m4_geometry import evaluate_file

# COCO 17점: 좌우 대칭 사람
KP = [[50, 10, 1], [47, 8, 1], [53, 8, 1], [45, 10, 1], [55, 10, 1], [40, 25, 1], [60, 25, 1], [32, 37, 1], [68, 37, 1],
      [26, 47, 1], [74, 47, 1], [44, 60, 1], [56, 60, 1], [42, 78, 1], [58, 78, 1], [40, 94, 1], [60, 94, 1]]


@pytest.fixture()
def torchserve(monkeypatch):
    calls = []

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, body):
            data = json.dumps(body).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

        def do_GET(self):
            self._send({"status": "Healthy"})

        def do_POST(self):
            n = int(self.headers["Content-Length"]); body = self.rfile.read(n)
            calls.append((self.path, b"image/png" in body and b"\x89PNG" in body, n))
            if self.path.endswith("drawn_humanoid_detector"):
                return self._send([{"bbox": [10, 10, 110, 110], "score": 0.9}, {"bbox": [0, 0, 5, 5], "score": 0.1}])
            self._send([{"keypoints": KP}])

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("TORCHSERVE_URL", f"http://127.0.0.1:{srv.server_port}")
    yield calls
    srv.shutdown()


def test_joints_mapping_passes_m4(tmp_path, torchserve):
    from adapters.m3_render import AnimatedDrawingsAdapter
    src = tmp_path / "o.png"; Image.new("RGB", (200, 200), "white").save(src)
    a = AnimatedDrawingsAdapter(); a.ensure_loaded()
    r = a.run(JobInput(1, "judge", tmp_path, {"original": src}, threading.Event()))
    assert r.outcome == "ok" and r.score == 0.9
    skel = {j["name"]: j["loc"] for j in json.loads(open(r.outputs["joints"]).read())["skeleton"]}
    assert skel["root"] == [50, 60] and skel["torso"] == [50, 25] and skel["neck"] == [50, 10]
    assert evaluate_file(r.outputs["joints"]) is True
    assert [p for p, _, _ in torchserve] == ["/predictions/drawn_humanoid_detector", "/predictions/drawn_humanoid_pose_estimator"]
    assert all(ok for _, ok, _ in torchserve)


def test_joints_large_photo_resized_like_ad(tmp_path, torchserve):
    """12MP 사진도 TorchServe 기본 요청 상한(6.5MB) 안으로, 긴 변 1000px(AD image_to_annotations와 같은 좌표계)."""
    import os
    from adapters.m3_render import AnimatedDrawingsAdapter
    src = tmp_path / "big.png"
    Image.frombytes("RGB", (4032, 3024), os.urandom(4032 * 3024 * 3)).save(src)     # 압축 안 되는 12MP(numpy 없이)
    a = AnimatedDrawingsAdapter(); a.ensure_loaded()
    r = a.run(JobInput(1, "judge", tmp_path, {"original": src}, threading.Event()))
    assert r.outcome == "ok"
    assert json.loads(open(r.outputs["joints"]).read())["size"] == [1000, 750]
    assert max(n for _, _, n in torchserve) < 6_500_000
    assert Image.open(src).size == (4032, 3024)      # 원본은 그대로(BR-INT-04)


def test_joints_torchserve_down_is_engine_down(tmp_path, monkeypatch):
    monkeypatch.setenv("TORCHSERVE_URL", "http://127.0.0.1:9")
    from adapters.m3_render import AnimatedDrawingsAdapter
    src = tmp_path / "o.png"; Image.new("RGB", (64, 64), "white").save(src)
    r = AnimatedDrawingsAdapter().run(JobInput(1, "judge", tmp_path, {"original": src}, threading.Event()))
    assert r.outcome == "engine_down" and r.diagnostic == "torchserve_joints"


def test_render_gif_to_mp4_and_cancel(tmp_path, torchserve, monkeypatch):
    pytest.importorskip("imageio_ffmpeg")
    ad = tmp_path / "ad"; (ad / "examples").mkdir(parents=True)
    runner = tmp_path / "fake_runner.py"
    runner.write_text(
        "import sys,os,time\nfrom PIL import Image\nout=sys.argv[2]; os.makedirs(out, exist_ok=True)\n"
        "if os.environ.get('SLOW'): time.sleep(30)\n"
        "fr=[Image.new('RGB',(64,64),(i*20,0,0)) for i in range(12)]\n"
        "fr[0].save(os.path.join(out,'video.gif'),save_all=True,append_images=fr[1:],duration=40)\n")
    monkeypatch.setenv("M3_AD_PYTHON", sys.executable); monkeypatch.setenv("M3_AD_ROOT", str(ad))
    monkeypatch.setenv("M3_AD_RUNNER", str(runner))
    from adapters.m3_render import AnimatedDrawingsAdapter
    src = tmp_path / "o.png"; Image.new("RGB", (64, 64), "white").save(src)
    a = AnimatedDrawingsAdapter()
    a.min_bytes = 100
    r = a.run(JobInput(1, "animate_render", tmp_path, {"original": src}, threading.Event()))
    assert r.outcome == "ok", r.diagnostic
    assert open(r.outputs["result_animated"], "rb").read(12)[4:8] == b"ftyp"
    monkeypatch.setenv("SLOW", "1")
    ev = threading.Event(); threading.Timer(0.5, ev.set).start()
    t = time.monotonic()
    r = a.run(JobInput(2, "animate_render", tmp_path / "x", {"original": src}, ev))
    assert r.diagnostic == "cancelled_midway" and time.monotonic() - t < 7     # SIGTERM → 5초 뒤 SIGKILL 안에 끝남


def _gif(path, frames):
    fr = []
    for boxes in frames:                                     # 흰 바탕 위 검은 사각형들
        im = Image.new("RGB", (100, 100), "white"); d = ImageDraw.Draw(im)
        for b in boxes:
            d.rectangle(b, fill="black")
        fr.append(im)
    fr[0].save(path, save_all=True, append_images=fr[1:], duration=40)
    return path


def test_shape_check_torn_and_distorted(tmp_path):
    """렌더 뒤 모양 검사(D55): 그대로면 통과, 조각이 갈라지면 render_torn, 면적이 크게 흔들리면 render_distorted."""
    from adapters.m3_render import shape_check
    from common.config import load_yaml
    t = load_yaml("thresholds")["animate_render"]
    body = (40, 20, 60, 80)
    ok = [[body], [(38, 20, 62, 80)], [body]]                                 # 약간 흔들림(1.2배 안)
    assert shape_check(_gif(tmp_path / "ok.gif", ok), t) is None
    torn = [[(40, 20, 60, 45), (40, 55, 60, 80)]] * 3                          # 몸통이 끊겨 두 조각
    assert shape_check(_gif(tmp_path / "torn.gif", torn), t) == "render_torn"
    grow = [[body], [(20, 20, 80, 80)], [body]]                               # 면적 3배
    assert shape_check(_gif(tmp_path / "grow.gif", grow), t) == "render_distorted"
    blank = [[body], [], [body]]                                              # 그림이 사라진 프레임
    assert shape_check(_gif(tmp_path / "blank.gif", blank), t) == "render_torn"


def test_render_distorted_downgrades(tmp_path, torchserve, monkeypatch):
    """모양 검사에 걸리면 MP4를 만들지 않고 quality_below — 낮춤 체인(animated_to_relief)으로 간다."""
    ad = tmp_path / "ad"; (ad / "examples").mkdir(parents=True)
    runner = tmp_path / "fake_runner.py"
    runner.write_text(
        "import sys,os\nfrom PIL import Image, ImageDraw\nout=sys.argv[2]; os.makedirs(out, exist_ok=True)\nfr=[]\n"
        "for w in (10,40,10):\n im=Image.new('RGB',(100,100),'white'); ImageDraw.Draw(im).rectangle((50-w,20,50+w,80),fill='black'); fr.append(im)\n"
        "fr[0].save(os.path.join(out,'video.gif'),save_all=True,append_images=fr[1:],duration=40)\n")
    monkeypatch.setenv("M3_AD_PYTHON", sys.executable); monkeypatch.setenv("M3_AD_ROOT", str(ad))
    monkeypatch.setenv("M3_AD_RUNNER", str(runner))
    from adapters.m3_render import AnimatedDrawingsAdapter
    src = tmp_path / "o.png"; Image.new("RGB", (64, 64), "white").save(src)
    r = AnimatedDrawingsAdapter().run(JobInput(1, "animate_render", tmp_path, {"original": src}, threading.Event()))
    assert (r.outcome, r.diagnostic) == ("quality_below", "render_distorted")
    assert not (tmp_path / "animated.mp4").exists()
