"""서빙 공통 설정 — 환경 변수만 읽는다(.env.example, R-21). 값은 코드에 두지 않는다."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml

SERVING_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVING_ROOT.parent


def _bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    db_unix_socket: str | None
    storage_root: Path
    model_root: Path
    run_dir: Path
    fake_models: bool
    fake_set: frozenset
    gpu_enabled: bool
    torchserve_url: str
    ollama_url: str
    ollama_chat_model: str
    llm_server_url: str
    manifest_path: Path


def load_settings() -> Settings:
    storage_root = Path(os.environ.get("STORAGE_ROOT", str(SERVING_ROOT / ".run" / "store")))
    return Settings(
        db_host=os.environ.get("DB_HOST", "127.0.0.1"),
        db_port=int(os.environ.get("DB_PORT", "3306")),
        db_user=os.environ.get("DB_USER", "uam"),
        db_password=os.environ.get("DB_PASSWORD", ""),
        db_name=os.environ.get("DB_NAME", "uam"),
        db_unix_socket=os.environ.get("DB_SOCKET") or None,
        storage_root=storage_root,
        model_root=Path(os.environ.get("MODEL_ROOT", str(REPO_ROOT / "models"))),
        # 워커별 모델 적재 상태 파일(model_api가 모아서 보여 준다)
        run_dir=Path(os.environ.get("UAM_RUN_DIR", str(SERVING_ROOT / ".run"))),
        # UAM_FAKE_MODELS=1 → 모두 가짜 / "M3,M7" → 그 모델만 가짜(재현 전 모델만 대신한다)
        fake_models=_bool("UAM_FAKE_MODELS"),
        fake_set=frozenset(x.strip() for x in os.environ.get("UAM_FAKE_MODELS", "").split(",") if x.strip().startswith("M")),
        gpu_enabled=_bool("GPU_ENABLED"),
        torchserve_url=os.environ.get("TORCHSERVE_URL", "http://127.0.0.1:9561"),
        # Ollama 유저 가이드 §1.1: URL·모델 이름은 환경 변수로
        ollama_url=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"),
        ollama_chat_model=os.environ.get("OLLAMA_CHAT_MODEL", "qwen3:4b-instruct-2507-q4_K_M"),
        llm_server_url=os.environ.get("LLM_SERVER_URL", "http://127.0.0.1:8200"),
        manifest_path=Path(os.environ.get("MODEL_MANIFEST", str(REPO_ROOT / "models" / "manifest.yaml"))),
    )


def load_yaml(name: str) -> dict:
    """serving/config/{name}.yaml"""
    with open(SERVING_ROOT / "config" / f"{name}.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_manifest(path: Path | None = None) -> dict:
    p = path or load_settings().manifest_path
    if not p.exists():
        return {"models": {}}
    with open(p, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    data.setdefault("models", {})
    return data
