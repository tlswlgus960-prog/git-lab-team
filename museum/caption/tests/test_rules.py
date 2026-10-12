"""T127 — caption 패키지(llm-contract §3, research R-26). 실행: 저장소 루트에서 `serving/.venv/bin/python -m pytest -q caption/tests`"""
from __future__ import annotations

import json

import pytest
import yaml

import caption
from caption import rules as R

RULES = R.load_rules()
KW = {"keywords": ["집", "빨간색"], "ageAtMaking": 5}


def check(text, inp=KW):
    return R.rule_check(text, inp, RULES)


def test_rules_file_is_provisional_and_loaded_once():
    assert caption.RULES_VERSION == "tmp-2026-09-30" and caption.PROVISIONAL is True
    assert caption.MAX_REGEN == 2
    assert [c for c, _ in RULES.checks] == ["fail_development", "fail_emotion", "fail_event"]


@pytest.mark.parametrize("text", ["빨간색으로 집을 그렸어요.", "5살 때 그린 작품이에요. 빨간색으로 집을 칠했어요."])
def test_pass(text):
    assert check(text) is None


@pytest.mark.parametrize("text,cls", [
    ("", "fail_event"),
    ("   ", "fail_event"),
    ("가" * 301, "fail_event"),
    ("<think>음</think>집을 그렸어요.", "fail_event"),
    ("집을 그렸어요. 아이는 우리 집이라고 말했어요.", "fail_event"),       # words 없이 아이 말을 지어냄
    ("집을 그렸어요. 색 감각이 천재적이에요.", "fail_development"),
    ("집을 그렸어요. 또래보다 섬세해요.", "fail_development"),
    ("집을 그렸어요. 아이가 행복해 보여요.", "fail_emotion"),
    ("집을 그리며 신났어요.", "fail_emotion"),
    ("주말에 본 집을 그렸어요.", "fail_event"),
    ("생일에 받은 집 모양 선물을 그렸어요.", "fail_event"),
])
def test_fail_classes(text, cls):
    assert check(text) == cls


def test_order_development_before_emotion_before_event():
    assert check("주말에 행복하게 그린 천재적인 그림이에요.") == "fail_development"
    assert check("주말에 행복하게 그렸어요.") == "fail_emotion"


def test_input_contrast_allows_words_the_family_gave():
    inp = {"keywords": ["바다"], "words": "엄마랑 바다 가서 행복했어", "ageAtMaking": 5}
    assert check("5살 때 바다를 그렸어요. 아이는 바다에서 행복했다고 말했어요.", inp) is None
    assert check("생일에 바다를 그렸어요.", {"keywords": ["바다"], "tags": ["생일"]}) is None   # 고른 태그도 입력


def test_known_limits_are_recorded_not_hidden():
    """R-26 '임시 기준표가 못 잡거나 잘못 잡는 것' — U11 측정에서 확인할 항목. 바뀌면 R-26도 고친다."""
    assert check("집과 고양이를 그렸어요.") is None                         # ① 입력에 없는 물건은 못 잡음
    inp = {"keywords": ["바다"], "words": "엄마랑 바다 갔어"}
    assert check("엄마와 바다에 다녀온 날을 그렸어요.", inp) == "fail_event"   # ② 같은 뜻 다른 말도 걸림
    assert check("집을 그렸어요. 슬프지 않아요.") == "fail_emotion"          # ③ 부정문도 걸림


@pytest.mark.parametrize("inp,out", [
    ({"keywords": ["바다"], "tags": ["사람"], "ageAtMaking": 5}, "5살 때 그린 작품이에요. 바다·사람을 그렸어요."),
    ({"keywords": ["집"], "ageAtMaking": 4}, "4살 때 그린 작품이에요. 집을 그렸어요."),
    ({"keywords": ["고양이", "바다"]}, "고양이·바다를 그렸어요."),
    ({"tags": ["사과"], "keywords": ["사과"]}, "사과를 그렸어요."),                 # 중복 제거
    ({"keywords": ["UFO"], "ageAtMaking": 7}, "7살 때 그린 작품이에요. UFO을(를) 그렸어요."),
    ({}, "아이가 그린 작품이에요."),
])
def test_template(inp, out):
    assert R.template(inp, RULES) == out


def test_messages_only_allowed_input_and_shots():
    inp = {"keywords": ["바다"], "ageAtMaking": 5}
    msgs = R.build_messages(inp, RULES)
    assert msgs[0]["role"] == "system" and "입력에 없는 물건" in msgs[0]["content"]
    assert [m["role"] for m in msgs[1:]] == ["user", "assistant", "user", "assistant", "user"]
    assert msgs[-1]["content"] == "입력: " + json.dumps(inp, ensure_ascii=False)


def test_swap_rules_file(tmp_path, monkeypatch):
    """확정 값 교체(R-26 교체 절차): 같은 문장이 파일만 바꾸면 판정이 바뀐다."""
    data = yaml.safe_load(open(R.DEFAULT_PATH, encoding="utf-8"))
    text = "집을 그렸어요. 색이 예뻐요."
    assert check(text) is None
    data.update(version="final-test", provisional=False, max_regen=1)
    data["checks"][0]["stems"].append("예뻐")
    p = tmp_path / "rules.yaml"
    p.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    monkeypatch.setenv("CAPTION_RULES", str(p))
    new = R.load_rules()
    assert (new.version, new.provisional, new.max_regen) == ("final-test", False, 1)
    assert R.rule_check(text, KW, new) == "fail_development"


def test_bad_rules_file_rejected(tmp_path):
    data = yaml.safe_load(open(R.DEFAULT_PATH, encoding="utf-8"))
    data["checks"][0]["class"] = "fail_other"
    p = tmp_path / "bad.yaml"
    p.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    with pytest.raises(ValueError):
        R.load_rules(p)
