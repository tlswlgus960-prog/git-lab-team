// 공동 보호자 초대 토큰(UC15, BR-ACC-08·09, G28): 이메일에 거는 1회용 토큰, DB에는 해시만, 7일 [예시값 U20].
import { randomBytes } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { hashToken } from '../auth/tokens.js';

export async function lockInvite(conn: PoolConnection, token: string) {
  const [rows] = await conn.query(
    `SELECT invite_id, family_id, email_norm FROM family_invite
      WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
    [hashToken(token)],
  );
  return (rows as { invite_id: number; family_id: number; email_norm: string | null }[])[0] ?? null;
}

export async function newInvite(conn: PoolConnection, familyId: number, invitedBy: number, email: string | null): Promise<string> {
  // 대기 초대는 가족당 1건(uq_invite_one_pending) — 새로 초대하면 이전 초대는 무효
  await conn.query(`UPDATE family_invite SET revoked_at = UTC_TIMESTAMP() WHERE family_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`, [familyId]);
  const token = randomBytes(32).toString('base64url');
  await conn.query(
    `INSERT INTO family_invite (family_id, invited_by, email, token_hash, expires_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL 7 DAY)`,
    [familyId, invitedBy, email, hashToken(token)],
  );
  return token;
}
