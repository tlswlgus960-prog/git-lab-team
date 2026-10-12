// 메일 링크 토큰(BR-ACC-08, G27): 32바이트 난수, DB에는 SHA-256만. 1회용, 재발급 시 이전 토큰 revoked_at.
// 유효 시간 예시 [U19]: 확인 24시간(UC13) · 재설정 30분(UC14). 시각은 모두 UTC.
import { createHash, randomBytes } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';

export type TokenPurpose = 'verify' | 'reset';
const TTL_MINUTES: Record<TokenPurpose, number> = { verify: 24 * 60, reset: 30 };

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function issueToken(conn: PoolConnection, accountId: number, purpose: TokenPurpose): Promise<string> {
  await conn.query(
    `UPDATE auth_email_token SET revoked_at = UTC_TIMESTAMP()
      WHERE account_id = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL`,
    [accountId, purpose],
  );
  const token = randomBytes(32).toString('base64url');
  await conn.query(
    `INSERT INTO auth_email_token (account_id, purpose, token_hash, expires_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? MINUTE)`,
    [accountId, purpose, hashToken(token), TTL_MINUTES[purpose]],
  );
  return token;
}

/** 유효한 토큰이면 account_id(행 잠금). 만료·사용·무효는 구분하지 않고 null(결정 ③). */
export async function lockValidToken(conn: PoolConnection, token: string, purpose: TokenPurpose): Promise<{ tokenId: number; accountId: number } | null> {
  const [rows] = await conn.query(
    `SELECT token_id, account_id FROM auth_email_token
      WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()
      FOR UPDATE`,
    [hashToken(token), purpose],
  );
  const r = (rows as { token_id: number; account_id: number }[])[0];
  return r ? { tokenId: Number(r.token_id), accountId: Number(r.account_id) } : null;
}

export async function useToken(conn: PoolConnection, tokenId: number): Promise<void> {
  await conn.query(`UPDATE auth_email_token SET used_at = UTC_TIMESTAMP() WHERE token_id = ?`, [tokenId]);
}
