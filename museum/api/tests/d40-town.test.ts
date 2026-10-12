// D40 미술관 마을(SD_02 §17-13, UC_16): 아이 캐릭터 칸 · 이웃 초대 링크(한 번·7일·대기 1) · 마을 · 방문 미술관(그림·별칭·제목만) · 방문 파일(받을 때마다 이웃 재확인).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { contractViolations, testApp, tokenOf } from './helpers/app.js';
import { setStory, familyWithChild, png, seedModels, upload } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => { expect(contractViolations).toEqual([]); await t.close(); });
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });
const q = async <T>(sql: string, p: unknown[] = []) => (await t.db.query(sql, p))[0] as T[];

/** A가 링크를 만들고 B가 받아 이웃이 된다 */
async function neighbors(A: { a: ReturnType<typeof request.agent> }, B: { a: ReturnType<typeof request.agent> }) {
  const inv = await A.a.post('/v1/neighbors/invites').send({}).expect(201);
  await B.a.post('/v1/neighbors/accept').send({ token: tokenOf(inv.body.link) }).expect(204);
}

describe('아이 캐릭터(D40 A)', () => {
  it('만들 때 캐릭터·색·미술관 모양을 저장하고 목록에 싣는다, 안 고르면 null', async () => {
    const { a } = await familyWithChild(t, 'c1@test.local');
    const c = await a.post('/v1/children').send({ alias: '별이', character: 'fox', color: 'peach', museumStyle: 'glass_pyramid' }).expect(201);
    expect(c.body).toMatchObject({ alias: '별이', character: 'fox', color: 'peach', museumStyle: 'glass_pyramid' });
    const list = (await a.get('/v1/children').expect(200)).body;
    expect(list[0]).toMatchObject({ alias: '하늘', character: null, color: null, museumStyle: null });
    expect(list[1]).toMatchObject({ character: 'fox', color: 'peach', museumStyle: 'glass_pyramid' });
  });
  it('고칠 때 보낸 칸만 바꾼다, 허용 밖 값은 422와 허용 값 안내', async () => {
    const { a, childId } = await familyWithChild(t, 'c2@test.local');
    await a.patch(`/v1/children/${childId}`).send({ alias: '하늘', character: 'owl' }).expect(200);
    const p = await a.patch(`/v1/children/${childId}`).send({ alias: '하늘이', color: 'sky' }).expect(200);
    expect(p.body).toMatchObject({ alias: '하늘이', character: 'owl', color: 'sky', museumStyle: null });
    const bad = await a.post('/v1/children').send({ alias: '달', character: 'dragon' }).expect(422);
    expect(bad.body.fields[0]).toMatchObject({ name: 'character' });
    expect(bad.body.fields[0].message).toContain('bear');
  });
});

describe('이웃 맺기(D40 E, UC_16)', () => {
  it('링크 한 번 · 자기 가족 409 · 이미 이웃 204 · 대기 1건 · 취소', async () => {
    const A = await familyWithChild(t, 'n1@test.local');
    const B = await familyWithChild(t, 'n2@test.local');
    const inv = await A.a.post('/v1/neighbors/invites').send({}).expect(201);
    expect(inv.body.link).toMatch(/^http:\/\/app\.test\/app\/neighbor\?token=/);
    expect((await A.a.get('/v1/neighbors/invites')).body).toHaveLength(1);
    expect((await A.a.post('/v1/neighbors/accept').send({ token: tokenOf(inv.body.link) })).body).toMatchObject({ code: 'conflict', reason: 'own_family' });
    await B.a.post('/v1/neighbors/accept').send({ token: tokenOf(inv.body.link) }).expect(204);
    expect((await B.a.post('/v1/neighbors/accept').send({ token: tokenOf(inv.body.link) })).body.code).toBe('token_invalid'); // 한 번
    await neighbors(B, A); // 이미 이웃이어도 204
    expect(await q('SELECT COUNT(*) n FROM family_neighbor')).toEqual([{ n: 1 }]);
    const first = await A.a.post('/v1/neighbors/invites').send({}).expect(201);
    const second = await A.a.post('/v1/neighbors/invites').send({}).expect(201);
    expect((await A.a.get('/v1/neighbors/invites')).body).toEqual([{ id: second.body.id, expiresAt: second.body.expiresAt }]);
    expect((await B.a.post('/v1/neighbors/accept').send({ token: tokenOf(first.body.link) })).body.code).toBe('token_invalid');
    await A.a.delete(`/v1/neighbors/invites/${second.body.id}`).expect(204);
    expect((await A.a.get('/v1/neighbors/invites')).body).toEqual([]);
    await A.a.delete(`/v1/neighbors/invites/${second.body.id}`).expect(404);
  });
  it('이웃 30가족이면 초대·받기 409 neighbor_full', async () => {
    const A = await familyWithChild(t, 'full@test.local');
    const [[{ family_id: fa }]] = (await t.db.query(`SELECT family_id FROM guardian_account WHERE email = 'full@test.local'`)) as unknown as [{ family_id: number }[]];
    for (let i = 0; i < 30; i++) {
      const [f] = await t.db.query(`INSERT INTO family () VALUES ()`);
      const other = (f as { insertId: number }).insertId;
      await t.db.query(`INSERT INTO family_neighbor (family_low, family_high) VALUES (?, ?)`, [Math.min(fa, other), Math.max(fa, other)]);
    }
    expect((await A.a.post('/v1/neighbors/invites').send({})).body).toMatchObject({ status: 409, reason: 'neighbor_full' });
    const B = await familyWithChild(t, 'late@test.local');
    const inv = await B.a.post('/v1/neighbors/invites').send({}).expect(201);
    expect((await A.a.post('/v1/neighbors/accept').send({ token: tokenOf(inv.body.link) })).body).toMatchObject({ status: 409, reason: 'neighbor_full' });
  });
});

describe('마을 · 방문(D40 D·F)', () => {
  it('내 건물 · 이웃(아이 별칭·캐릭터) · 모르는 가족(모양만), 건물 id는 가족 번호가 아니다', async () => {
    const A = await familyWithChild(t, 't1@test.local');
    const B = await familyWithChild(t, 't2@test.local');
    await familyWithChild(t, 't3@test.local');
    await B.a.patch(`/v1/children/${B.childId}`).send({ alias: '하늘', character: 'penguin', color: 'sky', museumStyle: 'hanok_roof' }).expect(200);
    await neighbors(A, B);
    const town = (await A.a.get('/v1/town').expect(200)).body.buildings as { id: string; relation: string; style: string | null; children?: unknown[]; x: number; y: number }[];
    expect(town.map((b) => b.relation).sort()).toEqual(['mine', 'neighbor', 'stranger']);
    const nb = town.find((b) => b.relation === 'neighbor')!;
    expect(nb).toMatchObject({ style: 'hanok_roof', children: [{ id: B.childId, alias: '하늘', character: 'penguin', color: 'sky', museumStyle: 'hanok_roof' }] });
    const st = town.find((b) => b.relation === 'stranger')!;
    expect(st.children).toBeUndefined();
    for (const b of town) expect(b.id).toMatch(/^b_[A-Za-z0-9_-]{16}$/);
    expect(new Set(town.map((b) => `${b.x},${b.y}`)).size).toBe(3);
    expect((await A.a.get('/v1/neighbors')).body).toEqual([nb]);
  });
  it('방문 미술관은 그림·제목만(나이·한마디·그린 날 없음), 파일은 이웃일 때만 · 끊으면 바로 404', async () => {
    const A = await familyWithChild(t, 'v1@test.local');
    const B = await familyWithChild(t, 'v2@test.local');
    const art = await upload(B.a, B.childId, await png()).expect(202);
    await setStory(t.db, art.body.id, { title: '우리 집', childWords: '엄마랑', ageAtMaking: 5 }); // D46 올린 뒤 고정 — 시험 준비만 DB로
    // 이웃 전에는 존재를 숨긴다
    await A.a.get(`/v1/visit/children/${B.childId}/gallery`).expect(404);
    await neighbors(A, B);
    const g = (await A.a.get(`/v1/visit/children/${B.childId}/gallery`).expect(200)).body;
    expect(g.child).toMatchObject({ id: B.childId, alias: '하늘' });
    expect(g.rooms).toHaveLength(1);
    expect(g.rooms[0].room).toBe(1);
    const item = g.rooms[0].items[0];
    expect(Object.keys(item).sort()).toEqual(['auxUrl', 'id', 'kind', 'making', 'primaryUrl', 'title']); // D46 making(받침대, 8c 요청)
    expect(JSON.stringify(g)).not.toMatch(/엄마랑|ageAtMaking|madeOn|originalUrl/);
    expect(item.primaryUrl).toMatch(/^\/v1\/visit\/files\//);
    await A.a.get(item.primaryUrl).expect(200);
    // 가족 파일 경로로는 못 받고, 방문 토큰은 다른 가족이 못 쓴다
    await A.a.get(item.primaryUrl.replace('/v1/visit/files/', '/v1/files/')).expect(404);
    const C = await familyWithChild(t, 'v3@test.local');
    await C.a.get(item.primaryUrl).expect(404);
    // 끊기(어느 쪽이든) → 바로 잠김
    const bId = (await B.a.get('/v1/neighbors')).body[0].id;
    await B.a.delete(`/v1/neighbors/${bId}`).expect(204);
    await A.a.get(item.primaryUrl).expect(404);
    await A.a.get(`/v1/visit/children/${B.childId}/gallery`).expect(404);
    await B.a.delete(`/v1/neighbors/${bId}`).expect(404);
  });
});
