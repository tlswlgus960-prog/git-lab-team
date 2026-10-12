"""설명 규칙 검사·템플릿·프롬프트 조립(T127, llm-contract §3, research R-26).

규칙 값은 `rules.yaml`(또는 CAPTION_RULES가 가리키는 파일)에만 있다. 이 모듈은 파일에 적힌 목록·순서·횟수만 따른다.
파일은 import 때 한 번 읽는다 — 바꾸면 llm-server를 재시작해야 반영된다.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import yaml

DEFAULT_PATH = Path(__file__).with_name("rules.yaml")
CLASSES = ("fail_event", "fail_emotion", "fail_development")   # llm-contract §3-3 → SD_03 event·emotion·development


class Rules:
    def __init__(self, data: dict, source: str):
        self.source = source
        self.version = str(data["version"])
        self.provisional = bool(data.get("provisional", False))
        self.max_regen = int(data["max_regen"])
        fmt = data.get("format") or {}
        self.max_chars = int(fmt.get("max_chars", 300))
        self.banned_marks = list(fmt.get("banned_marks") or [])
        self.quote_markers = list(data.get("quote_markers") or [])
        self.checks = [(c["class"], list(c["stems"])) for c in data.get("checks") or []]
        self.template = data["template"]
        self.prompt = data["prompt"]
        for cls, _ in self.checks:
            if cls not in CLASSES:
                raise ValueError(f"알 수 없는 실패 분류: {cls}")
        if self.max_regen < 0:
            raise ValueError("max_regen은 0 이상")


def load_rules(path: str | os.PathLike | None = None) -> Rules:
    p = Path(path or os.environ.get("CAPTION_RULES") or DEFAULT_PATH)
    with open(p, encoding="utf-8") as f:
        return Rules(yaml.safe_load(f), str(p))


def _input_text(inp: dict) -> str:
    """입력 대조용 글 — 보호자 키워드·고른 태그·아이의 말만(BR-CAP-01 허용 목록 안)."""
    parts = list(inp.get("keywords") or []) + list(inp.get("tags") or [])
    if inp.get("words"):
        parts.append(str(inp["words"]))
    return " ".join(str(p) for p in parts)


def rule_check(text: str, inp: dict, rules: Rules) -> str | None:
    """통과면 None, 걸리면 실패 분류 하나. 순서: 형식 → 지어낸 아이 말 → rules.checks 순서(발달 → 감정 → 사건)."""
    if not text or not text.strip() or len(text) > rules.max_chars or any(m in text for m in rules.banned_marks):
        return "fail_event"
    if not inp.get("words") and any(m in text for m in rules.quote_markers):
        return "fail_event"
    given = _input_text(inp)
    for cls, stems in rules.checks:
        if any(s in text and s not in given for s in stems):
            return cls
    return None


def _obj_particle(word: str) -> str:
    """을/를 — 마지막 글자가 한글이면 받침으로, 아니면(영문·숫자) '을(를)'로 둔다."""
    ch = word.rstrip()[-1:] if word.strip() else ""
    if "가" <= ch <= "힣":
        return "을" if (ord(ch) - 0xAC00) % 28 else "를"
    return "을(를)"


def template(inp: dict, rules: Rules) -> str:
    t = rules.template
    parts = []
    if inp.get("ageAtMaking") is not None:
        parts.append(t["age"].format(age=inp["ageAtMaking"]))
    words = list(dict.fromkeys(list(inp.get("keywords") or []) + list(inp.get("tags") or [])))
    if words:
        joined = t["joiner"].join(words)
        parts.append(t["words"].format(words=joined, obj=_obj_particle(joined)))
    return " ".join(parts) or t["empty"]


def build_messages(inp: dict, rules: Rules) -> list[dict]:
    """시스템 지시 + 예시 + 입력 JSON. 입력은 호출자가 허용 목록으로 거른 것(BR-CAP-01). 프롬프트 원문은 로그에 남기지 않는다."""
    p = rules.prompt
    msgs = [{"role": "system", "content": p["system"]}]
    for shot in p.get("shots") or []:
        msgs += [{"role": "user", "content": "입력: " + json.dumps(shot["input"], ensure_ascii=False)},
                 {"role": "assistant", "content": shot["output"]}]
    msgs.append({"role": "user", "content": "입력: " + json.dumps(inp, ensure_ascii=False)})
    return msgs
