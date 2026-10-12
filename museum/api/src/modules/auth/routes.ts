// 보호자 인증 7경로 + /v1/me + 팀원 로그인·로그아웃·/v1/ops/me(T046~T050·T146, UC13·UC14, FR-31·32, G26·G27, R-24, D21).
// 가입·재발송·찾기는 가입 여부와 관계없이 항상 202(결정 ④). 토큰 오류는 400 token_invalid 하나(결정 ③).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { Router, type Request, type Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { withTx } from '../../db/pool.js';
import { Problem, isDup, zodFields } from '../../lib/problem.js';
import { guardianAuth } from '../../auth/guards.js';
import { requirePerm } from '../../auth/policy.js';
import { GUARDIAN_COOKIE, IDLE_MINUTES, STAFF_COOKIE, createSession, destroyAllFor, destroySession } from '../../auth/session.js';
import type { Mailer, MailMessage } from '../mail/mailer.js';
import { RateLimiter, normEmail } from './rateLimit.js';
import { issueToken, lockValidToken, useToken } from './tokens.js';
import { lockInvite } from '../family/invites.js';
import { httpKakao, type KakaoClient } from './kakao.js';
import { log } from '../../lib/logger.js';

const email = z.string().trim().max(254).email();
const password = z.string().min(8).max(200); // 규칙 예시 8자 이상 [U19]
const DUMMY_HASH = argon2.hash('timing-equalizer-not-a-password');

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new Problem('validation_failed', 'invalid_fields', undefined, zodFields(r.error));
  }
  return r.data;
}

const withConfirm = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, password, passwordConfirm: z.string() }).strict()
    .refine((v) => v.password === v.passwordConfirm, { path: ['passwordConfirm'], message: 'password_mismatch' });

export function maskEmail(e: string | null): string | null {
  if (!e) return null; // 카카오 계정·링크 초대는 이메일이 없다(D36)
  const [u, d = ''] = e.split('@');
  return `${u.slice(0, 2)}***@${d}`;
}

export function authRouter(db: Pool, cfg: Config, mailer: Mailer, kakao: KakaoClient = httpKakao(cfg.kakao)): Router {
  const r = Router();
  const rl = new RateLimiter(db, cfg.authHmacSecret);
  const link = (path: string, token: string) => `${cfg.appBaseUrl}${path}?token=${encodeURIComponent(token)}`;
  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: cfg.secureCookies, path: '/', maxAge: IDLE_MINUTES * 60 * 1000 };
  const setGuardianCookie = (res: Response, sid: string) => res.cookie(GUARDIAN_COOKIE, sid, cookieOpts);
  const ip = (req: Request) => req.ip ?? 'unknown';

  // --- 카카오 로그인(D36, research R-26, UC13 §0 · UC15 §0) ---
  const KAKAO_COOKIE = 'uam_kakao_state';
  const kakaoCookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: cfg.secureCookies, path: '/v1/auth/kakao', maxAge: 10 * 60 * 1000 };
  const sign = (v: string) => createHmac('sha256', cfg.sessionSecret).update(`kakao-state:${v}`).digest('base64url');
  const packState = (st: { s: string; i?: string; n?: string }) => { const v = Buffer.from(JSON.stringify(st)).toString('base64url'); return `${v}.${sign(v)}`; };
  const unpackState = (raw: unknown): { s: string; i?: string; n?: string } | null => {
    if (typeof raw !== 'string') return null;
    const [v, mac] = raw.split('.');
    if (!v || !mac) return null;
    const a = Buffer.from(sign(v)), b = Buffer.from(mac);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try { return JSON.parse(Buffer.from(v, 'base64url').toString('utf8')); } catch { return null; }
  };

  r.get('/v1/auth/providers', (_req, res) => {
    res.json({ kakao: kakao.configured, emailSignup: cfg.mailEnabled });
  });

  r.get('/v1/auth/kakao/start', (req, res, next) => {
    try {
      if (!kakao.configured) throw new Problem('not_saved', 'kakao_not_configured');
      const invite = typeof req.query.invite === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(req.query.invite) ? req.query.invite : undefined;
      const s = randomBytes(32).toString('base64url');
      // D47: 로그인 전에 연 보호자 앱 주소(이웃 링크 등)로 돌아간다 — 같은 셸 상대 경로만(계약 pattern · 여기서 한 번 더)
      const next = typeof req.query.next === 'string' && /^\/app(\/[^/].*)?$/.test(req.query.next) && !req.query.next.includes('://') ? req.query.next : undefined;
      res.cookie(KAKAO_COOKIE, packState({ s, ...(invite ? { i: invite } : {}), ...(next ? { n: next } : {}) }), kakaoCookieOpts);
      res.redirect(302, kakao.authorizeUrl(s));
    } catch (e) { next(e); }
  });

  r.get('/v1/auth/kakao/callback', async (req, res) => {
    const st = unpackState(req.cookies?.[KAKAO_COOKIE]);
    res.clearCookie(KAKAO_COOKIE, { path: kakaoCookieOpts.path });
    const done = (to: string, event: string, code?: string) => { log.info({ event, code }); res.redirect(302, to); };
    const q = req.query as Record<string, unknown>;
    if (typeof q.error === 'string') return done(q.error === 'access_denied' ? '/app/login?kakao=cancelled' : '/app/login?kakao=failed', 'kakao_cancelled', q.error.slice(0, 40));
    if (!st || typeof q.state !== 'string' || q.state !== st.s || typeof q.code !== 'string') return done('/app/login?kakao=failed', 'kakao_failed', 'state');
    let memberId: string;
    try { memberId = await kakao.memberId(q.code); } catch (e) { return done('/app/login?kakao=failed', 'kakao_failed', (e as Error).message); }
    try {
      const out = await withTx(db, async (conn) => {
        const [rows] = await conn.query(`SELECT account_id, family_id FROM guardian_account WHERE kakao_id = ? FOR UPDATE`, [memberId]);
        const acc = (rows as { account_id: number; family_id: number | null }[])[0];
        if (st.i) {                                        // 초대 링크로 들어옴(UC15 §0) — 새 가족 대신 그 가족의 공동 보호자
          const inv = await lockInvite(conn, st.i);
          if (!inv) return { to: '/app/invite?error=token_invalid', event: 'kakao_invite_invalid' };
          if (acc && acc.family_id !== null) return { to: '/app/invite?error=already_in_family', event: 'kakao_invite_in_family', id: acc.account_id };
          let id = acc?.account_id;
          try {
            if (acc) await conn.query(`UPDATE guardian_account SET family_id = ?, role = 'co' WHERE account_id = ?`, [inv.family_id, id]);
            else id = ((await conn.query(`INSERT INTO guardian_account (family_id, role, kakao_id) VALUES (?, 'co', ?)`, [inv.family_id, memberId]))[0] as { insertId: number }).insertId;
          } catch (e) {
            if (isDup(e, 'uq_guardian_co_family')) return { to: '/app/invite?error=co_guardian_full', event: 'kakao_invite_full' };
            throw e;
          }
          await conn.query(`UPDATE family_invite SET accepted_at = UTC_TIMESTAMP(), accepted_account = ? WHERE invite_id = ?`, [id, inv.invite_id]);
          return { to: '/app/family?joined=1', event: 'kakao_invite_joined', id };
        }
        if (acc) return { to: st.n ?? '/app', event: 'kakao_login', id: acc.account_id }; // D47: 홈 = 아이 미술관(입장 화면은 웹이 탭 세션마다 한 번)
        const [f] = await conn.query(`INSERT INTO family () VALUES ()`);    // 첫 로그인: 가족 공간 + 만든 보호자(UC13 §0 5, E4 한 트랜잭션)
        const [g] = await conn.query(`INSERT INTO guardian_account (family_id, role, kakao_id) VALUES (?, 'owner', ?)`, [(f as { insertId: number }).insertId, memberId]);
        return { to: st.n ? `/app/children/new?welcome=1&next=${encodeURIComponent(st.n)}` : '/app/children/new?welcome=1', event: 'kakao_signup', // 첫 가입은 캐릭터 먼저, 개관 뒤 next(§17-16)
           id: (g as { insertId: number }).insertId }; // D47: 흰 표 대신 캐릭터 만들기
      });
      if (out.id) setGuardianCookie(res, await createSession(db, 'guardian', out.id));
      return done(out.to, out.event);
    } catch (e) {
      if (isDup(e, 'uq_guardian_kakao')) return done('/app/login?kakao=failed', 'kakao_failed', 'race'); // 동시 첫 로그인 — 다시 누르면 로그인된다
      return done('/app/login?kakao=failed', 'kakao_failed', 'db');
    }
  });

  // --- 가입(G26) ---
  r.post('/v1/auth/signup', async (req, res, next) => {
    try {
      const b = parse(withConfirm({ email, inviteToken: z.string().min(10).max(200).optional() }), req.body);
      const em = normEmail(b.email);
      if (b.inviteToken) return void (await inviteSignup(b.email, b.password, b.inviteToken, res));
      if (!(await rl.take('signup', { email: em, ip: ip(req) }))) return void res.status(202).end();
      const hash = await argon2.hash(b.password, { type: argon2.argon2id });
      let mail: MailMessage;
      try {
        mail = await withTx(db, async (conn) => {
          const [ex] = await conn.query(`SELECT account_id FROM guardian_account WHERE email_norm = ?`, [em]);
          if ((ex as unknown[]).length) return { kind: 'already_registered', to: em } as MailMessage;
          const [f] = await conn.query(`INSERT INTO family () VALUES ()`);
          const familyId = (f as { insertId: number }).insertId;
          const [g] = await conn.query(
            `INSERT INTO guardian_account (family_id, email, password_hash, role) VALUES (?, ?, ?, 'owner')`,
            [familyId, b.email.trim(), hash],
          );
          const token = await issueToken(conn, (g as { insertId: number }).insertId, 'verify');
          return { kind: 'verify', to: em, link: link('/app/verify', token) } as MailMessage;
        });
      } catch (e) {
        if (!isDup(e, 'uq_guardian_email')) throw new Problem('not_saved', 'signup_failed');
        mail = { kind: 'already_registered', to: em }; // 동시 가입 경쟁(UC13 E4)은 E1과 같게
      }
      mailer.send(mail);
      res.status(202).end();
    } catch (e) { next(e); }
  });

  /** UC13 A4: 초대 링크 가입 — 새 가족 없이 공동 보호자로 합류, 초대 메일 수신이 주소 확인을 겸한다(확인 메일 없음). */
  async function inviteSignup(rawEmail: string, pw: string, token: string, res: Response) {
    const em = normEmail(rawEmail);
    const hash = await argon2.hash(pw, { type: argon2.argon2id });
    let mail: MailMessage | null = null;
    try {
      await withTx(db, async (conn) => {
        const inv = await lockInvite(conn, token);
        if (!inv) throw new Problem('token_invalid', 'token_invalid', 'G28');
        if (inv.email_norm !== em) throw new Problem('forbidden_role', 'invite_email_mismatch', 'G28');
        const [ex] = await conn.query(`SELECT account_id FROM guardian_account WHERE email_norm = ?`, [em]);
        if ((ex as unknown[]).length) { mail = { kind: 'already_registered', to: em }; return; } // E1과 같게, 초대는 쓰지 않음
        const [g] = await conn.query(
          `INSERT INTO guardian_account (family_id, email, password_hash, role, email_verified_at) VALUES (?, ?, ?, 'co', UTC_TIMESTAMP())`,
          [inv.family_id, rawEmail.trim(), hash]);
        await conn.query(`UPDATE family_invite SET accepted_at = UTC_TIMESTAMP(), accepted_account = ? WHERE invite_id = ?`,
          [(g as { insertId: number }).insertId, inv.invite_id]);
      });
    } catch (e) {
      if (e instanceof Problem) throw e;
      if (isDup(e, 'uq_guardian_co_family')) throw new Problem('conflict', 'co_guardian_full', 'G28');
      if (isDup(e, 'uq_guardian_email')) mail = { kind: 'already_registered', to: em };
      else throw new Problem('not_saved', 'signup_failed');
    }
    if (mail) mailer.send(mail);
    res.status(202).end();
  }

  // --- 이메일 확인(G27) — 성공하면 세션 발급(UC13 BF5) ---
  r.post('/v1/auth/email/verify', async (req, res, next) => {
    try {
      const { token } = parse(z.object({ token: z.string() }).strict(), req.body); // 형식이 어긋난 토큰도 무효와 같게 400(G27, 계약 TokenInvalid — 구분하지 않음)
      const accountId = await withTx(db, async (conn) => {
        const t = await lockValidToken(conn, token, 'verify');
        if (!t) throw new Problem('token_invalid', 'token_invalid', 'G27');
        await useToken(conn, t.tokenId);
        await conn.query(`UPDATE guardian_account SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE account_id = ?`, [t.accountId]);
        return t.accountId;
      });
      setGuardianCookie(res, await createSession(db, 'guardian', accountId));
      res.status(204).end();
    } catch (e) { next(e); }
  });

  r.post('/v1/auth/email/verify/resend', async (req, res, next) => {
    try {
      const { email: e } = parse(z.object({ email }).strict(), req.body);
      const em = normEmail(e);
      if (await rl.take('resend', { email: em, ip: ip(req) })) {
        const mail = await withTx(db, async (conn) => {
          const [rows] = await conn.query(`SELECT account_id FROM guardian_account WHERE email_norm = ? AND email_verified_at IS NULL`, [em]);
          const a = (rows as { account_id: number }[])[0];
          if (!a) return null;
          return { kind: 'verify', to: em, link: link('/app/verify', await issueToken(conn, a.account_id, 'verify')) } as MailMessage;
        });
        if (mail) mailer.send(mail);
      }
      res.status(202).end();
    } catch (e) { next(e); }
  });

  // --- 로그인 ---
  r.post('/v1/auth/login', async (req, res, next) => {
    try {
      const b = parse(z.object({ email, password: z.string().min(1).max(200) }).strict(), req.body);
      const em = normEmail(b.email);
      if (await rl.exceeded('login', { email: em })) throw new Problem('rate_limited', 'login_attempts');
      const [rows] = await db.query(`SELECT account_id, password_hash, email_verified_at FROM guardian_account WHERE email_norm = ?`, [em]);
      const a = (rows as { account_id: number; password_hash: string; email_verified_at: Date | null }[])[0];
      const ok = await argon2.verify(a?.password_hash ?? (await DUMMY_HASH), b.password).catch(() => false);
      if (!a || !ok) {
        await rl.record('login', { email: em });
        throw new Problem('unauthorized', 'bad_credentials');
      }
      if (!a.email_verified_at) throw new Problem('email_unverified', 'email_unverified');
      setGuardianCookie(res, await createSession(db, 'guardian', a.account_id));
      res.status(204).end();
    } catch (e) { next(e); }
  });

  r.post('/v1/auth/logout', guardianAuth(db, { requireFamily: false }), async (req, res, next) => {
    try {
      await destroySession(db, req.sid);
      res.clearCookie(GUARDIAN_COOKIE, { path: '/' });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // --- 로그인 정보 찾기·재설정(UC14) ---
  r.post('/v1/auth/recovery', async (req, res, next) => {
    try {
      const { email: e } = parse(z.object({ email }).strict(), req.body);
      const em = normEmail(e);
      if (await rl.take('recovery', { email: em, ip: ip(req) })) {
        const mail = await withTx(db, async (conn) => {
          const [rows] = await conn.query(`SELECT account_id, email_verified_at FROM guardian_account WHERE email_norm = ?`, [em]);
          const a = (rows as { account_id: number; email_verified_at: Date | null }[])[0];
          if (!a) return null; // UC14 A1: 메일 없음, 응답 같음
          if (!a.email_verified_at) return { kind: 'verify', to: em, link: link('/app/verify', await issueToken(conn, a.account_id, 'verify')) } as MailMessage; // A2
          return { kind: 'recovery', to: em, link: link('/app/reset', await issueToken(conn, a.account_id, 'reset')) } as MailMessage;
        });
        if (mail) mailer.send(mail);
      }
      res.status(202).end();
    } catch (e) { next(e); }
  });

  r.post('/v1/auth/recovery/reset', async (req, res, next) => {
    try {
      // 규칙 위반은 토큰을 쓰기 전에 거절한다(UC14 E3)
      const b = parse(withConfirm({ token: z.string() }), req.body); // 토큰 형식은 검사하지 않는다 — 무효면 400 token_invalid(G27)
      const hash = await argon2.hash(b.password, { type: argon2.argon2id });
      try {
        await withTx(db, async (conn) => {
          const t = await lockValidToken(conn, b.token, 'reset');
          if (!t) throw new Problem('token_invalid', 'token_invalid', 'G27');
          await useToken(conn, t.tokenId);
          await conn.query(`UPDATE guardian_account SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(3) WHERE account_id = ?`, [hash, t.accountId]);
          await destroyAllFor(conn, 'guardian', t.accountId); // 결정 ⑥: 현재 세션 포함 모두
        });
      } catch (e) {
        if (e instanceof Problem) throw e;
        throw new Problem('not_saved', 'reset_failed');
      }
      res.clearCookie(GUARDIAN_COOKIE, { path: '/' });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // --- 로그인 상태 비밀번호 변경(UC14 A5, D24 ④) ---
  // 현재 비밀번호 확인 → 재설정과 같은 규칙 → password_changed_at 갱신 + 세션 전부 삭제(다른 기기 끊김) → 이 기기에 새 세션.
  // 현재 비밀번호 틀림은 422(401이면 화면이 로그아웃으로 오인), 로그인 실패와 같은 한도를 센다.
  r.post('/v1/auth/password', guardianAuth(db, { requireFamily: false }), async (req, res, next) => {
    try {
      const b = parse(withConfirm({ currentPassword: z.string().min(1).max(200) }), req.body);
      const g = req.guardian!;
      if (!g.email) throw new Problem('conflict', 'no_password'); // 카카오 계정은 비밀번호가 없다(D36)
      const em = normEmail(g.email);
      if (await rl.exceeded('login', { email: em })) throw new Problem('rate_limited', 'login_attempts');
      const [rows] = await db.query(`SELECT password_hash FROM guardian_account WHERE account_id = ?`, [g.accountId]);
      const cur = (rows as { password_hash: string }[])[0];
      const ok = cur ? await argon2.verify(cur.password_hash, b.currentPassword).catch(() => false) : false;
      if (!ok) {
        await rl.record('login', { email: em });
        throw new Problem('validation_failed', 'current_password_mismatch', undefined,
          [{ name: 'currentPassword', reason: 'current_password_mismatch' }]);
      }
      const hash = await argon2.hash(b.password, { type: argon2.argon2id });
      let sid: string;
      try {
        await withTx(db, async (conn) => {
          await conn.query(`UPDATE guardian_account SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(3) WHERE account_id = ?`, [hash, g.accountId]);
          await destroyAllFor(conn, 'guardian', g.accountId); // 다른 기기 세션 끊기(이 기기 포함 지우고 아래에서 새로 발급)
        });
        sid = await createSession(db, 'guardian', g.accountId);
      } catch {
        throw new Problem('not_saved', 'password_change_failed');
      }
      setGuardianCookie(res, sid);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // --- 로그인한 보호자 상태(U20, /v1/me) ---
  r.get('/v1/me', guardianAuth(db, { requireFamily: false }), (req, res) => {
    const g = req.guardian!;
    res.json({ emailMasked: maskEmail(g.email), loginMethod: g.email ? 'email' : 'kakao', hasFamily: g.familyId !== null, role: g.familyId === null ? null : g.role });
  });

  // --- 팀원 로그인(INC2, G1) ---
  r.post('/v1/ops/auth/login', async (req, res, next) => {
    try {
      const b = parse(z.object({ email, password: z.string().min(1).max(200) }).strict(), req.body);
      const [rows] = await db.query(
        `SELECT m.member_id, m.password_hash, GROUP_CONCAT(r.role) roles FROM team_member m
           LEFT JOIN team_member_role r ON r.member_id = m.member_id
          WHERE m.email = ? AND m.disabled_at IS NULL GROUP BY m.member_id, m.password_hash`,
        [b.email.trim()],
      );
      const m = (rows as { member_id: number; password_hash: string; roles: string | null }[])[0];
      const ok = await argon2.verify(m?.password_hash ?? (await DUMMY_HASH), b.password).catch(() => false);
      if (!m || !ok) throw new Problem('unauthorized', 'bad_credentials', 'G1');
      res.cookie(STAFF_COOKIE, await createSession(db, 'staff', m.member_id), cookieOpts);
      res.json({ roles: (m.roles ?? '').split(',').filter(Boolean) });
    } catch (e) { next(e); }
  });

  // --- 팀원 로그아웃·상태(T146, D21 — 운영 셸 C9가 새로고침 뒤 역할을 되살린다) ---
  r.post('/v1/ops/auth/logout', async (req, res, next) => {
    try {
      await destroySession(db, req.cookies?.[STAFF_COOKIE]);
      res.clearCookie(STAFF_COOKIE, { path: '/' });
      res.status(204).end(); // 세션이 없어도 204
    } catch (e) { next(e); }
  });

  r.get('/v1/ops/me', requirePerm(db, 'staff.me'), async (req, res, next) => {
    try {
      const [rows] = await db.query(`SELECT email FROM team_member WHERE member_id = ?`, [req.staff!.memberId]);
      res.json({ emailMasked: maskEmail((rows as { email: string }[])[0].email), roles: req.staff!.roles });
    } catch (e) { next(e); }
  });

  return r;
}
