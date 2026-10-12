from adapters.fake import FAKE_JOINTS
from rules.m4_geometry import evaluate, suggest


def test_symmetric_person_passes():
    assert evaluate(FAKE_JOINTS)


def test_missing_joint_or_asymmetry_fails():
    j = {"skeleton": [x for x in FAKE_JOINTS["skeleton"] if x["name"] != "left_hand"]}
    assert not evaluate(j)
    j = {"skeleton": [dict(x, loc=[5, 90]) if x["name"] == "left_hand" else x for x in FAKE_JOINTS["skeleton"]]}
    assert not evaluate(j)


def test_suggest_rule():
    assert suggest(False, "person", True) == "frame"
    assert suggest(True, "person", True) == "animated"
    assert suggest(True, "person", False) == "relief"      # 점수 단독으로 animated 안 냄
    assert suggest(None, "animal", None) == "frame"
