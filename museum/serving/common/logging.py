"""허용 목록 로거(BR-PRV-01, stage-job §10).

JSON 한 줄에 아래 필드만 남긴다. 객체 키·파일 경로·별칭·제목·한마디·키워드·예외 원문은 버린다.
"""
from __future__ import annotations

import logging
import sys

import structlog

ALLOWED = frozenset({
    "ts", "level", "event", "worker", "job_id", "stage_kind", "model_id", "version_label",
    "attempt_count", "status", "error_class", "downgrade_cause", "duration_ms",
    # 적재 상태·준비 확인(모델 적재 시간 화면용). 경로 없음
    "load_state", "load_ms", "serving_group", "diagnostic", "outcome", "port",
    # 설명 규칙 파일 버전(research R-26) — 규칙 교체 전후 구분용. 문장·입력 없음
    "rules_version",
})


def _allowlist(_, __, event_dict: dict) -> dict:
    return {k: v for k, v in event_dict.items() if k in ALLOWED}


_configured = False


def get_logger(**bind):
    global _configured
    if not _configured:
        logging.basicConfig(format="%(message)s", stream=sys.stdout, level=logging.INFO)
        structlog.configure(
            processors=[
                structlog.processors.add_log_level,
                structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
                _allowlist,
                structlog.processors.JSONRenderer(ensure_ascii=False),
            ],
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=True,
        )
        _configured = True
    return structlog.get_logger().bind(**bind)
