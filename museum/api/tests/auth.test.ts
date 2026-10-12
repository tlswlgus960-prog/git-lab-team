// US1 인증 시험(T041 계약·T042 규칙): FR-31·32, UC13·UC14, G26·G27, BR-ACC-06~08, 결정 ③④⑥.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp, tokenOf } from './helpers/app.js';

const t = testApp();
const agent = () => request.agent(t.app);
const PW = 'correct-horse-1';
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; });

async function signupAndVerify(email = 'Parent@Test.local') {
  await request(t.app).post('/v1/auth/signup').send({ email, password: PW, passwordConfirm: PW }).expect(202);
  const a = agent();
  await a.post('/v1/auth/email/verify').send({ token: tokenOf(t.mailer.sent.at(-1)!.link) }).expect(204);
  return a;
}

describe('가입·확인(UC13, G26·G27)', () => {
  it('가입은 202, 확인 메일, 가족 공간과 만든 보호자 생성, 확인하면 세션 발급(BF5)', async () => {
    const a = await signupAndVerify();
    expect(t.mailer.sent[0].kind).toBe('verify');
    const me = await a.get('/v1/me').expect(200);
    expect(me.body).toEqual({ emailMasked: 'Pa***@Test.local', loginMethod: 'email', hasFamily: true, role: 'owner' });
    const [rows] = await t.db.query('SELECT COUNT(*) n FROM family');
    expect(Number((rows as { n: number }[])[0].n)).toBe(1);
  });
  it('이미 가입된 이메일(대소문자 무시)은 같은 202, 계정을 만들지 않고 안내 메일만(E1·결정 ④)', async () => {
    await signupAndVerify('parent@test.local');
    const r = await request(t.app).post('/v1/auth/signup').send({ email: 'PARENT@test.local', password: PW, passwordConfirm: PW });
    expect(r.status).toBe(202);
    expect(t.mailer.sent.at(-1)!.kind).toBe('already_registered');
    const [rows] = await t.db.query('SELECT COUNT(*) n FROM guardian_account');
    expect(Number((rows as { n: number }[])[0].n)).toBe(1);
  });
  it('형식·규칙·확인 불일치는 422(E2·E3)', async () => {
    const r = await request(t.app).post('/v1/auth/signup').send({ email: 'x', password: 'short', passwordConfirm: 'other' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('validation_failed');
  });
  it('형식이 어긋난 토큰(짧음·빈 값)도 422가 아니라 400 token_invalid — 무효 사유를 구분하지 않음(G27)', async () => {
    for (const token of ['', 'abc', 'x'.repeat(300)]) {
      const v = await request(t.app).post('/v1/auth/email/verify').send({ token });
      expect([v.status, v.body.code]).toEqual([400, 'token_invalid']);
      const r = await request(t.app).post('/v1/auth/recovery/reset').send({ token, password: PW, passwordConfirm: PW });
      expect([r.status, r.body.code]).toEqual([400, 'token_invalid']);
    }
  });
  it('확인 토큰은 1회용 — 재사용·재발급된 이전 토큰은 400 token_invalid(E7)', async () => {
    await request(t.app).post('/v1/auth/signup').send({ email: 'p@test.local', password: PW, passwordConfirm: PW }).expect(202);
    const old = tokenOf(t.mailer.sent.at(-1)!.link);
    await request(t.app).post('/v1/auth/email/verify/resend').send({ email: 'p@test.local' }).expect(202);
    const fresh = tokenOf(t.mailer.sent.at(-1)!.link);
    expect((await request(t.app).post('/v1/auth/email/verify').send({ token: old })).body.code).toBe('token_invalid');
    await request(t.app).post('/v1/auth/email/verify').send({ token: fresh }).expect(204);
    expect((await request(t.app).post('/v1/auth/email/verify').send({ token: fresh })).status).toBe(400);
  });
  it('가입 요청 한도(같은 이메일 10분 3회): 넘으면 메일 없이 같은 202(E8)', async () => {
    for (let i = 0; i < 4; i++) await request(t.app).post('/v1/auth/signup').send({ email: 'r@test.local', password: PW, passwordConfirm: PW }).expect(202);
    expect(t.mailer.sent.length).toBe(3);
  });
});

describe('로그인·로그아웃', () => {
  it('확인 전 계정은 비밀번호가 맞으면 403 email_unverified, 틀리면 401', async () => {
    await request(t.app).post('/v1/auth/signup').send({ email: 'u@test.local', password: PW, passwordConfirm: PW }).expect(202);
    expect((await request(t.app).post('/v1/auth/login').send({ email: 'u@test.local', password: PW })).body.code).toBe('email_unverified');
    expect((await request(t.app).post('/v1/auth/login').send({ email: 'u@test.local', password: 'wrong-pass' })).status).toBe(401);
    expect((await request(t.app).post('/v1/auth/login').send({ email: 'nobody@test.local', password: PW })).status).toBe(401);
  });
  it('로그인 204 → 로그아웃 204 → 세션 무효 401', async () => {
    await signupAndVerify('l@test.local');
    const a = agent();
    await a.post('/v1/auth/login').send({ email: 'l@test.local', password: PW }).expect(204);
    await a.get('/v1/me').expect(200);
    await a.post('/v1/auth/logout').expect(204);
    await a.get('/v1/me').expect(401);
  });
  it('로그인 실패 한도(같은 이메일 15분 10회) 뒤 429', async () => {
    await signupAndVerify('z@test.local');
    for (let i = 0; i < 10; i++) await request(t.app).post('/v1/auth/login').send({ email: 'z@test.local', password: 'wrong-pass' }).expect(401);
    expect((await request(t.app).post('/v1/auth/login').send({ email: 'z@test.local', password: PW })).status).toBe(429);
  });
});

describe('로그인 정보 찾기·재설정(UC14)', () => {
  it('가입 여부와 관계없이 202, 없는 이메일은 메일 없음(A1)', async () => {
    await request(t.app).post('/v1/auth/recovery').send({ email: 'ghost@test.local' }).expect(202);
    expect(t.mailer.sent.length).toBe(0);
  });
  it('확인 전 계정은 재설정 대신 확인 메일(A2)', async () => {
    await request(t.app).post('/v1/auth/signup').send({ email: 'v@test.local', password: PW, passwordConfirm: PW }).expect(202);
    await request(t.app).post('/v1/auth/recovery').send({ email: 'v@test.local' }).expect(202);
    expect(t.mailer.sent.at(-1)!.kind).toBe('verify');
  });
  it('재설정하면 현재 세션 포함 모든 세션 무효(결정 ⑥), 새 비밀번호로 로그인, 규칙 위반은 422이고 토큰 유지(E3)', async () => {
    const a1 = await signupAndVerify('s@test.local');
    const a2 = agent();
    await a2.post('/v1/auth/login').send({ email: 's@test.local', password: PW }).expect(204);
    await request(t.app).post('/v1/auth/recovery').send({ email: 's@test.local' }).expect(202);
    const m = t.mailer.sent.at(-1)!;
    expect(m.kind).toBe('recovery');
    const tok = tokenOf(m.link);
    expect((await request(t.app).post('/v1/auth/recovery/reset').send({ token: tok, password: 'short', passwordConfirm: 'short' })).status).toBe(422);
    await request(t.app).post('/v1/auth/recovery/reset').send({ token: tok, password: 'new-password-2', passwordConfirm: 'new-password-2' }).expect(204);
    await a1.get('/v1/me').expect(401);
    await a2.get('/v1/me').expect(401);
    await request(t.app).post('/v1/auth/login').send({ email: 's@test.local', password: 'new-password-2' }).expect(204);
    expect((await request(t.app).post('/v1/auth/recovery/reset').send({ token: tok, password: 'another-pass-3', passwordConfirm: 'another-pass-3' })).body.code).toBe('token_invalid');
  });
});

describe('개인정보 보호(BR-PRV-01, BR-ACC-07)', () => {
  it('DB에 토큰·세션 원문이 없고 비밀번호는 argon2id 해시', async () => {
    await signupAndVerify('h@test.local');
    const tok = tokenOf(t.mailer.sent[0].link);
    const [tk] = await t.db.query('SELECT token_hash FROM auth_email_token');
    expect((tk as { token_hash: string }[]).every((r) => r.token_hash !== tok && r.token_hash.length === 64)).toBe(true);
    const [g] = await t.db.query('SELECT password_hash FROM guardian_account');
    expect((g as { password_hash: string }[])[0].password_hash.startsWith('$argon2id$')).toBe(true);
    const [ev] = await t.db.query('SELECT subject_hash FROM auth_rate_event');
    expect((ev as { subject_hash: string }[]).every((r) => !r.subject_hash.includes('@'))).toBe(true);
  });
});
