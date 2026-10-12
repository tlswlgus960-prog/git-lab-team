"""M3 관절 추출(렌더 없이, 판정용) — TorchServe(네이티브, 127.0.0.1:9561) 두 모델(T072, FR-21, research R-03).

drawn_humanoid_detector → 가장 높은 점수 상자로 자르기 → drawn_humanoid_pose_estimator(COCO 17점)
→ Animated Drawings char_cfg와 같은 skeleton(root·hip·torso·neck·어깨·팔꿈치·손·엉덩이·무릎·발) JSON.
AD examples/image_to_annotations.py와 같게 긴 변을 1000px로 줄여 보낸다 — TorchServe 기본 요청 상한(6.5MB)을
넘지 않고, 관절 좌표가 AD 렌더(char_cfg)와 같은 좌표계가 된다(A_모델재현기록 M3).
"""
from __future__ import annotations

import io
import json
import urllib.request
import uuid
from pathlib import Path

DETECTOR, POSE = "drawn_humanoid_detector", "drawn_humanoid_pose_estimator"
MAX_SIDE = 1000
# COCO 17점 → AD skeleton (image_to_annotations.py와 같은 대응)
_PAIRS = [("neck", 0), ("right_shoulder", 6), ("right_elbow", 8), ("right_hand", 10), ("left_shoulder", 5),
          ("left_elbow", 7), ("left_hand", 9), ("right_hip", 12), ("right_knee", 14), ("right_foot", 16),
          ("left_hip", 11), ("left_knee", 13), ("left_foot", 15)]


class NoHumanoid(Exception):
    """검출 결과가 없다 — 인프라 오류가 아니다."""


def _multipart(field: str, data: bytes) -> tuple[bytes, str]:
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"x.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
    return body, f"multipart/form-data; boundary={b}"


def _png(img) -> bytes:
    buf = io.BytesIO(); img.save(buf, "PNG")
    return buf.getvalue()


def predict(ts_url: str, model: str, png: bytes, timeout: float = 60):
    body, ctype = _multipart("data", png)
    req = urllib.request.Request(f"{ts_url.rstrip('/')}/predictions/{model}", data=body, headers={"Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def fit(img):
    """긴 변 MAX_SIDE 이하로(AD와 같은 배율 반올림). 원본은 바꾸지 않는다(BR-INT-04)."""
    w, h = img.size
    if max(w, h) <= MAX_SIDE:
        return img
    s = MAX_SIDE / max(w, h)
    return img.resize((round(s * w), round(s * h)))


def extract(ts_url: str, img) -> dict:
    """RGB PIL 이미지 → {"skeleton": [...], "bbox": [...], "score": float, "size": [w, h]}.
    TorchServe 연결 실패는 OSError 그대로 올린다(호출자가 engine_down으로 분류)."""
    img = fit(img)
    det = sorted(predict(ts_url, DETECTOR, _png(img)), key=lambda d: d["score"], reverse=True)
    if not det:
        raise NoHumanoid()
    x1, y1, x2, y2 = [int(v) for v in det[0]["bbox"]]
    kp = predict(ts_url, POSE, _png(img.crop((x1, y1, x2, y2))))[0]["keypoints"]
    mid = lambda a, b: [round((kp[a][0] + kp[b][0]) / 2), round((kp[a][1] + kp[b][1]) / 2)]
    skel = [{"name": "root", "loc": mid(11, 12)}, {"name": "hip", "loc": mid(11, 12)}, {"name": "torso", "loc": mid(5, 6)}]
    skel += [{"name": n, "loc": [round(kp[i][0]), round(kp[i][1])]} for n, i in _PAIRS]
    return {"skeleton": skel, "bbox": [x1, y1, x2, y2], "score": float(det[0]["score"]), "size": list(img.size)}


def write(result: dict, out: Path) -> Path:
    out.write_text(json.dumps({k: result[k] for k in ("skeleton", "bbox", "size")}))
    return out
