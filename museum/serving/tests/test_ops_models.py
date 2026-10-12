"""ops.models digest·register(SD_04 §9-2, R-03) — 후보 등록은 app-api 하나, CLI는 요청 본문만."""
from __future__ import annotations

import hashlib

import pytest
import yaml

from common.config import REPO_ROOT
from ops import models as om


def test_image_digest_definition():
    """재료마다 `경로\\tSHA-256\\n` + `runtime\\t문자열\\n`을 이어 붙인 글의 SHA-256."""
    rt = "torch-2.4.1-mps"
    text = "".join(f"{rel}\t{hashlib.sha256((REPO_ROOT / rel).read_bytes()).hexdigest()}\n" for rel in om.DIGEST_FILES["M5"])
    text += f"runtime\t{rt}\n"
    assert om.image_digest("M5", rt) == hashlib.sha256(text.encode()).hexdigest()
    assert om.image_digest("M5", rt) != om.image_digest("M5", "torch-2.4.1-cpu")      # 런타임이 바뀌면 달라진다
    assert om.image_digest("M6", "ollama-0.34.0-metal") != om.image_digest("M1", "ollama-0.34.0-metal")  # 재료가 다르다
    with pytest.raises(KeyError):
        om.image_digest("M4", "x")                                                     # 규칙 파일은 등록하지 않는다


def test_register_prints_api_body_only(tmp_path, monkeypatch, capsys):
    man = tmp_path / "manifest.yaml"
    h = "a" * 64
    man.write_text(yaml.safe_dump({"models": {
        "M5": {"weights_sha256": h, "config_hash": "b" * 64, "runtime": "torch-2.4.1-mps", "exec_device": "gpu",
               "image_digest": "sha256:" + "c" * 64},
        "M1": {"weights_sha256": h, "config_hash": "b" * 64, "runtime": "torch-2.4.1-cpu", "exec_device": "cpu"}}}))
    monkeypatch.setenv("MODEL_MANIFEST", str(man))
    assert om.main(["register", "M5", "--label", "M5-v1"]) == 0
    out = capsys.readouterr().out
    assert '"imageDigest": "' + "c" * 64 + '"' in out and "sha256:" not in out      # API엔 16진수 64자만
    assert om.register_body("M5", "M5-v1") == {"version": "M5-v1", "weightsSha256": h, "runtime": "torch-2.4.1-mps",
                                               "imageDigest": "c" * 64, "configHash": "b" * 64, "device": "gpu"}
    assert om.main(["register", "M1", "--label", "M1-v1"]) == 2                        # image_digest 없으면 거절
    with pytest.raises(SystemExit):
        om.main(["register", "M5", "--label", "x", "--apply"])                         # --apply는 없어졌다


def test_digest_write_sets_prefixed_value(tmp_path, monkeypatch):
    man = tmp_path / "manifest.yaml"
    man.write_text(yaml.safe_dump({"models": {"M2": {"runtime": "open_clip-2.26.1-mps"}}}))
    monkeypatch.setenv("MODEL_MANIFEST", str(man))
    assert om.main(["digest", "M2", "--write"]) == 0
    got = yaml.safe_load(man.read_text())["models"]["M2"]["image_digest"]
    assert got == "sha256:" + om.image_digest("M2", "open_clip-2.26.1-mps")
