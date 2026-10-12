# caption/

설명 초안(P0.5, UC10)의 **프롬프트 조립 · 규칙 검사(G16) · 템플릿** 패키지 — T127, 담당 D(이진우). 계약 `contracts/llm-contract.md` §3, 결정 REF D29, 기준표 research R-26.

| 파일 | 내용 |
|---|---|
| `rules.yaml` | **규칙 값의 정본**(U11). 금지어 어간·검사 순서·재생성 상한·템플릿 문구·프롬프트. 지금은 임시 기준표 `tmp-2026-09-30`(`provisional: true`) |
| `rules.py` | 파일을 읽어 검사·템플릿·메시지를 만든다. 값은 여기 두지 않는다 |
| `__init__.py` | llm-server가 쓰는 `build_messages`·`rule_check`·`template`·`MAX_REGEN`·`RULES_VERSION` |
| `tests/` | 시험 — 저장소 루트에서 `serving/.venv/bin/python -m pytest -q caption/tests` |

- 호출: `serving/llm_server/caption.py`가 import한다(llm-server는 `serving/`에서 뜨므로 저장소 루트를 경로에 더함). 못 읽으면 형식만 보는 최소 구현으로 돌고 `/v1/ready`의 `caption.rulesVersion`이 `null`이다.
- 다른 규칙 파일로 시험: `CAPTION_RULES=<경로>`.
- **규칙 교체**(research R-26): `rules.yaml` 교체(`version` 새 값) → `caption/tests` 통과 → `llm-server` 재시작(기동 때 한 번 읽음) → `/v1/ready`의 `caption.rulesVersion` 확인 → R-26 교체 기록표에 한 줄 → 측정·M6 점검(T156) 다시.
- U11 확정 전에는 p1 설명 기능을 켜지 않는다(`CAPTION_ENABLED=false`, REF D29 ③).
