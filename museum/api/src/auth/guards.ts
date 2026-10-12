// 가드(T023): G0 보호자·가족 접근, G1 팀원 역할(BR-ACC-01~05).
// 가족 ID는 세션이 아니라 요청마다 guardian_account에서 읽는다(해제·나가기 즉시 반영).
import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { Problem } from '../lib/problem.js';
import { GUARDIAN_COOKIE, STAFF_COOKIE, loadSession } from './session.js';

export type StaffRole = 'operator' | 'evaluator' | 'integrator';

export interface GuardianCtx { accountId: number; familyId: number | null; role: 'owner' | 'co'; email: string | null }
export interface StaffCtx { memberId: number; roles: StaffRole[] }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { guardian?: GuardianCtx; staff?: StaffCtx; sid?: string; requestId?: string }
  }
}

export function guardianAuth(db: Pool, opts: { requireFamily: boolean }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const sid = req.cookies?.[GUARDIAN_COOKIE];
      const s = await loadSession(db, 'guardian', sid);
      if (!s) throw new Problem('unauthorized', 'login_required', 'G0');
      const [rows] = await db.query(
        `SELECT account_id, family_id, role, email, password_changed_at FROM guardian_account WHERE account_id = ?`,
        [s.subjectId],
      );
      const g = (rows as { account_id: number; family_id: number | null; role: 'owner' | 'co'; email: string | null; password_changed_at: Date | null }[])[0];
      if (!g) throw new Problem('unauthorized', 'login_required', 'G0');
      if (g.password_changed_at && s.createdAt < g.password_changed_at) throw new Problem('unauthorized', 'session_revoked', 'G0');
      req.sid = sid;
      req.guardian = { accountId: Number(g.account_id), familyId: g.family_id === null ? null : Number(g.family_id), role: g.role, email: g.email };
      if (opts.requireFamily && req.guardian.familyId === null) throw new Problem('conflict', 'no_family', 'G0');
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function staffAuth(db: Pool, roles: StaffRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const sid = req.cookies?.[STAFF_COOKIE];
      const s = await loadSession(db, 'staff', sid);
      if (!s) throw new Problem('unauthorized', 'login_required', 'G1');
      const [rows] = await db.query(
        `SELECT r.role FROM team_member m JOIN team_member_role r ON r.member_id = m.member_id
          WHERE m.member_id = ? AND m.disabled_at IS NULL`,
        [s.subjectId],
      );
      const have = (rows as { role: StaffRole }[]).map((r) => r.role);
      if (!have.some((r) => roles.includes(r))) throw new Problem('forbidden_role', 'role_missing', 'G1');
      req.sid = sid;
      req.staff = { memberId: s.subjectId, roles: have };
      next();
    } catch (e) {
      next(e);
    }
  };
}
