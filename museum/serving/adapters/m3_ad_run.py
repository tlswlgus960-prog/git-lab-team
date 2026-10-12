"""M3 렌더 실행기 — M3 전용 환경(serving/.venv-m3, Python 3.8)에서 하위 프로세스로 실행한다(research R-03).

사용: <M3_AD_PYTHON> m3_ad_run.py <원본 이미지> <출력 폴더>   (cwd = $M3_AD_ROOT/examples)
- AD examples의 image_to_annotations로 주석(char_cfg.yaml 등)을 만든다. AD 스크립트가 코드에 박아 둔
  http://localhost:8080 을 TORCHSERVE_URL로 바꿔 보낸다(Studio-B 8080은 다른 사용자 서비스).
- 창 모드 대신 OSMesa 헤드리스 렌더(view.USE_MESA: True)로 <출력 폴더>/video.gif 를 만든다.
  서비스 계정은 SSH 세션만 있어 GLFW 창을 만들 수 없다.
- 로그에 이미지·경로를 남기지 않는다(BR-PRV-01). 종료 코드: 0 성공, 그 밖은 실패.
"""
import os
import sys

os.environ.setdefault("PYOPENGL_PLATFORM", "osmesa")

AD_DEFAULT = "http://localhost:8080"


def _patch_torchserve_url() -> None:
    import requests

    target = os.environ.get("TORCHSERVE_URL", "http://127.0.0.1:9561").rstrip("/")
    original = requests.post

    def post(url, *args, **kwargs):
        if isinstance(url, str) and url.startswith(AD_DEFAULT):
            url = target + url[len(AD_DEFAULT):]
        return original(url, *args, **kwargs)

    requests.post = post


def main(argv) -> int:
    if len(argv) != 3:
        return 2
    img_fn, out_dir = argv[1], argv[2]
    ad_root = os.environ.get("M3_AD_ROOT") or os.path.dirname(os.getcwd())
    sys.path.insert(0, os.path.join(ad_root, "examples"))
    _patch_torchserve_url()

    from pathlib import Path

    import yaml
    from image_to_annotations import image_to_annotations
    import animated_drawings.render

    image_to_annotations(img_fn, out_dir)

    cfg_dir = Path(ad_root, "examples", "config")
    mvc = {
        "scene": {"ANIMATED_CHARACTERS": [{
            "character_cfg": str(Path(out_dir, "char_cfg.yaml").resolve()),
            "motion_cfg": str((cfg_dir / "motion" / "dab.yaml").resolve()),
            "retarget_cfg": str((cfg_dir / "retarget" / "fair1_ppf.yaml").resolve()),
        }]},
        "view": {"USE_MESA": True},
        "controller": {"MODE": "video_render", "OUTPUT_VIDEO_PATH": str(Path(out_dir, "video.gif").resolve())},
    }
    mvc_fn = Path(out_dir, "mvc_cfg.yaml")
    mvc_fn.write_text(yaml.dump(mvc))
    animated_drawings.render.start(str(mvc_fn))
    return 0 if Path(out_dir, "video.gif").exists() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
