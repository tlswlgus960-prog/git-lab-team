// US1 아이 시험(T043): FR-1 v2.2, UC1, G0·G4, BR-CHD-01·02(D18: 중복 검사 없음).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp, tokenOf } from './helpers/app.js';

const t = testApp();
const PW = 'correct-horse-1';
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; });

async function family(email: string) {
  await request(t.app).post('/v1/auth/signup').send({ email, password: PW, passwordConfirm: PW }).expect(202);
  const a = request.agent(t.app);
  await a.post('/v1/auth/email/verify').send({ token: tokenOf(t.mailer.sent.at(-1)!.link) }).expect(204);
  return a;
}

describe('아이 등록·조회·수정', () => {
  it('별칭만 받아 201, 같은 별칭도 저장하고 aliasDuplicate=true(D18)', async () => {
    const a = await family('a@test.local');
    const c1 = await a.post('/v1/children').send({ alias: '하늘' }).expect(201);
    expect(c1.body).toMatchObject({ alias: '하늘', aliasDuplicate: false, artworkCount: 0 });
    const c2 = await a.post('/v1/children').send({ alias: '하늘' }).expect(201);
    expect(c2.body.aliasDuplicate).toBe(true);
    expect((await a.get('/v1/children').expect(200)).body).toHaveLength(2);
  });
  it('빈 별칭·다른 필드(실명 등)는 422, G4 게이트 기록(사유 코드만)', async () => {
    const a = await family('b@test.local');
    expect((await a.post('/v1/children').send({ alias: '   ' })).status).toBe(422);
    expect((await a.post('/v1/children').send({ alias: '하늘', realName: '홍길동' })).status).toBe(422);
    const [ge] = await t.db.query(`SELECT gate_id, reason_code FROM gate_event WHERE gate_id = 'G4'`);
    expect((ge as { reason_code: string }[]).map((g) => g.reason_code)).toContain('alias_blank');
  });
  it('별칭은 앞뒤 공백 뺀 1~20자(D22, T149): 20자는 저장, 21자는 422 alias_too_long(G4)', async () => {
    const a = await family('len@test.local');
    const twenty = '가'.repeat(20);
    expect((await a.post('/v1/children').send({ alias: `  ${twenty}  ` }).expect(201)).body.alias).toBe(twenty);
    const r = await a.post('/v1/children').send({ alias: '가'.repeat(21) });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ reason: 'alias_too_long', gate: 'G4' });
    // 수정 경로도 같은 규칙(같은 cleanAlias)
    const id = (await a.get('/v1/children').expect(200)).body[0].id;
    const p = await a.patch(`/v1/children/${id}`).send({ alias: '나'.repeat(21) });
    expect(p.status).toBe(422);
    expect(p.body).toMatchObject({ reason: 'alias_too_long', gate: 'G4' });
    expect((await a.patch(`/v1/children/${id}`).send({ alias: ` ${'나'.repeat(20)} ` }).expect(200)).body.alias).toBe('나'.repeat(20));
  });
  it('다른 가족의 아이는 목록에 없고 수정은 404(G0)', async () => {
    const a = await family('c@test.local');
    const b = await family('d@test.local');
    const c = await a.post('/v1/children').send({ alias: '별' }).expect(201);
    expect((await b.get('/v1/children').expect(200)).body).toHaveLength(0);
    expect((await b.patch(`/v1/children/${c.body.id}`).send({ alias: '바꿈' })).status).toBe(404);
    const ok = await a.patch(`/v1/children/${c.body.id}`).send({ alias: '바꿈' }).expect(200);
    expect(ok.body.alias).toBe('바꿈');
  });
  it('로그인하지 않으면 401', async () => {
    expect((await request(t.app).get('/v1/children')).status).toBe(401);
  });
});
