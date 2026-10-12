"""MariaDB 연결 — PyMySQL. 세션 시간대는 UTC로 고정한다(stage-job §3의 UTC_TIMESTAMP 비교와 TIMESTAMP 컬럼을 맞춘다)."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import pymysql
import pymysql.cursors

from .config import Settings, load_settings


class DbError(Exception):
    """DB 갱신 실패 — 워커는 다음 연결에서 outcome='db'로 기록한다."""


def connect(settings: Settings | None = None) -> pymysql.connections.Connection:
    s = settings or load_settings()
    kw = dict(user=s.db_user, password=s.db_password, database=s.db_name,
              charset="utf8mb4", autocommit=False, cursorclass=pymysql.cursors.DictCursor,
              connect_timeout=5, init_command="SET time_zone = '+00:00'")
    if s.db_unix_socket:
        kw["unix_socket"] = s.db_unix_socket
    else:
        kw.update(host=s.db_host, port=s.db_port)
    return pymysql.connect(**kw)


@contextmanager
def tx(conn) -> Iterator[pymysql.cursors.DictCursor]:
    """한 트랜잭션. 예외면 롤백하고 다시 던진다."""
    conn.ping(reconnect=True)
    cur = conn.cursor()
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
