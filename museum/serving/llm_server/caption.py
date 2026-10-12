"""작품 설명 초안(llm-contract §3) — llm-server 쪽 연결부.

규칙 검사(G16, fail_event·fail_emotion·fail_development)·프롬프트·템플릿·재생성 상한의 정본은 저장소 루트의
`caption/` 패키지(T127, D)와 그 규칙 파일 `caption/rules.yaml`이다(U11 — 지금은 임시 기준표, research R-26).
패키지를 못 읽으면 아래 최소 구현(형식 검사만)을 쓰고 RULES_VERSION은 None이다. 최소 구현은 내용 규칙을 검사하지 않는다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = str(Path(__file__).resolve().parents[2])   # 저장소 루트 — llm-server는 serving/에서 뜨므로 caption/이 경로에 없다
if _ROOT not in sys.path:
    sys.path.append(_ROOT)

try:  # D 담당 패키지(caption/, T127)
    import caption as _c  # type: ignore
    _c_build, _c_check, _c_template = _c.build_messages, _c.rule_check, _c.template
    RULES_VERSION: str | None = _c.RULES_VERSION
    RULES_PROVISIONAL: bool | None = _c.PROVISIONAL
except Exception:  # pragma: no cover - 패키지·규칙 파일을 못 읽음
    _c = _c_build = _c_check = _c_template = None
    RULES_VERSION = RULES_PROVISIONAL = None

ALLOWED = ("keywords", "tags", "words", "ageAtMaking", "madeOn")
SYSTEM = ("너는 아이 그림에 붙일 설명을 쓴다. 규칙:\n"
          "1. 입력에 있는 낱말과 사실만 쓴다. 입력에 없는 물건·사건·감정·재능 평가는 절대 쓰지 않는다.\n"
          "2. 2문장. 모든 문장은 '~이에요', '~했어요', '~그렸어요'처럼 해요체로 끝낸다.\n"
          "3. 아이의 말(words)이 있으면 그 뜻만 옮긴다. words가 없으면 '말했어요'를 쓰지 않는다.")
# 예시 두 개(few-shot) — 2026-09-28 공유 Ollama 실측에서 예시 없이는 없는 물건(배)을 지어내고 반말로 끝났다
SHOTS = [({"keywords": ["집", "빨간색"], "ageAtMaking": 4}, "4살 때 그린 작품이에요. 빨간색으로 집을 그렸어요."),
         ({"keywords": ["강아지"], "words": "우리 강아지 산책", "ageAtMaking": 6},
          "6살 때 그린 강아지 그림이에요. 아이는 강아지와 산책한 것이라고 말했어요.")]
# num_ctx는 클라이언트가 8192로 고정한다(공유 서버 규칙, llm-contract §3의 2048을 대체). 출력은 2~3문장이라 160 토큰
GEN_OPTIONS = {"temperature": 0.3, "num_predict": 160}
MAX_REGEN = _c.MAX_REGEN if _c else 2   # 규칙 파일 max_regen(U11 [추론] 2회)


def allowed_input(body: dict) -> dict:
    """허용 목록 밖 필드는 버린다(BR-CAP-01). 이미지·별칭·제목은 애초에 받지 않는다."""
    return {k: body[k] for k in ALLOWED if body.get(k) not in (None, "", [])}


def build_messages(inp: dict) -> list[dict]:
    if _c_build:
        return _c_build(inp)
    msgs = [{"role": "system", "content": SYSTEM}]
    for q, a in SHOTS:
        msgs += [{"role": "user", "content": "입력: " + json.dumps(q, ensure_ascii=False)},
                 {"role": "assistant", "content": a}]
    msgs.append({"role": "user", "content": "입력: " + json.dumps(inp, ensure_ascii=False)})
    return msgs


def rule_check(text: str, inp: dict) -> str | None:
    """통과면 None, 걸리면 실패 분류(fail_event·fail_emotion·fail_development)."""
    if _c_check:
        return _c_check(text, inp)
    # 최소 구현: 빈 문장·과도한 길이만 걸러 낸다(내용 규칙은 C 패키지 전까지 미검사)
    if not text or len(text) > 300 or "<think>" in text:
        return "fail_event"
    if not inp.get("words") and "말했" in text:
        return "fail_event"      # 없는 아이 말을 지어냄
    return None


def template(inp: dict) -> str:
    if _c_template:
        return _c_template(inp)
    parts = []
    if inp.get("ageAtMaking") is not None:
        parts.append(f"{inp['ageAtMaking']}살 때 그린 작품이에요.")
    words = list(dict.fromkeys((inp.get("keywords") or []) + (inp.get("tags") or [])))
    if words:
        parts.append(f"{'·'.join(words)}을(를) 그렸어요.")
    return " ".join(parts) or "아이가 그린 작품이에요."
