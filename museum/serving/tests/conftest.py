"""시험용 MariaDB — 임시 datadir·소켓으로 mariadbd를 띄우고 SD_03 DDL(큐 보완 S1~S4 포함, main b62cb5f 이후)을 넣는다.

팀 DB는 쓰지 않는다(R-19: 로컬만). 소켓 경로는 길이 제한 때문에 /tmp 아래 짧게 둔다.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import pymysql
import pytest

REPO = Path(__file__).resolve().parents[2]
DDL = REPO / "design" / "uri_gallery_ddl.sql"
MARIADB_BIN = Path(os.environ.get("MARIADB_BIN", "/opt/homebrew/bin"))


def _client(sock: str, db: str | None, sql_file: Path) -> None:
    args = [str(MARIADB_BIN / "mariadb"), f"--socket={sock}", "-uroot"]
    if db:
        args.append(db)
    with open(sql_file, "rb") as f:
        r = subprocess.run(args, stdin=f, capture_output=True)
        if r.returncode:
            raise RuntimeError(f"{sql_file.name}: {r.stderr.decode()[:500]}")


@pytest.fixture(scope="session")
def mariadb():
    tmp = Path(tempfile.mkdtemp(prefix="uamt", dir="/tmp"))
    sock = str(tmp / "s.sock")
    data = tmp / "data"
    subprocess.run([str(MARIADB_BIN / "mariadb-install-db"), f"--datadir={data}", "--auth-root-authentication-method=normal",
                    "--skip-test-db", f"--user={os.environ.get('USER', 'root')}"], check=True, capture_output=True)
    proc = subprocess.Popen([str(MARIADB_BIN / "mariadbd"), "--no-defaults", f"--datadir={data}", f"--socket={sock}",
                             "--skip-networking", "--character-set-server=utf8mb4",
                             "--collation-server=utf8mb4_general_ci", "--lower-case-table-names=2",
                             f"--pid-file={tmp / 'd.pid'}", f"--log-error={tmp / 'err.log'}"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        if os.path.exists(sock):
            try:
                pymysql.connect(unix_socket=sock, user="root").close()
                break
            except pymysql.MySQLError:
                pass
        time.sleep(0.1)
    else:
        proc.kill()
        raise RuntimeError("mariadbd did not start")
    c = pymysql.connect(unix_socket=sock, user="root", autocommit=True)
    c.cursor().execute("CREATE DATABASE uam_test CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci")
    c.close()
    _client(sock, "uam_test", DDL)
    yield sock
    proc.terminate()
    proc.wait(10)
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture()
def env(mariadb, tmp_path, monkeypatch):
    """깨끗한 데이터 + 저장소 + 가짜 모델 설정."""
    monkeypatch.setenv("DB_SOCKET", mariadb)
    monkeypatch.setenv("DB_USER", "root")
    monkeypatch.setenv("DB_PASSWORD", "")
    monkeypatch.setenv("DB_NAME", "uam_test")
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / "store"))
    monkeypatch.setenv("UAM_RUN_DIR", str(tmp_path / "run"))
    monkeypatch.setenv("UAM_FAKE_MODELS", "1")
    monkeypatch.setenv("UAM_FAKE_FAULTS", "")
    monkeypatch.setenv("GPU_ENABLED", "0")
    monkeypatch.setenv("MODEL_MANIFEST", str(tmp_path / "manifest.yaml"))
    conn = pymysql.connect(unix_socket=mariadb, user="root", database="uam_test", autocommit=True,
                           cursorclass=pymysql.cursors.DictCursor, init_command="SET time_zone = '+00:00'")
    cur = conn.cursor()
    cur.execute("SET FOREIGN_KEY_CHECKS = 0")
    for t in ("result", "tag_candidate", "judgment", "artwork_outcome", "stage_job", "artwork_original",
              "stored_object", "artwork", "child", "family", "model_version"):
        cur.execute(f"DELETE FROM {t}")
    cur.execute("SET FOREIGN_KEY_CHECKS = 1")
    from tests.seed import Seed
    yield Seed(conn, tmp_path / "store")
    conn.close()
