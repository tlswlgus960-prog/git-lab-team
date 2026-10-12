// MariaDB 연결 풀 — 세션 시간대 UTC 고정(stage-job §3의 UTC_TIMESTAMP 비교, serving/common/db.py와 같게).
import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';
import type { Config } from '../config.js';

export type Db = Pool;

export function createPool(cfg: Config['db']): Pool {
  const pool = mysql.createPool({
    host: cfg.socketPath ? undefined : cfg.host,
    port: cfg.socketPath ? undefined : cfg.port,
    socketPath: cfg.socketPath,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: false,
    connectionLimit: 10,
    connectTimeout: 5000,
  });
  pool.on('connection', (c) => {
    (c as unknown as { query: (s: string) => void }).query("SET time_zone = '+00:00'");
  });
  return pool;
}

/** 한 트랜잭션. 예외면 롤백하고 다시 던진다(data-model §4). */
export async function withTx<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}
