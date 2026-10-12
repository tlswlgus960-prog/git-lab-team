// 오류 안내(contracts/openapi.yaml 머리말 "오류 안내", 2026-09-30 점검표 W5·E4·E7):
// 이상한 값을 넣으면 부르는 쪽에 무엇이 틀렸고 어떤 값을 넣어야 하는지 사람 말로 돌려준다 — detail + fields[].message.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { familyWithChild, png, seedModels, simulateResult, upload } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
let g: Awaited<ReturnType<typeof familyWithChild>>;
let art: string;
beforeAll(async () => {
  await resetData(t.db); await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']);
  g = await familyWithChild(t, 'guide@test.local');
  art = (await upload(g.a, g.childId, await png()).expect(202)).body.id;
  await simulateResult(t.db, art, 'animated');
});

const guided = (r: { status: number; body: { detail?: string; fields?: { name: string; message?: string }[] } }, status: number) => {
  expect(r.status).toBe(status);
  expect(typeof r.body.detail).toBe('string');
  expect(r.body.detail!.length).toBeGreaterThan(5);
  return r.body;
};
const msgOf = (b: { fields?: { name: string; message?: string }[] }, name: string) => b.fields?.find((f) => f.name === name)?.message ?? '';

describe('422 — 올바른 값을 알려 준다', () => {
  it('필수 쿼리 없음: 무엇을 넣어야 하는지', async () => {
    const b = guided(await g.a.get('/v1/gallery'), 422);
    expect(b.detail).toContain('다시 보내');
    expect(msgOf(b, 'child')).toMatch(/필수/);
  });
  it('숫자 id 자리에 문자: 1 이상의 정수', async () => {
    expect(msgOf(guided(await g.a.get('/v1/artworks/abc'), 422), 'artworkId')).toMatch(/1 이상의 정수/);
  });
  it('목록 밖 값: 허용 값을 나열', async () => {
    const m = msgOf(guided(await g.a.post(`/v1/artworks/${art}/decision`).send({ decision: 'love' }), 422), 'decision');
    expect(m).toContain('like'); expect(m).toContain('retake');
  });
  it('모르는 칸: 빼고 보내라', async () => {
    expect(msgOf(guided(await g.a.post('/v1/children').send({ alias: '별이', birth: '2020-01-01' }), 422), 'birth')).toMatch(/없는 칸/);
  });
  it('길이 초과·공백만: 허용 범위', async () => {
    expect(msgOf(guided(await g.a.post('/v1/children').send({ alias: '가'.repeat(21) }), 422), 'alias')).toMatch(/20/);
    expect(msgOf(guided(await g.a.post('/v1/children').send({ alias: '   ' }), 422), 'alias')).toMatch(/공백/);
  });
  it('타입 불일치: 기대 타입', async () => {
    expect(msgOf(guided(await g.a.post('/v1/children').send({ alias: 123 }), 422), 'alias')).toMatch(/문자열/);
  });
  it('미래 날짜(DB 트리거 G11): 오늘이나 지난 날짜', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    // D46: 이야기는 올릴 때 함께 — 미래 그린 날은 올리기에서 422
    const b = guided(await g.a.post('/v1/artworks').set('Idempotency-Key', randomUUID()).field('childId', g.childId).field('madeOn', tomorrow).attach('photo', await png(), 'p.png'), 422);
    expect(`${b.detail} ${msgOf(b, 'madeOn')}`).toMatch(/미래|오늘/);
  });
});

describe('다른 오류도 detail이 있다 — 누가 고치나가 드러나게', () => {
  it('JSON 깨짐 400', async () => {
    expect(guided(await g.a.post('/v1/children').set('content-type', 'application/json').send('{"a":'), 400).detail).toMatch(/JSON/);
  });
  it('로그인 없음 401 · 없는 자원 404', async () => {
    guided(await request(t.app).get('/v1/children'), 401);
    guided(await g.a.get('/v1/artworks/999999'), 404);
  });
});
