// 마이그레이션 실행기(T016, data-model §8): db/migrations/NNNN_*.sql을 순서대로, schema_migration(version, checksum)에 기록.
// DELIMITER 블록(트리거)을 지원한다. 같은 체크섬이면 건너뛰고, 기준 마이그레이션 0001은 멱등이라 다시 실행해도 안전하다.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

/** 따옴표 밖의 줄 끝 `-- …` 주석을 떼어 낸다(`…;   -- 설명` 같은 줄의 문장 끝을 알아보기 위해). */
export function stripLineComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
    } else if (c === '-' && line[i + 1] === '-' && (i + 2 >= line.length || /\s/.test(line[i + 2]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

/** DELIMITER를 해석해 문장 목록으로 나눈다. 주석은 버린다. */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let delim = ';';
  let buf = '';
  for (const raw of sql.split('\n')) {
    const line = stripLineComment(raw.replace(/\r$/, ''));
    const m = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (m) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      delim = m[1];
      continue;
    }
    if (!line.trim()) { if (buf.trim()) buf += '\n'; continue; }
    buf += line + '\n';
    const trimmed = buf.trimEnd();
    if (trimmed.endsWith(delim)) {
      const stmt = trimmed.slice(0, -delim.length).trim();
      if (stmt) out.push(stmt);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export async function migrate(conn: mysql.Connection, dir = MIGRATIONS_DIR): Promise<string[]> {
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    version VARCHAR(80) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()))`);
  const files = (await fs.readdir(dir)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    const sql = await fs.readFile(path.join(dir, f), 'utf8');
    const sum = createHash('sha256').update(sql).digest('hex');
    const [rows] = await conn.query(`SELECT checksum FROM schema_migration WHERE version = ?`, [f]);
    const prev = (rows as { checksum: string }[])[0];
    if (prev?.checksum === sum) continue;
    for (const stmt of splitSql(sql)) await conn.query(stmt);
    await conn.query(
      `INSERT INTO schema_migration (version, checksum) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = UTC_TIMESTAMP()`,
      [f, sum],
    );
    applied.push(f);
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const c = loadConfig().db;
  const conn = await mysql.createConnection({
    host: c.socketPath ? undefined : c.host, port: c.socketPath ? undefined : c.port, socketPath: c.socketPath,
    user: c.user, password: c.password, database: c.database, multipleStatements: false,
  });
  const done = await migrate(conn);
  console.log(done.length ? `applied: ${done.join(', ')}` : 'up to date');
  await conn.end();
}
