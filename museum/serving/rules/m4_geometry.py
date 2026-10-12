"""M4 판정 보조 규칙 — 관절 기하(팔다리 길이·좌우 대칭·몸통 비율). 모델이 아니다(R-22).

입력: M3 관절 JSON(Animated Drawings char_cfg의 skeleton 형식: [{name, loc:[x,y]}]).
출력: geometry_pass(bool). 점수 단독으로 animated를 내지 않도록(BR-SUG-04) 제안 규칙은 이 값과 종류를 함께 본다.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from common.config import SERVING_ROOT, load_yaml

RULES_FILE = SERVING_ROOT / "config" / "m4_rules.yaml"


def rules_hash() -> str:
    return hashlib.sha256(RULES_FILE.read_bytes()).hexdigest()


def _pts(joints: dict) -> dict[str, tuple[float, float]]:
    return {j["name"]: (float(j["loc"][0]), float(j["loc"][1])) for j in joints.get("skeleton", [])}


def _d(a, b) -> float:
    return math.dist(a, b)


def evaluate(joints: dict, rules: dict | None = None) -> bool:
    r = rules or load_yaml("m4_rules")
    p = _pts(joints)
    if any(n not in p for n in r["required_joints"]):
        return False
    ys = [xy[1] for xy in p.values()]
    height = max(ys) - min(ys)
    if height < r["min_height_px"]:
        return False
    torso = _d(p["neck"], p.get("hip", p.get("root", p["torso"])))
    if not (r["torso_min_ratio"] <= torso / height <= r["torso_max_ratio"]):
        return False
    lim = r["limb_symmetry_max_ratio"]
    arms = (_d(p["left_shoulder"], p["left_hand"]), _d(p["right_shoulder"], p["right_hand"]))
    legs = (_d(p["left_hip"], p["left_foot"]), _d(p["right_hip"], p["right_foot"]))
    for a, b in (arms, legs):
        if min(a, b) <= 0 or max(a, b) / min(a, b) > lim:
            return False
    return True


def evaluate_file(path: Path) -> bool:
    try:
        return evaluate(json.loads(Path(path).read_text(encoding="utf-8")))
    except (OSError, ValueError, KeyError, TypeError):
        return False


def suggest(split_ok: bool | None, kind_candidate: str | None, geometry_pass: bool | None) -> str:
    """제안 규칙(stage-job §5.1, BR-SUG-01·04). person_score는 보지 않는다."""
    if split_ok is False:
        return "frame"
    if kind_candidate == "person" and geometry_pass:
        return "animated"
    if split_ok:
        return "relief"
    return "frame"
