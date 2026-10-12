"""T131 — M7 TripoSR 어댑터: 전용 환경 하위 프로세스의 종료 코드 → 결과 분류(가짜 하위 프로세스로)."""
from __future__ import annotations

import os
import stat
import threading

import pytest

from adapters.base import JobInput
from adapters.m7_triposr import TripoSRAdapter
from workers.stages.check import output_ok

# 가짜 전용 환경 python: argv = [runner, src, out, --res, 256]. MODE로 동작을 고른다
FAKE = """#!/bin/sh
case "$M7_FAKE_MODE" in
  ok) printf 'glTFfake' > "$3"; echo '{"vertices": 3, "faces": 1, "reload_faces": 1, "device": "mps"}'; exit 0;;
  empty) exit 3;;
  unreadable) exit 2;;
  hang) sleep 30;;
  *) exit 1;;
esac
"""


@pytest.fixture()
def m7(tmp_path, monkeypatch):
    py = tmp_path / "python"
    py.write_text(FAKE)
    py.chmod(py.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("M7_PYTHON", str(py))
    src = tmp_path / "cut.png"
    src.write_bytes(b"png")

    def run(mode, cancel=None):
        monkeypatch.setenv("M7_FAKE_MODE", mode)
        out = tmp_path / f"out_{mode}"
        out.mkdir()
        return TripoSRAdapter().run(JobInput(job_id=1, stage_kind="sculpture", tmp_dir=out, inputs={"cutout": src},
                                             cancel=cancel or threading.Event()))
    return run


def test_ok_gives_glb_and_passes_check_format(m7):
    r = m7("ok")
    assert r.outcome == "ok" and r.values["reload_faces"] == 1 and os.path.exists(r.outputs["result_glb"])
    assert output_ok("M7", r, None)


@pytest.mark.parametrize("mode,outcome,diag", [("empty", "quality_below", "empty_mesh"),
                                                ("unreadable", "storage", "input_unreadable"),
                                                ("crash", "engine_down", "m7_failed")])
def test_exit_codes(m7, mode, outcome, diag):
    r = m7(mode)
    assert (r.outcome, r.diagnostic) == (outcome, diag)
    if outcome == "quality_below":
        assert r.downgrade_cause == "sculpture_to_relief"


def test_cancel_kills_subprocess(m7):
    ev = threading.Event()
    threading.Timer(0.3, ev.set).start()
    r = m7("hang", cancel=ev)
    assert (r.outcome, r.diagnostic) == ("engine_down", "cancelled_midway")


def test_missing_env_is_model_not_ready(monkeypatch, tmp_path):
    monkeypatch.delenv("M7_PYTHON", raising=False)
    r = TripoSRAdapter().run(JobInput(job_id=1, stage_kind="sculpture", tmp_dir=tmp_path, inputs={}))
    assert r.outcome == "model_not_ready"
    with pytest.raises(RuntimeError):
        TripoSRAdapter().load()
