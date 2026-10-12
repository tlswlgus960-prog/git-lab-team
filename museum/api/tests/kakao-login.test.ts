// 카카오 로그인(D36, research R-26, UC13 §0 · UC15 §0, 계약 /v1/auth/kakao/*): 받는 값은 회원번호뿐, 첫 로그인은 가족 공간 + 만든 보호자,
// 취소·state 위조·카카오 실패는 계정을 만들지 않고 로그인 화면으로, 초대 링크는 한 번만.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.kakao.configured = true; });
const q = async <T>(sql: string, p: unknown[] = []) => (await t.db.query(sql, p))[0] as T[];

/** 브라우저처럼: start → (카카오) → callback. 반환: agent와 마지막 이동 위치 */
async function kakaoLogin(memberCode: string, invite?: string, a = request.agent(t.app)) {
  const s = await a.get(`/v1/auth/kakao/start${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`).expect(302);
  const state = new URL(s.headers.location).searchParams.get('state')!;
  const cb = await a.get(`/v1/auth/kakao/callback?code=${memberCode}&state=${encodeURIComponent(state)}`).expect(302);
  return { a, to: cb.headers.location as string };
}

describe('카카오 로그인 — 가입·로그인', () => {
  it('설정 여부를 알리고, 키가 없으면 시작이 503 kakao_not_configured', async () => {
    expect((await request(t.app).get('/v1/auth/providers').expect(200)).body).toMatchObject({ kakao: true });
    t.kakao.configured = false;
    expect((await request(t.app).get('/v1/auth/providers')).body.kakao).toBe(false);
    expect((await request(t.app).get('/v1/auth/kakao/start').expect(503)).body.reason).toBe('kakao_not_configured');
  });
  it('첫 로그인: 가족 공간 + 만든 보호자, 이메일·비밀번호 없이 회원번호만 저장 → 아이 등록으로', async () => {
    const { a, to } = await kakaoLogin('1001');
    expect(to).toBe('/app/children/new?welcome=1');
    expect((await a.get('/v1/me').expect(200)).body).toEqual({ emailMasked: null, loginMethod: 'kakao', hasFamily: true, role: 'owner' });
    expect(await q(`SELECT email, password_hash, kakao_id, role, family_id IS NOT NULL fam FROM guardian_account`))
      .toEqual([{ email: null, password_hash: null, kakao_id: '1001', role: 'owner', fam: 1 }]);
  });
  it('다시 로그인: 같은 계정, 새 계정·가족을 만들지 않고 마지막 전시실로', async () => {
    await kakaoLogin('1002');
    const { to } = await kakaoLogin('1002');
    expect(to).toBe('/app');
    expect((await q<{ n: number }>(`SELECT COUNT(*) n FROM guardian_account`))[0].n).toBe(1);
    expect((await q<{ n: number }>(`SELECT COUNT(*) n FROM family`))[0].n).toBe(1);
  });
  it('D47: 로그인 전에 연 주소(next)로 돌아간다 — 첫 가입 · 다시 로그인 모두, 밖 주소는 버린다', async () => {
    const go = async (code: string, next: string) => {
      const a = request.agent(t.app);
      const s = await a.get(`/v1/auth/kakao/start?next=${encodeURIComponent(next)}`);
      if (s.status !== 302) return { to: `status ${s.status}` };
      const state = new URL(s.headers.location).searchParams.get('state')!;
      return { to: (await a.get(`/v1/auth/kakao/callback?code=${code}&state=${encodeURIComponent(state)}`).expect(302)).headers.location as string };
    };
    // 첫 가입은 캐릭터 만들기가 먼저, 개관 뒤 next로(§17-16) · 다시 로그인은 곧바로 next
    expect((await go('1101', '/app/neighbor?token=abcdefghijklmnop')).to).toBe(`/app/children/new?welcome=1&next=${encodeURIComponent('/app/neighbor?token=abcdefghijklmnop')}`);
    expect((await go('1101', '/app/museum/7')).to).toBe('/app/museum/7');
    expect((await go('1102', '//evil.example/app')).to).toBe('status 422'); // 계약 pattern — 밖 주소는 받지 않는다
  });
  it('카카오에서 취소하면 계정 없이 로그인 화면(cancelled)', async () => {
    const a = request.agent(t.app);
    await a.get('/v1/auth/kakao/start').expect(302);
    const cb = await a.get('/v1/auth/kakao/callback?error=access_denied&error_description=User%20denied').expect(302);
    expect(cb.headers.location).toBe('/app/login?kakao=cancelled');
    expect((await q<{ n: number }>(`SELECT COUNT(*) n FROM guardian_account`))[0].n).toBe(0);
  });
  it('state 위조·쿠키 없음·카카오 실패는 계정 없이 failed', async () => {
    const a = request.agent(t.app);
    await a.get('/v1/auth/kakao/start').expect(302);
    expect((await a.get('/v1/auth/kakao/callback?code=1003&state=forged').expect(302)).headers.location).toBe('/app/login?kakao=failed');
    expect((await request(t.app).get('/v1/auth/kakao/callback?code=1003&state=x').expect(302)).headers.location).toBe('/app/login?kakao=failed');
    expect((await kakaoLogin('fail')).to).toBe('/app/login?kakao=failed');
    expect((await q<{ n: number }>(`SELECT COUNT(*) n FROM guardian_account`))[0].n).toBe(0);
  });
  it('카카오 계정은 비밀번호 변경이 없다(409 no_password)', async () => {
    const { a } = await kakaoLogin('1004');
    expect((await a.post('/v1/auth/password').send({ currentPassword: 'x', password: 'new-horse-12', passwordConfirm: 'new-horse-12' })).body.reason).toBe('no_password');
  });
});

describe('초대 링크 복사(UC15 §0)', () => {
  it('만든 보호자가 링크를 만들고, 받은 사람이 카카오로 들어오면 공동 보호자 — 링크는 한 번만', async () => {
    const owner = (await kakaoLogin('2001')).a;
    const inv = await owner.post('/v1/family/invites').send({}).expect(201);
    expect(inv.body).toMatchObject({ id: expect.any(String), link: expect.stringContaining('/app/invite?token='), expiresAt: expect.any(String) });
    const token = new URL(inv.body.link).searchParams.get('token')!;
    expect((await owner.get('/v1/family/invites').expect(200)).body).toEqual([{ id: inv.body.id, emailMasked: null, expiresAt: inv.body.expiresAt }]);
    const { a: co, to } = await kakaoLogin('2002', token);
    expect(to).toBe('/app/family?joined=1');
    expect((await co.get('/v1/me')).body).toMatchObject({ hasFamily: true, role: 'co' });
    expect((await owner.get('/v1/family/members')).body).toHaveLength(2);
    expect((await kakaoLogin('2003', token)).to).toBe('/app/invite?error=token_invalid');   // 한 번만
    expect((await q<{ n: number }>(`SELECT COUNT(*) n FROM guardian_account WHERE kakao_id = '2003'`))[0].n).toBe(0);
  });
  it('이미 다른 가족이 있는 카카오 계정은 받지 않는다(already_in_family), 취소한 링크는 무효', async () => {
    const owner = (await kakaoLogin('3001')).a;
    await kakaoLogin('3002');                                   // 자기 가족이 있는 사람
    const t1 = new URL((await owner.post('/v1/family/invites').send({}).expect(201)).body.link).searchParams.get('token')!;
    expect((await kakaoLogin('3002', t1)).to).toBe('/app/invite?error=already_in_family');
    const inv2 = (await owner.post('/v1/family/invites').send({}).expect(201)).body;   // 새 링크 → 이전 링크 무효(대기 1건)
    expect((await kakaoLogin('3003', t1)).to).toBe('/app/invite?error=token_invalid');
    await owner.delete(`/v1/family/invites/${inv2.id}`).expect(204);
    expect((await kakaoLogin('3003', new URL(inv2.link).searchParams.get('token')!)).to).toBe('/app/invite?error=token_invalid');
  });
  it('공동 보호자는 링크를 만들 수 없다(403 invite_owner_only)', async () => {
    const owner = (await kakaoLogin('4001')).a;
    const token = new URL((await owner.post('/v1/family/invites').send({}).expect(201)).body.link).searchParams.get('token')!;
    const co = (await kakaoLogin('4002', token)).a;
    expect((await co.post('/v1/family/invites').send({})).body.reason).toBe('invite_owner_only');
  });
});
