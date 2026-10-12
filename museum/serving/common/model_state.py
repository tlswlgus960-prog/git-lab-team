"""모델 적재 상태 — 적재에 걸리는 시간을 화면(보호자 S3·S4, 운영 S11)에 보여 주기 위한 공유 상태.

워커 프로세스마다 `{run_dir}/model_state/{worker}.json` 하나를 쓴다. model-api `/internal/models`가 모아서 읽는다.
DB에 새 테이블을 두지 않는다(DDL 소유 B, 상태는 프로세스 수명과 같다).

상태:
  disabled    활성 버전 없음·라이선스 미확인(G25) — 작업을 만들지 않는다(app-api)
  not_loaded  아직 올리지 않음(다음 작업 때 올림)
  loading     올리는 중. started_at + expected_s로 남은 시간을 짐작할 수 있다
  ready       올라가 있음
  failed      올리다 실패. 작업은 model_not_ready로 재시도된다
"""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

STATES = ("disabled", "not_loaded", "loading", "ready", "failed")
STALE_AFTER_S = 60  # heartbeat 20초 × 3: 이보다 오래된 파일은 워커가 멈춘 것으로 본다


@dataclass
class ModelLoad:
    model_id: str
    state: str = "not_loaded"
    started_at: float | None = None       # epoch 초
    finished_at: float | None = None
    last_load_s: float | None = None      # 마지막 실측 적재 시간
    expected_s: float | None = None       # 매니페스트 load.expected_seconds
    device: str | None = None             # cpu | mps | cuda
    diagnostic: str | None = None         # 정해진 코드만


@dataclass
class WorkerState:
    worker: str
    serving_group: str
    pid: int = field(default_factory=os.getpid)
    updated_at: float = field(default_factory=time.time)
    models: dict[str, ModelLoad] = field(default_factory=dict)


class ModelStateBoard:
    def __init__(self, run_dir: Path, worker: str, serving_group: str):
        self.dir = Path(run_dir) / "model_state"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.file = self.dir / f"{worker}.json"
        self.ws = WorkerState(worker=worker, serving_group=serving_group)
        self._lock = threading.Lock()
        self._io = threading.Lock()      # 적재 스레드와 메인 루프가 동시에 쓴다

    def get(self, model_id: str) -> ModelLoad:
        with self._lock:
            return self.ws.models.setdefault(model_id, ModelLoad(model_id))

    def set(self, model_id: str, **kw) -> None:
        with self._lock:
            m = self.ws.models.setdefault(model_id, ModelLoad(model_id))
            for k, v in kw.items():
                setattr(m, k, v)
        self.flush()

    def flush(self) -> None:
        with self._lock:
            self.ws.updated_at = time.time()
            data = asdict(self.ws)
        with self._io:
            tmp = self.file.with_name(f"{self.file.stem}.{threading.get_ident()}.tmp")
            try:
                tmp.write_text(json.dumps(data), encoding="utf-8")
                os.replace(tmp, self.file)
            except OSError:
                tmp.unlink(missing_ok=True)   # 상태 게시 실패가 워커를 멈추게 하지 않는다

    def remove(self) -> None:
        self.file.unlink(missing_ok=True)


def read_all(run_dir: Path) -> list[dict]:
    """모든 워커 상태. 오래된 파일은 alive=False로 표시한다."""
    out = []
    d = Path(run_dir) / "model_state"
    if not d.exists():
        return out
    now = time.time()
    for f in sorted(d.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        data["alive"] = (now - data.get("updated_at", 0)) <= STALE_AFTER_S
        out.append(data)
    return out


def describe(m: dict, now: float | None = None) -> dict:
    """화면용 요약: 경과·남은 시간(짐작)과 보여 줄 문구 코드."""
    now = now or time.time()
    d = {"state": m.get("state"), "device": m.get("device"),
         "expectedSeconds": m.get("expected_s"), "lastLoadSeconds": m.get("last_load_s"),
         "elapsedSeconds": None, "remainingSeconds": None, "diagnostic": m.get("diagnostic")}
    d["overdue"] = False
    if m.get("state") == "loading" and m.get("started_at"):
        el = max(0.0, now - m["started_at"])
        d["elapsedSeconds"] = round(el, 1)
        exp = m.get("expected_s") or m.get("last_load_s")
        if exp:
            if el > exp * 1.5 + 2:
                d["overdue"] = True        # 예상보다 오래 걸림 — "~0초 남음"을 보이지 않는다
            else:
                d["remainingSeconds"] = round(max(0.0, exp - el), 1)
    return d
