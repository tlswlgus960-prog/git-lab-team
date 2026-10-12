// 팀원 계정·역할 관리(D24 ③, T159) — 운영 CLI(scripts/ops/staff.ts)가 부른다. 화면·HTTP 경로는 두지 않는다.
// 역할 회수·정지는 staffAuth가 요청마다 DB 역할을 읽으므로 다음 요청부터 반영된다. 정지·비밀번호 변경은 세션도 지운다.
// 비밀번호 원문·해시·이메일 원문은 출력하지 않는다(BR-PRV-01) — 목록은 가린 이메일만.
import argon2 from 'argon2';
import type { Pool } from 'mysql2/promise';
import { withTx } from '../db/pool.js';
import type { StaffRole } from './guards.js';
import { destroyAllFor } from './session.js';

export const STAFF_ROLES: readonly StaffRole[] = ['operator', 'evaluator', 'integrator'];
export const MIN_PASSWORD = 8;

export class StaffAdminError extends Error {}

const mask = (e: string) => { const [u, d = ''] = e.split('@'); return `${u.slice(0, 2)}***@${d}`; };

function checkRoles(roles: string[]): StaffRole[] {
  if (!roles.length || !roles.every((r) => (STAFF_ROLES as string[]).includes(r))) throw new StaffAdminError('role_invalid');
  return roles as StaffRole[];
}
function checkPassword(pw: string) {
  if (pw.length < MIN_PASSWORD) throw new StaffAdminError('password_too_short');
}
async function memberId(db: Pool, email: string): Promise<number> {
  const [rows] = await db.query(`SELECT member_id FROM team_member WHERE email = ?`, [email.trim()]);
  const m = (rows as { member_id: number }[])[0];
  if (!m) throw new StaffAdminError('staff_not_found');
  return Number(m.member_id);
}

export async function addStaff(db: Pool, email: string, roles: string[], password: string): Promise<number> {
  const rs = checkRoles(roles); checkPassword(password);
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  return withTx(db, async (conn) => {
    const [ins] = await conn.query(`INSERT INTO team_member (email, password_hash) VALUES (?, ?)`, [email.trim(), hash]);
    const id = (ins as { insertId: number }).insertId;
    for (const r of rs) await conn.query(`INSERT INTO team_member_role (member_id, role) VALUES (?, ?)`, [id, r]);
    return id;
  });
}

export async function grantRole(db: Pool, email: string, role: string): Promise<void> {
  const [r] = checkRoles([role]);
  await db.query(`INSERT IGNORE INTO team_member_role (member_id, role) VALUES (?, ?)`, [await memberId(db, email), r]);
}

export async function revokeRole(db: Pool, email: string, role: string): Promise<void> {
  const [r] = checkRoles([role]);
  await db.query(`DELETE FROM team_member_role WHERE member_id = ? AND role = ?`, [await memberId(db, email), r]);
}

export async function disableStaff(db: Pool, email: string): Promise<void> {
  const id = await memberId(db, email);
  await withTx(db, async (conn) => {
    await conn.query(`UPDATE team_member SET disabled_at = COALESCE(disabled_at, UTC_TIMESTAMP()) WHERE member_id = ?`, [id]);
    await destroyAllFor(conn, 'staff', id);
  });
}

export async function enableStaff(db: Pool, email: string): Promise<void> {
  await db.query(`UPDATE team_member SET disabled_at = NULL WHERE member_id = ?`, [await memberId(db, email)]);
}

export async function setStaffPassword(db: Pool, email: string, password: string): Promise<void> {
  checkPassword(password);
  const id = await memberId(db, email);
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  await withTx(db, async (conn) => {
    await conn.query(`UPDATE team_member SET password_hash = ? WHERE member_id = ?`, [hash, id]);
    await destroyAllFor(conn, 'staff', id);
  });
}

export interface StaffRow { memberId: number; emailMasked: string; roles: StaffRole[]; disabled: boolean }

export async function listStaff(db: Pool): Promise<StaffRow[]> {
  const [rows] = await db.query(
    `SELECT m.member_id, m.email, m.disabled_at, GROUP_CONCAT(r.role ORDER BY r.role) roles
       FROM team_member m LEFT JOIN team_member_role r ON r.member_id = m.member_id
      GROUP BY m.member_id, m.email, m.disabled_at ORDER BY m.member_id`);
  return (rows as { member_id: number; email: string; disabled_at: Date | null; roles: string | null }[]).map((m) => ({
    memberId: Number(m.member_id), emailMasked: mask(m.email),
    roles: (m.roles ?? '').split(',').filter(Boolean) as StaffRole[], disabled: m.disabled_at !== null,
  }));
}
