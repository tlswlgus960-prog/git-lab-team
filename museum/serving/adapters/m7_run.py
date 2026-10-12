"""M7 TripoSR 한 건 실행 — 전용 환경 `serving/.venv-m7`에서 하위 프로세스로 돈다(research R-22 M7 실행 환경, T131).

    .venv-m7/bin/python adapters/m7_run.py <입력 PNG> <출력 GLB> [--res 256]

- 입력은 M1 컷아웃(RGBA). 알파가 없으면(점검 그림 원본) 그림 전체를 전경으로 본다.
- 전처리: 전경을 85%로 맞추고 회색(0.5) 배경에 합성(공식 run.py와 같다). rembg는 쓰지 않는다.
- MPS 보완 2건(docs/D/D_M7_TripoSR_보완사항.md): ① PYTORCH_ENABLE_MPS_FALLBACK=1 ② 메시 추출 입력을 CPU로.
- 결과: GLB(정점 색) + 다시 읽기. 표준 출력 한 줄 JSON {"vertices", "faces", "reload_faces", "device"}.
- 종료 코드: 0 성공 · 2 입력을 읽지 못함 · 3 면이 없음(품질 미달) · 1 그 밖의 실패. 오류 원문은 내보내지 않는다(BR-PRV-01).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import types
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")        # ① torch import 전에
ROOT = Path(os.environ.get("MODEL_ROOT", Path(__file__).resolve().parents[2] / "models")) / "m7"
os.environ.setdefault("HF_HOME", str(ROOT / "hf"))                  # dino-vitb16 설정(12KB)을 오프라인으로
os.environ.setdefault("HF_HUB_OFFLINE", "1")
sys.modules.setdefault("rembg", types.ModuleType("rembg"))          # tsr.utils가 부르지만 쓰지 않는다(M1 컷아웃 입력)
sys.path.insert(0, str(ROOT / "TripoSR-src"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("out"); ap.add_argument("--res", type=int, default=256)
    a = ap.parse_args()
    import numpy as np
    from PIL import Image
    try:
        img = Image.open(a.src)
        img.load()
    except OSError:
        return 2
    import torch
    import trimesh
    import tsr.models.isosurface as iso
    mc = iso.marching_cubes
    iso.marching_cubes = lambda vol, th: mc(vol.detach().cpu(), th)   # ② torchmcubes는 CPU 빌드(모듈 전역을 감싼다)
    from tsr.system import TSR
    from tsr.utils import resize_foreground

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = TSR.from_pretrained(str(ROOT / "TripoSR"), config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to(device)
    rgba = img.convert("RGBA")
    if rgba.getchannel("A").getbbox() is None:
        return 3
    arr = np.asarray(resize_foreground(rgba, 0.85)).astype(np.float32) / 255.0
    arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
    x = Image.fromarray((arr * 255.0).astype(np.uint8))
    with torch.no_grad():
        codes = model([x], device=device)
    mesh = model.extract_mesh(codes, True, resolution=a.res)[0]
    if len(mesh.faces) == 0:
        return 3
    out = Path(a.out)
    mesh.export(out)
    back = trimesh.load(out, force="mesh")
    if out.read_bytes()[:4] != b"glTF" or len(back.faces) == 0:
        return 1
    print(json.dumps({"vertices": len(mesh.vertices), "faces": len(mesh.faces), "reload_faces": len(back.faces),
                      "device": device}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:          # 원문은 내보내지 않는다
        sys.exit(1)
