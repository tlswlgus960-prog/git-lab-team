// 세션(research R-08, SD_03 app_session 보완 S6).
// 쿠키에는 32바이트 난수 토큰, DB에는 SHA-256만. 가족 ID는 세션에 두지 않고 요청마다 DB에서 읽는다(U1, R-25).
// 보호자 세션은 created_at < guardian_account.password_changed_at 이면 무효(결정 ⑥).
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'mysql2/promise';

export const GUARDIAN_COOKIE = 'uam_sid';
export const STAFF_COOKIE = 'uam_ops_sid';
export const IDLE_MINUTES = 30; // [추론] R-08

export const hashSid = (sid: string) => createHash('sha256').update(sid).digest('hex');

export async function createSession(db: Pool, kind: 'guardian' | 'staff', subjectId: number): Promise<string> {
  const sid = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO app_session (sid_hash, subject_kind, subject_id, created_at, expires_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL ? MINUTE)`,
    [hashSid(sid), kind, subjectId, IDLE_MINUTES],
  );
  return sid;
}

export interface SessionRow { sidHash: string; subjectId: number; createdAt: Date }

/** 살아 있는 세션을 찾고 유휴 만료를 늘린다. 없거나 만료면 null. */
export async function loadSession(db: Pool, kind: 'guardian' | 'staff', sid: string | undefined): Promise<SessionRow | null> {
  if (!sid) return null;
  const h = hashSid(sid);
  const [rows] = await db.query(
    `SELECT sid_hash, subject_id, created_at FROM app_session
      WHERE sid_hash = ? AND subject_kind = ? AND expires_at > UTC_TIMESTAMP()`,
    [h, kind],
  );
  const r = (rows as { sid_hash: string; subject_id: number; created_at: Date }[])[0];
  if (!r) return null;
  await db.query(`UPDATE app_session SET expires_at = UTC_TIMESTAMP(3) + INTERVAL ? MINUTE WHERE sid_hash = ?`, [IDLE_MINUTES, h]);
  return { sidHash: r.sid_hash, subjectId: Number(r.subject_id), createdAt: r.created_at };
}

export async function destroySession(db: Pool, sid: string | undefined): Promise<void> {
  if (sid) await db.query(`DELETE FROM app_session WHERE sid_hash = ?`, [hashSid(sid)]);
}

/** 그 계정의 모든 세션 삭제(재설정 결정 ⑥, 해제·나가기 R-25). */
export async function destroyAllFor(db: Pool | import('mysql2/promise').PoolConnection, kind: 'guardian' | 'staff', subjectId: number): Promise<void> {
  await db.query(`DELETE FROM app_session WHERE subject_kind = ? AND subject_id = ?`, [kind, subjectId]);
}
