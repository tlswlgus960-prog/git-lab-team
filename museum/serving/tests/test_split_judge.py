"""T058 — 분리·판정 워커 시험(가짜 모델): Scenario 2, stage-job §5.1, BR-SUG-01·04, FR-20·21.

기본 흐름(분리 성공 → 판정 열림, 품질 미달 → 액자만, 소진 → 마스크 없이 판정, 판정 소진 → 직접 확정)은
test_stage_job_contract.py가 덮는다. 여기서는 제안 규칙을 워커 끝까지 확인한다:
점수는 기록만 하고(BR-PRC-04) 제안은 M2 종류 + M4 기하 규칙 + 분리 결과로만 정한다(BR-SUG-04).
"""
from __future__ import annotations

import json

import pytest

from adapters.base import AdapterResult
from adapters.fake import FAKE_JOINTS, FakeAdapter
from rules.m4_geometry import suggest
from tests.test_stage_job_contract import make_worker

# 한쪽 팔이 없는 관절 — M4 기하 규칙 불통과
BROKEN_JOINTS = {"skeleton": [j for j in FAKE_JOINTS["skeleton"] if not j["name"].startswith("left_")]}


class M2(FakeAdapter):
    """종류 후보와 점수를 정해 돌려주는 가짜 M2."""

    def __init__(self, kind, score):
        super().__init__("M2", faults={})
        self.kind, self.score = kind, score

    def run(self, job):
        return AdapterResult("ok", score=self.score, values={"kind_candidate": self.kind, "tags": ["집"]})


class M3(FakeAdapter):
    """관절 모양과 검출 점수를 정해 돌려주는 가짜 M3. joints=None이면 사람 모양을 찾지 못함."""

    def __init__(self, joints, score):
        super().__init__("M3", faults={})
        self.joints, self.score = joints, score

    def run(self, job):
        if self.joints is None:
            return AdapterResult("ok", values={}, diagnostic="no_humanoid")
        p = job.tmp_dir / "joints.json"
        p.write_text(json.dumps(self.joints))
        return AdapterResult("ok", score=self.score, outputs={"joints": str(p)})


def _judge(env, *, kind, m2_score=0.8, joints=FAKE_JOINTS, m3_score=0.9, split=None):
    """split=None 성공 / 'quality_below' 품질 미달 / 'storage' 소진."""
    a = env.artwork()
    sj = env.job(a, "split")
    jj = env.job(a, "judge", future=True)
    faults = {"split": (split, None)} if split else None
    w = make_worker(faults, extra={"M2": M2(kind, m2_score), "M3": M3(joints, m3_score)})
    if split == "storage":                                   # 인프라 3회 → 소진
        for _ in range(3):
            w.run_once(); env.make_ready(sj)
    else:
        w.run_once()
    assert w.run_once() == "done" and env.job_row(jj)["status"] == "done"
    return a, env.one("SELECT * FROM judgment WHERE artwork_id=%s", a)


# ── 집 그림 0.946 사례(Scenario 2) ──────────────────────────────────────
def test_house_with_high_engine_score_is_not_animated(env):
    """엔진이 사람 모양을 0.946으로 잡고 관절도 그럴듯해도, M2가 집이면 움직임을 제안하지 않는다."""
    a, j = _judge(env, kind="house", m2_score=0.946, m3_score=0.946)
    assert j["geometry_pass"] == 1                            # 관절 규칙은 통과했지만
    assert (j["kind_candidate"], j["suggestion"]) == ("house", "relief")
    assert float(j["person_score"]) == pytest.approx(0.946)   # 점수는 기록만(BR-PRC-04)
    assert env.one("SELECT status FROM artwork WHERE artwork_id=%s", a)["status"] == "awaiting_confirm"


def test_person_score_alone_never_animates(env):
    """사람 점수가 높아도 관절 규칙이 불통과면 움직임이 아니다(BR-SUG-04)."""
    _, j = _judge(env, kind="person", m2_score=0.997, joints=BROKEN_JOINTS, m3_score=0.997)
    assert (j["geometry_pass"], j["suggestion"]) == (0, "relief")


def test_low_score_person_with_valid_joints_is_animated(env):
    """반대로 점수가 낮아도 종류·관절 규칙이 맞으면 움직임을 제안한다 — 점수는 판단에 쓰이지 않는다."""
    _, j = _judge(env, kind="person", m2_score=0.31, m3_score=0.4)
    assert (j["geometry_pass"], j["suggestion"]) == (1, "animated")


def test_no_humanoid_found(env):
    """M3가 사람 모양을 못 찾으면 관절이 없고 geometry_pass는 비어 있다 → 분리 성공이면 2.5D."""
    _, j = _judge(env, kind="person", joints=None)
    assert (j["geometry_pass"], j["joints_object_id"], j["suggestion"]) == (None, None, "relief")


# ── 분리 결과와 제안의 조합 ─────────────────────────────────────────────
def test_split_quality_below_overrides_person(env):
    """분리 품질 미달이면 사람 그림이라도 액자(chk_jd_split_fail_frame)."""
    _, j = _judge(env, kind="person", split="quality_below")
    assert (j["split_ok"], j["geometry_pass"], j["suggestion"]) == (0, 1, "frame")


def test_split_exhausted_person_still_animated(env):
    """분리가 인프라로 소진(split_ok 없음)이어도 움직임은 원본으로 만들 수 있어 제안한다."""
    _, j = _judge(env, kind="person", split="storage")
    assert (j["split_ok"], j["suggestion"]) == (None, "animated")


def test_split_exhausted_non_person_is_frame(env):
    """분리 소진이고 사람이 아니면 마스크가 없어 2.5D도 못 한다 → 액자."""
    _, j = _judge(env, kind="object", split="storage")
    assert (j["split_ok"], j["suggestion"]) == (None, "frame")


# ── 제안 규칙 진리표(stage-job §5.1) ────────────────────────────────────
@pytest.mark.parametrize("split_ok,kind,geo,want", [
    (True, "person", True, "animated"),
    (True, "person", False, "relief"),
    (True, "person", None, "relief"),
    (True, "house", True, "relief"),
    (True, "animal", True, "relief"),
    (False, "person", True, "frame"),
    (False, "house", False, "frame"),
    (None, "person", True, "animated"),
    (None, "house", True, "frame"),
    (None, None, None, "frame"),
])
def test_suggest_truth_table(split_ok, kind, geo, want):
    assert suggest(split_ok, kind, geo) == want
