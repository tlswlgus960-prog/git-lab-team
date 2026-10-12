"""어댑터 기반(stage-job §4.1). 워커는 어댑터로만 모델을 부른다(BR-MDL-02).

어댑터는 예외를 밖으로 던지지 않는다. 알 수 없는 예외는 워커가 engine_down으로 분류하고,
cancelled는 워커가 붙인다.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

Outcome = Literal["ok", "quality_below", "engine_down", "timeout", "storage", "db", "model_not_ready"]
INFRA = ("engine_down", "timeout", "storage", "db", "model_not_ready")
OUTCOMES = ("ok", "quality_below") + INFRA  # + 워커가 붙이는 cancelled = 8종


@dataclass(frozen=True)
class AdapterResult:
    outcome: Outcome
    downgrade_cause: str | None = None     # quality_below일 때 SD_03 코드(§6). 없으면 체인이 정한다
    score: float | None = None             # 기록용. API로 내보내지 않음
    outputs: dict[str, str] = field(default_factory=dict)  # object_kind → tmp 경로
    diagnostic: str | None = None          # 정해진 코드만. 예외 원문 금지(BR-PRV-01)
    # 보완(A): 파일이 아닌 판정 값(judge의 kind_candidate·tags 등). 기록용, 로그 금지
    values: dict = field(default_factory=dict)


@dataclass
class JobInput:
    job_id: int
    stage_kind: str
    tmp_dir: Path
    inputs: dict[str, Path]                # object_kind → 읽기 전용 경로(original, cutout, mask, joints)
    cancel: threading.Event = field(default_factory=threading.Event)
    params: dict = field(default_factory=dict)


class Adapter:
    """모델 하나. load()는 느릴 수 있다(수 초~수십 초) — 워커가 적재 상태를 게시한다."""

    model_id: str = "M?"
    device: str = "cpu"

    def __init__(self):
        self._loaded = False
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._loaded

    def load(self) -> None:
        """가중치를 메모리에 올린다. 실패하면 예외(워커가 failed/model_not_ready로 바꾼다)."""
        self._loaded = True

    def ensure_loaded(self) -> float:
        """올라가 있지 않으면 올리고, 걸린 초를 돌려준다(이미 있으면 0)."""
        with self._lock:
            if self._loaded:
                return 0.0
            t = time.monotonic()
            self.load()
            self._loaded = True
            return time.monotonic() - t

    def run(self, job: JobInput) -> AdapterResult:  # pragma: no cover - 하위 클래스
        raise NotImplementedError
