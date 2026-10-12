// US6 공동 보호자 시험(T102): UC15, UC13 A4, FR-9, G28·G29, BR-ACC-09, 1c460b0(부모 두 명·초대는 만든 보호자만), U20.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp, tokenOf } from './helpers/app.js';
import { PW, familyWithChild, png, seedModels, simulateResult, upload } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });
const q = async <T>(sql: string, p: unknown[] = []) => (await t.db.query(sql, p))[0] as T[];
const lastInviteToken = () => tokenOf(t.mailer.sent.filter((m) => m.kind === 'invite').at(-1)!.link);

async function login(email: string) {
  const a = request.agent(t.app);
  await a.post('/v1/auth/login').send({ email, password: PW }).expect(204);
  return a;
}

describe('초대·수락(G28·G29)', () => {
  it('만든 보호자가 초대 → 초대 링크로 가입(새 가족 없음·확인 메일 없음) → 공동 보호자는 같은 권한', async () => {
    const owner = await familyWithChild(t, 'owner@test.local');
    await owner.a.post('/v1/family/invites').send({ email: 'Co@Test.local' }).expect(202);
    const inv = await owner.a.get('/v1/family/invites').expect(200);
    expect(inv.body).toHaveLength(1);
    expect(inv.body[0].emailMasked).toBe('Co***@Test.local');
    // 가입 화면 미리 채움: 로그인 없이 토큰으로 초대 이메일(원문), 토큰은 쓰지 않는다. 무효 토큰은 400 token_invalid(G28)
    expect((await request(t.app).get('/v1/family/invites/lookup').query({ token: lastInviteToken() }).expect(200)).body).toEqual({ email: 'Co@Test.local' });
    expect((await request(t.app).get('/v1/family/invites/lookup').query({ token: 'nope-nope-nope' }).expect(400)).body).toMatchObject({ code: 'token_invalid', gate: 'G28' });
    // 토큰 없음은 경로·쿼리 입력 공통 오류(계약 머리말, 2026-09-30) — 틀린 토큰만 400 token_invalid
    expect((await request(t.app).get('/v1/family/invites/lookup')).body).toMatchObject({ status: 422, reason: 'invalid_param', fields: [{ name: 'token', reason: 'required' }] });
    await request(t.app).post('/v1/auth/signup').send({ email: 'co@test.local', password: PW, passwordConfirm: PW, inviteToken: lastInviteToken() }).expect(202);
    expect(t.mailer.sent.filter((m) => m.kind === 'verify').length).toBe(1); // 만든 보호자 것만
    expect(await q('SELECT COUNT(*) n FROM family')).toEqual([{ n: 1 }]);
    const co = await login('co@test.local');
    expect((await co.get('/v1/me')).body).toMatchObject({ hasFamily: true, role: 'co' });
    const c = await co.get('/v1/children').expect(200);
    expect(c.body).toHaveLength(1);
    const r = await upload(co, owner.childId, await png()).expect(202); // 같은 권한
    await co.post(`/v1/artworks/${r.body.id}/confirm`).send({ kind: 'frame' }).expect(200);
    expect((await owner.a.get('/v1/family/members')).body.map((m: { role: string }) => m.role)).toEqual(['owner', 'co']);
  });
  it('공동 보호자는 초대 403, 두 명 찬 뒤 초대 409 co_guardian_full(E9)', async () => {
    const owner = await familyWithChild(t, 'o2@test.local');
    await owner.a.post('/v1/family/invites').send({ email: 'c2@test.local' }).expect(202);
    await request(t.app).post('/v1/auth/signup').send({ email: 'c2@test.local', password: PW, passwordConfirm: PW, inviteToken: lastInviteToken() }).expect(202);
    const co = await login('c2@test.local');
    expect((await co.post('/v1/family/invites').send({ email: 'x@test.local' })).body).toMatchObject({ code: 'forbidden_role', reason: 'invite_owner_only' });
    expect((await owner.a.post('/v1/family/invites').send({ email: 'y@test.local' })).body).toMatchObject({ code: 'conflict', reason: 'co_guardian_full' });
    expect((await q(`SELECT gate_id FROM gate_event WHERE gate_id = 'G29'`)).length).toBeGreaterThanOrEqual(2);
  });
  it('새로 초대하면 이전 초대는 무효(대기 1건), 초대 취소 204', async () => {
    const owner = await familyWithChild(t, 'o3@test.local');
    await owner.a.post('/v1/family/invites').send({ email: 'a@test.local' }).expect(202);
    const first = lastInviteToken();
    await owner.a.post('/v1/family/invites').send({ email: 'b@test.local' }).expect(202);
    expect((await owner.a.get('/v1/family/invites')).body).toHaveLength(1);
    expect((await request(t.app).post('/v1/auth/signup').send({ email: 'a@test.local', password: PW, passwordConfirm: PW, inviteToken: first })).body.code).toBe('token_invalid');
    const id = (await owner.a.get('/v1/family/invites')).body[0].id;
    await owner.a.delete(`/v1/family/invites/${id}`).expect(204);
    expect((await owner.a.get('/v1/family/invites')).body).toHaveLength(0);
  });
  it('기존 계정 수락: 이메일 다르면 403 invite_email_mismatch, 다른 가족 소속이면 409 already_in_family', async () => {
    const owner = await familyWithChild(t, 'o4@test.local');
    await familyWithChild(t, 'other@test.local');
    await owner.a.post('/v1/family/invites').send({ email: 'other@test.local' }).expect(202);
    const tok = lastInviteToken();
    const wrong = await login('o4@test.local');
    expect((await wrong.post('/v1/family/invites/accept').send({ token: tok })).body.reason).toBe('invite_email_mismatch');
    const other = await login('other@test.local');
    expect((await other.post('/v1/family/invites/accept').send({ token: tok })).body.reason).toBe('already_in_family');
    expect((await other.post('/v1/family/invites/accept').send({ token: 'x'.repeat(40) })).body.code).toBe('token_invalid');
  });
});

describe('해제·나가기(G29)·가족 없음(U20)', () => {
  async function pair(tag: string) {
    const owner = await familyWithChild(t, `own-${tag}@test.local`);
    await owner.a.post('/v1/family/invites').send({ email: `co-${tag}@test.local` }).expect(202);
    await request(t.app).post('/v1/auth/signup').send({ email: `co-${tag}@test.local`, password: PW, passwordConfirm: PW, inviteToken: lastInviteToken() }).expect(202);
    const co = await login(`co-${tag}@test.local`);
    const coId = (await owner.a.get('/v1/family/members')).body.find((m: { role: string }) => m.role === 'co').id;
    return { owner, co, coId };
  }
  it('만든 보호자가 해제 → 그 계정 세션 즉시 무효·가족 경로 불가, 올린 작품은 남음', async () => {
    const { owner, co, coId } = await pair('r');
    const r = await upload(co, owner.childId, await png()).expect(202);
    expect((await co.delete(`/v1/family/members/${coId}`)).body.reason).toBe('not_family_owner');
    await owner.a.delete(`/v1/family/members/${coId}`).expect(204);
    expect((await co.get('/v1/children')).status).toBe(401);
    await owner.a.get(`/v1/artworks/${r.body.id}`).expect(200);
  });
  it('공동 보호자는 나가기 204(세션 끊김), 만든 보호자 나가기 409, 가족 없는 계정은 새 가족 만들기(U20)', async () => {
    const { owner, co } = await pair('l');
    expect((await owner.a.post('/v1/family/leave')).body.reason).toBe('family_owner_cannot_leave');
    await co.post('/v1/family/leave').expect(204);
    const again = await login('co-l@test.local');
    expect((await again.get('/v1/me')).body).toMatchObject({ hasFamily: false, role: null });
    expect((await again.get('/v1/children')).body).toMatchObject({ code: 'conflict', reason: 'no_family' });
    await again.post('/v1/family').expect(201);
    expect((await again.get('/v1/me')).body).toMatchObject({ hasFamily: true, role: 'owner' });
    expect((await again.post('/v1/family')).status).toBe(409);
  });
  it('두 보호자가 같은 작품에 결정하면 첫 결정만(BR-APR-06)', async () => {
    const { owner, co } = await pair('d');
    const r = await upload(owner.a, owner.childId, await png()).expect(202);
    await simulateResult(t.db, r.body.id, 'animated');
    await owner.a.post(`/v1/artworks/${r.body.id}/decision`).send({ decision: 'like' }).expect(200);
    const second = await co.post(`/v1/artworks/${r.body.id}/decision`).send({ decision: 'frame' }).expect(200);
    expect(second.body.alreadyDecided).toBe(true);
    expect(await q(`SELECT decision_code FROM decision`)).toEqual([{ decision_code: 'like' }]);
  });
});
