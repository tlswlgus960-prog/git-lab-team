"""caption 패키지(T127) — 작품 설명 초안의 프롬프트 조립·규칙 검사·템플릿(llm-contract §3, research R-26).

llm-server(`serving/llm_server/caption.py`)가 import해서 쓴다. 규칙 값은 `rules.yaml` 하나에 있고 import 때 한 번 읽는다.
"""
from __future__ import annotations

from . import rules as _r

RULES = _r.load_rules()
RULES_VERSION = RULES.version
PROVISIONAL = RULES.provisional
MAX_REGEN = RULES.max_regen


def build_messages(inp: dict) -> list[dict]:
    return _r.build_messages(inp, RULES)


def rule_check(text: str, inp: dict) -> str | None:
    return _r.rule_check(text, inp, RULES)


def template(inp: dict) -> str:
    return _r.template(inp, RULES)
