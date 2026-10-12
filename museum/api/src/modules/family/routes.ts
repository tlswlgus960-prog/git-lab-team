// 공동 보호자(T103~T106, UC15, FR-9, G28·G29, BR-ACC-09, U1 확정·1c460b0: 부모 두 명까지·초대는 만든 보호자만, U20 기본값).
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { withTx } from '../../db/pool.js';
import { guardianAuth } from '../../auth/guards.js';
import { destroyAllFor } from '../../auth/session.js';
import { Problem, isDup, parseSignal, zodFields } from '../../lib/problem.js';
import { recordGate } from '../../lib/gateEvent.js';
import type { Mailer } from '../mail/mailer.js';
import { RateLimiter, normEmail } from '../auth/rateLimit.js';
import { maskEmail } from '../auth/routes.js';
import { hashToken } from '../auth/tokens.js';
import { lockInvite, newInvite } from './invites.js';

export function familyRouter(db: Pool, cfg: Config, mailer: Mailer): Router {
  const r = Router();
  const withFamily = guardianAuth(db, { requireFamily: true });
  const anyGuardian = guardianAuth(db, { requireFamily: false });
  const rl = new RateLimiter(db, cfg.authHmacSecret);
  const gate = async (g: string, kind: 'family_invite' | 'guardian_account', id: number | null, e: unknown) => {
    if (e instanceof Problem && e.gate) await recordGate(db, e.gate, kind, id, 'guardian', e.reason ?? e.code);
    throw e;
  };

  // --- 초대 링크의 초대 이메일(S0 가입 미리 채움, UC15 A4·UC13 A4) — 로그인 없이, 토큰을 쓰지 않는 조회 ---
  r.get('/v1/family/invites/lookup', async (req, res, next) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const [rows] = await db.query(
        `SELECT email FROM family_invite
          WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()`, [hashToken(token)]);
      const inv = (rows as { email: string }[])[0];
      if (!token || !inv) throw new Problem('token_invalid', 'token_invalid', 'G28'); // 만료·사용·취소 구분 없음(BR-ACC-08)
      res.json({ email: inv.email });
    } catch (e) { next(e); }
  });

  // --- 초대(G29: 만든 보호자만·자리 빔) ---
  r.get('/v1/family/invites', withFamily, async (req, res, next) => {
    try {
      const [rows] = await db.query(
        `SELECT invite_id, email, expires_at FROM family_invite
          WHERE family_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY invite_id`,
        [req.guardian!.familyId]);
      res.json((rows as { invite_id: number; email: string | null; expires_at: Date }[])
        .map((i) => ({ id: String(i.invite_id), emailMasked: maskEmail(i.email), expiresAt: new Date(i.expires_at).toISOString() })));
    } catch (e) { next(e); }
  });

  r.post('/v1/family/invites', withFamily, async (req, res, next) => {
    const g = req.guardian!;
    try {
      const b = z.object({ email: z.string().trim().max(254).email().optional() }).strict().safeParse(req.body ?? {});
      if (!b.success) throw new Problem('validation_failed', 'email', 'G29', zodFields(b.error));
      if (g.role !== 'owner') throw new Problem('forbidden_role', 'invite_owner_only', 'G29');
      const [co] = await db.query(`SELECT COUNT(*) n FROM guardian_account WHERE family_id = ? AND role = 'co'`, [g.familyId]);
      if (Number((co as { n: number }[])[0].n) > 0) throw new Problem('conflict', 'co_guardian_full', 'G29');
      if (!b.data.email) {                                   // 초대 링크 복사(UC15 §0, D36) — 이메일 없는 초대, 링크는 이 응답에서만
        const toG29 = (e: unknown) => { const sig = parseSignal(e); if (sig) throw new Problem(sig.reason === 'co_guardian_full' ? 'conflict' : 'forbidden_role', sig.reason, 'G29'); throw e; };
        const out = await withTx(db, async (conn) => {
          const token = await newInvite(conn, g.familyId!, g.accountId, null);
          const [row] = await conn.query(`SELECT invite_id, expires_at FROM family_invite WHERE family_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`, [g.familyId]);
          const i = (row as { invite_id: number; expires_at: Date }[])[0];
          return { id: String(i.invite_id), link: `${cfg.appBaseUrl}/app/invite?token=${encodeURIComponent(token)}`, expiresAt: new Date(i.expires_at).toISOString() };
        }).catch(toG29);
        return void res.status(201).json(out);
      }
      const em = normEmail(b.data.email);
      const [member] = await db.query(`SELECT account_id FROM guardian_account WHERE family_id = ? AND email_norm = ?`, [g.familyId, em]);
      if ((member as unknown[]).length) return void res.status(202).end(); // UC15 E6: 이미 이 가족 보호자 — 만들지 않음
      if (!(await rl.take('invite', { family: String(g.familyId), email: em }))) return void res.status(202).end(); // E8
      const token = await withTx(db, (conn) => newInvite(conn, g.familyId!, g.accountId, b.data.email!)).catch((e) => {
        const sig = parseSignal(e);
        if (sig) throw new Problem(sig.reason === 'co_guardian_full' ? 'conflict' : 'forbidden_role', sig.reason, 'G29');
        throw e;
      });
      mailer.send({ kind: 'invite', to: em, link: `${cfg.appBaseUrl}/app/invite?token=${encodeURIComponent(token)}` });
      res.status(202).end();
    } catch (e) { await gate('G29', 'family_invite', null, e).catch(next); }
  });

  r.delete('/v1/family/invites/:id', withFamily, async (req, res, next) => {
    try {
      if (req.guardian!.role !== 'owner') throw new Problem('forbidden_role', 'invite_owner_only', 'G29');
      const [u] = await db.query(`UPDATE family_invite SET revoked_at = UTC_TIMESTAMP() WHERE invite_id = ? AND family_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
        [Number(req.params.id), req.guardian!.familyId]);
      if ((u as { affectedRows: number }).affectedRows === 0) throw new Problem('not_found');
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // --- 수락(G28): 토큰 유효 · 로그인 이메일 = 초대 이메일 · 가족 없음 ---
  r.post('/v1/family/invites/accept', anyGuardian, async (req, res, next) => {
    const g = req.guardian!;
    try {
      const b = z.object({ token: z.string().min(10).max(200) }).safeParse(req.body);
      if (!b.success) throw new Problem('token_invalid', 'token_invalid', 'G28');
      await withTx(db, async (conn) => {
        const inv = await lockInvite(conn, b.data.token);
        if (!inv) throw new Problem('token_invalid', 'token_invalid', 'G28');
        // 링크 초대(이메일 없음, D36)는 대조하지 않는다. 이메일 초대는 로그인한 계정의 이메일과 같아야 한다
        if (inv.email_norm !== null && inv.email_norm !== (g.email ? normEmail(g.email) : null)) throw new Problem('forbidden_role', 'invite_email_mismatch', 'G28');
        if (g.familyId !== null) throw new Problem('conflict', 'already_in_family', 'G28');
        try {
          await conn.query(`UPDATE guardian_account SET family_id = ?, role = 'co' WHERE account_id = ?`, [inv.family_id, g.accountId]);
        } catch (e) {
          if (isDup(e, 'uq_guardian_co_family')) throw new Problem('conflict', 'co_guardian_full', 'G28');
          throw e;
        }
        await conn.query(`UPDATE family_invite SET accepted_at = UTC_TIMESTAMP(), accepted_account = ? WHERE invite_id = ?`, [g.accountId, inv.invite_id]);
      });
      res.status(204).end();
    } catch (e) { await gate('G28', 'family_invite', null, e).catch(next); }
  });

  // --- 구성원·해제·나가기(G29) ---
  r.get('/v1/family/members', withFamily, async (req, res, next) => {
    try {
      const [rows] = await db.query(`SELECT account_id, role, email FROM guardian_account WHERE family_id = ? ORDER BY role DESC, account_id`, [req.guardian!.familyId]);
      res.json((rows as { account_id: number; role: string; email: string | null }[]).map((m) => ({
        id: String(m.account_id), role: m.role, emailMasked: maskEmail(m.email), isMe: Number(m.account_id) === req.guardian!.accountId })));
    } catch (e) { next(e); }
  });

  r.delete('/v1/family/members/:id', withFamily, async (req, res, next) => {
    const g = req.guardian!;
    const target = Number(req.params.id);
    try {
      if (g.role !== 'owner') throw new Problem('forbidden_role', 'not_family_owner', 'G29');
      await withTx(db, async (conn) => {
        const [u] = await conn.query(`UPDATE guardian_account SET family_id = NULL WHERE account_id = ? AND family_id = ? AND role = 'co'`, [target, g.familyId]);
        if ((u as { affectedRows: number }).affectedRows === 0) throw new Problem('not_found');
        await destroyAllFor(conn, 'guardian', target); // 즉시 접근 불가(FR-9)
      });
      res.status(204).end();
    } catch (e) { await gate('G29', 'guardian_account', target, e).catch(next); }
  });

  r.post('/v1/family/leave', withFamily, async (req, res, next) => {
    const g = req.guardian!;
    try {
      if (g.role === 'owner') throw new Problem('conflict', 'family_owner_cannot_leave', 'G29'); // U20
      await withTx(db, async (conn) => {
        await conn.query(`UPDATE guardian_account SET family_id = NULL WHERE account_id = ?`, [g.accountId]);
        await destroyAllFor(conn, 'guardian', g.accountId);
      });
      res.clearCookie('uam_sid', { path: '/' });
      res.status(204).end();
    } catch (e) { await gate('G29', 'guardian_account', g.accountId, e).catch(next); }
  });

  // --- 가족 없는 계정의 새 가족 공간(U20 P0 기본값) ---
  r.post('/v1/family', anyGuardian, async (req, res, next) => {
    const g = req.guardian!;
    try {
      if (g.familyId !== null) throw new Problem('conflict', 'already_in_family');
      await withTx(db, async (conn) => {
        const [f] = await conn.query(`INSERT INTO family () VALUES ()`);
        await conn.query(`UPDATE guardian_account SET family_id = ?, role = 'owner' WHERE account_id = ? AND family_id IS NULL`,
          [(f as { insertId: number }).insertId, g.accountId]);
      });
      res.status(201).end();
    } catch (e) { next(e); }
  });

  return r;
}
