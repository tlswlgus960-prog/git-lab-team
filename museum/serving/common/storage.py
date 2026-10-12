"""로컬 파일시스템 저장소 — 앱 API `LocalFsDriver`(T025)와 같은 경로 규칙(research R-06).

- `family/{artwork_uuid}/{kind}/{uuid}.{ext}`: 원본·마스크·컷아웃·관절·깊이·결과
- `tmp/{job_id}/`: 단계 작업 임시(성공·실패·취소 모두 끝에 지운다, BR-PRC-08)
- `ext/{ext_job_id}/`: 외부 호출 임시(D8, 가족 영역과 분리)
객체 키는 불투명 UUID다. 별칭·제목을 경로에 넣지 않는다. 키는 로그에 남기지 않는다(BR-PRV-01).
"""
from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path, PurePosixPath


class StorageError(Exception):
    """저장소 읽기·쓰기 실패 — outcome='storage'."""


class LocalStorage:
    def __init__(self, root: Path):
        self.root = Path(root)

    # 경로 -------------------------------------------------------------
    def path(self, key: str) -> Path:
        p = PurePosixPath(key)
        if p.is_absolute() or ".." in p.parts:
            raise StorageError("bad_key")
        return self.root / p

    def tmp_dir(self, job_id: int) -> Path:
        d = self.root / "tmp" / str(job_id)
        d.mkdir(parents=True, exist_ok=True)
        return d

    def ext_dir(self, ext_job_id: int) -> Path:
        d = self.root / "ext" / str(ext_job_id)
        d.mkdir(parents=True, exist_ok=True)
        return d

    @staticmethod
    def artwork_prefix(original_key: str) -> str:
        """원본 키 `family/{artwork_uuid}/original/…`에서 작품 폴더를 얻는다."""
        parts = PurePosixPath(original_key).parts
        if len(parts) < 3 or parts[0] != "family":
            raise StorageError("bad_original_key")
        return f"family/{parts[1]}"

    @staticmethod
    def new_key(prefix: str, kind: str, ext: str) -> str:
        return f"{prefix}/{kind}/{uuid.uuid4().hex}.{ext.lstrip('.')}"

    # 동작 -------------------------------------------------------------
    def exists(self, key: str) -> bool:
        return self.path(key).exists()

    def promote(self, tmp_file: Path, key: str) -> None:
        """임시 파일을 확정 위치로 옮긴다. 덮어쓰지 않는다(O_EXCL과 같은 효과)."""
        dst = self.path(key)
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
            os.close(fd)
            os.replace(tmp_file, dst)
            os.chmod(dst, 0o440)
        except FileExistsError as e:
            raise StorageError("key_exists") from e
        except OSError as e:
            raise StorageError("write_failed") from e

    def delete(self, key: str) -> None:
        try:
            self.path(key).unlink(missing_ok=True)
        except OSError as e:
            raise StorageError("delete_failed") from e

    def clear_tmp(self, job_id: int) -> None:
        shutil.rmtree(self.root / "tmp" / str(job_id), ignore_errors=True)
