// 외부 API 키 운영 CLI(T123, research R-09, D17, BR-API-03): 발급·폐기·목록. 키 원문은 발급 때 한 번만 표시하고 SHA-256만 저장한다.
//   npm run ops:key -- issue --kind team_internal|course_internal|test [--by <팀원 이메일>]
//   npm run ops:key -- revoke --id <key_id>
//   npm run ops:key -- list
// `external`은 U12(팀 밖 키 조건) 확정 전 발급 금지(D17).
import { createHash, randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { loadConfig } from '../../src/config.js';

const [cmd, ...argv] = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const usage = () => { console.error('사용법: ops:key issue --kind team_internal|course_internal|test [--by <이메일>] | revoke --id <번호> | list'); process.exit(2); };
if (!['issue', 'revoke', 'list'].includes(cmd)) usage();

const c = loadConfig().db;
const conn = await mysql.createConnection({ host: c.socketPath ? undefined : c.host, port: c.socketPath ? undefined : c.port, socketPath: c.socketPath, user: c.user, password: c.password, database: c.database });
try {
  if (cmd === 'issue') {
    const kind = arg('kind');
    if (kind === 'external') { console.error('external 키는 U12 확정 전 발급하지 않는다(D17)'); process.exit(2); }
    if (!kind || !['team_internal', 'course_internal', 'test'].includes(kind)) usage();
    let by: number | null = null;
    if (arg('by')) {
      const [rows] = await conn.query(`SELECT member_id FROM team_member WHERE email = ?`, [arg('by')]);
      by = (rows as { member_id: number }[])[0]?.member_id ?? null;
      if (!by) { console.error('팀원을 찾지 못함'); process.exit(2); }
    }
    const raw = `uam_${randomBytes(32).toString('base64url')}`;
    const [ins] = await conn.query(`INSERT INTO api_key (key_kind, key_hash, issued_by) VALUES (?, ?, ?)`, [kind, createHash('sha256').update(raw).digest('hex'), by]);
    console.log(`키 ${(ins as { insertId: number }).insertId} 발급(${kind}). 원문은 지금 한 번만 보인다 — 안전한 곳에 옮겨 두세요:\n${raw}`);
  } else if (cmd === 'revoke') {
    const id = Number(arg('id'));
    if (!id) usage();
    const [u] = await conn.query(`UPDATE api_key SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE key_id = ? AND status = 'active'`, [id]);
    console.log((u as { affectedRows: number }).affectedRows ? `키 ${id} 폐기` : `키 ${id}: 없거나 이미 폐기됨`);
  } else {
    const [rows] = await conn.query(`SELECT key_id, key_kind, status, issued_at, revoked_at FROM api_key ORDER BY key_id`);
    console.table(rows); // 해시·원문은 보이지 않는다
  }
} finally { await conn.end(); }
