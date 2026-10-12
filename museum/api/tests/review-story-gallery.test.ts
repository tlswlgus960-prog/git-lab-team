// US4 시험(T084 결정·T085 이야기·전시·T086 가족 간 차단·T142 동시 수정): UC4·UC5·UC6, FR-6·7·8·9, G9~G12, BR-APR-02~06, BR-EXH-01~07, D2·D3·D11·D14.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { randomUUID } from 'node:crypto';
import { familyWithChild, png, seedModels, setStory, simulateResult, upload } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });
const q = async <T>(sql: string, p: unknown[] = []) => (await t.db.query(sql, p))[0] as T[];
const STORY = { title: '우리 가족', madeOn: '2026-09-20', ageAtMaking: 5, childWords: '  엄마랑 바다 갔어  ' };

async function reviewed(email: string, kind: 'animated' | 'relief' | 'frame', opts = {}) {
  const f = await familyWithChild(t, email);
  const r = await upload(f.a, f.childId, await png()).expect(202);
  await simulateResult(t.db, r.body.id, kind, opts);
  return { ...f, id: r.body.id as string };
}

describe('결과 확인 결정(UC4)', () => {
  it('움직임+마스크: 좋아요·낮춘 결과로 걸기·액자·다시 찍기, 좋아요 → 승인, 중복은 첫 결정(E7·D11)', async () => {
    const f = await reviewed('d1@test.local', 'animated');
    const d = await f.a.get(`/v1/artworks/${f.id}`).expect(200);
    expect(d.body.choices).toEqual(['like', 'use_lower', 'frame', 'retake']);
    const r = await f.a.post(`/v1/artworks/${f.id}/decision`).send({ decision: 'like' }).expect(200);
    expect(r.body).toMatchObject({ alreadyDecided: false, artwork: { state: 'exhibited', decision: 'like', hungResultKind: 'animated' } }); // D34 바꿔 걸기
    const again = await f.a.post(`/v1/artworks/${f.id}/decision`).send({ decision: 'frame' }).expect(200);
    expect(again.body.alreadyDecided).toBe(true);
    expect(await q(`SELECT first_decision, in_approval_base FROM artwork_outcome`)).toEqual([{ first_decision: 'like', in_approval_base: 1 }]);
  });
  it('2.5D는 좋아요·액자·다시 찍기, 액자 결과는 좋아요·다시 찍기(UC4 A4)', async () => {
    const r1 = await reviewed('d2@test.local', 'relief');
    expect((await r1.a.get(`/v1/artworks/${r1.id}`)).body.choices).toEqual(['like', 'frame', 'retake']);
    const r2 = await reviewed('d3@test.local', 'frame');
    expect((await r2.a.get(`/v1/artworks/${r2.id}`)).body.choices).toEqual(['like', 'retake']);
  });
  it('낮춘 결과로 걸기 → depth_relief(use_lower)·처리 중·보호자 전환, 2회차에는 use_lower 없음(UC4 A1)', async () => {
    const f = await reviewed('d4@test.local', 'animated');
    const r = await f.a.post(`/v1/artworks/${f.id}/decision`).send({ decision: 'use_lower' }).expect(200);
    expect(r.body.artwork).toMatchObject({ state: 'processing', exhibited: true }); // D34: 다시 만드는 동안에도 원본 액자로 전시
    expect(await q(`SELECT stage_kind, origin FROM stage_job WHERE origin = 'use_lower'`)).toEqual([{ stage_kind: 'depth_relief', origin: 'use_lower' }]);
    expect((await q<{ result_cause: string }>(`SELECT result_cause FROM artwork_outcome`))[0].result_cause).toBe('guardian_switch');
    await simulateResult(t.db, f.id, 'relief', { origin: 'use_lower' });
    expect((await f.a.get(`/v1/artworks/${f.id}`)).body.choices).toEqual(['like', 'frame', 'retake']);
    await f.a.post(`/v1/artworks/${f.id}/decision`).send({ decision: 'like' }).expect(200);
    expect(await q(`SELECT review_round, decision_code FROM decision ORDER BY review_round`)).toEqual([
      { review_round: 1, decision_code: 'use_lower' }, { review_round: 2, decision_code: 'like' }]);
  });
  it('마스크 없으면 use_lower 없음', async () => {
    const f = await reviewed('d5@test.local', 'animated', { mask: false });
    expect((await f.a.get(`/v1/artworks/${f.id}`)).body.choices).toEqual(['like', 'frame', 'retake']);
  });
  it('처리하지 못함: 액자·다시 찍기만, 좋아요는 409(G9), 액자 → 승인·분모 제외·원인 유지(D2)', async () => {
    const f = await familyWithChild(t, 'd6@test.local');
    const r = await upload(f.a, f.childId, await png()).expect(202);
    await t.db.query(`INSERT INTO artwork_outcome (artwork_id, confirmed_path, result_cause) VALUES (?, 'animated', 'not_delivered')`, [r.body.id]);
    await t.db.query(`UPDATE artwork SET status = 'failed' WHERE artwork_id = ?`, [r.body.id]);
    const d = await f.a.get(`/v1/artworks/${r.body.id}`).expect(200);
    expect(d.body).toMatchObject({ state: 'failed', exhibited: true, choices: ['frame', 'retake'], notDelivered: { frameAvailable: true } });
    const bad = await f.a.post(`/v1/artworks/${r.body.id}/decision`).send({ decision: 'like' });
    expect(bad.body).toMatchObject({ code: 'conflict', gate: 'G9' });
    await f.a.post(`/v1/artworks/${r.body.id}/decision`).send({ decision: 'frame' }).expect(200);
    expect(await q(`SELECT result_cause, in_approval_base, result_kind FROM artwork_outcome`)).toEqual([{ result_cause: 'not_delivered', in_approval_base: 0, result_kind: 'frame' }]);
  });
  it('다시 찍기 → 삭제 중·deletion_request(retake)·아이 ID 안내(EXT2)', async () => {
    const f = await reviewed('d7@test.local', 'animated');
    const r = await f.a.post(`/v1/artworks/${f.id}/decision`).send({ decision: 'retake' }).expect(200);
    expect(r.body.retake).toEqual({ childId: f.childId });
    expect(r.body.artwork).toBeNull();
    expect(await q(`SELECT origin, status FROM deletion_request`)).toEqual([{ origin: 'retake', status: 'waiting_stop' }]);
    expect((await f.a.get(`/v1/artworks/${f.id}`)).status).toBe(404);
  });
});

describe('이야기·전시(UC5·UC6) — D46 올린 작품은 고정', () => {
  const up = async (a: Parameters<typeof upload>[0], childId: string, fields: Record<string, string>) => {
    let r = a.post('/v1/artworks').set('Idempotency-Key', randomUUID()).field('childId', childId);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('photo', await png(), 'p.png');
  };
  it('이야기는 올릴 때 함께 적는다(한마디 받은 그대로) · 칸 검사 422 · 올린 뒤에는 409 artwork_locked', async () => {
    const f = await familyWithChild(t, 's1@test.local');
    expect((await up(f.a, f.childId, { madeOn: '2999-01-01' })).body.reason).toBe('made_on_in_future');
    expect((await up(f.a, f.childId, { ageAtMaking: '19' })).status).toBe(422);
    expect((await up(f.a, f.childId, { making: 'maybe' })).status).toBe(422);
    const r = await up(f.a, f.childId, { title: STORY.title, madeOn: STORY.madeOn, ageAtMaking: '5', childWords: STORY.childWords, guardianNote: '감상', making: 'true' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ making: true, locked: true, story: { title: '우리 가족', titleAuto: false, madeOnAuto: false, ageAuto: false, madeOn: '2026-09-20', ageAtMaking: 5, childWords: '  엄마랑 바다 갔어  ', guardianNote: '감상' } });
    const locked = await f.a.put(`/v1/artworks/${r.body.id}/story`).send({ title: '고침' });
    expect(locked.status).toBe(409);
    expect(locked.body.reason).toBe('artwork_locked');
    expect((await f.a.get(`/v1/gallery?child=${f.childId}`)).body.groups[0].items[0]).toMatchObject({ making: true, title: '우리 가족' });
  });
  it('올리면 원본 액자로 전시, 좋아요 뒤 결과로 바꿔 걸림, 낮춤 표시 없음(BR-EXH-01·07 · D34)', async () => {
    const f = await reviewed('s2@test.local', 'relief', { cause: 'model_downgrade' });
    await setStory(t.db, f.id, STORY);
    expect((await f.a.get(`/v1/gallery?child=${f.childId}`)).body.groups[0].items).toMatchObject([{ kind: 'frame', title: '우리 가족' }]);
    const r = await f.a.post(`/v1/artworks/${f.id}/decision`).send({ decision: 'like' }).expect(200);
    expect(r.body.artwork.state).toBe('exhibited');
    const g = await f.a.get(`/v1/gallery?child=${f.childId}`).expect(200);
    expect(g.body.groups).toHaveLength(1);
    expect(g.body.groups[0]).toMatchObject({ ageAtMaking: 5, items: [{ kind: 'relief', title: '우리 가족', childWords: '  엄마랑 바다 갔어  ' }] });
    expect(JSON.stringify(g.body)).not.toMatch(/downgrade|cause|score/);
  });
  it('액자로 걸기면 전시는 원본 액자(SD_03 §19 #17)', async () => {
    const f = await reviewed('s3@test.local', 'animated');
    await setStory(t.db, f.id, STORY);
    await f.a.post(`/v1/artworks/${f.id}/decision`).send({ decision: 'frame' }).expect(200);
    const g = await f.a.get(`/v1/gallery?child=${f.childId}`).expect(200);
    expect(g.body.groups[0].items[0]).toMatchObject({ kind: 'frame', primaryUrl: null });
    expect(g.body.groups[0].items[0].originalUrl).toMatch(/^\/v1\/files\//);
  });
  it('연령 묶음 → 제작일 순, 제목 찾기', async () => {
    const f = await familyWithChild(t, 's4@test.local');
    for (const [title, madeOn, age] of [['셋', '2026-03-01', 6], ['하나', '2025-05-01', 5], ['둘', '2025-01-01', 5]] as const) {
      const r = await up(f.a, f.childId, { title, madeOn, ageAtMaking: String(age) });
      expect(r.status).toBe(202);
      await simulateResult(t.db, r.body.id, 'frame');
      await f.a.post(`/v1/artworks/${r.body.id}/decision`).send({ decision: 'like' }).expect(200);
    }
    const g = await f.a.get(`/v1/gallery?child=${f.childId}`).expect(200);
    expect(g.body.groups.map((x: { ageAtMaking: number; items: { title: string }[] }) => [x.ageAtMaking, x.items.map((i) => i.title)]))
      .toEqual([[5, ['둘', '하나']], [6, ['셋']]]);
    expect((await f.a.get(`/v1/gallery?child=${f.childId}&q=셋`)).body.groups[0].items).toHaveLength(1);
  });
  it('부모 댓글(D46 ④): 걸린 뒤 7일 동안 쓰고 읽기 · 입력 그대로 · 자기 것만 지움 · 빈칸·500자 초과 422 · 7일 지나면 보기만(409 comments_closed) · 다른 가족 404', async () => {
    const f = await familyWithChild(t, 's5@test.local');
    const r = await upload(f.a, f.childId, await png()).expect(202);
    expect((await f.a.get(`/v1/artworks/${r.body.id}/comments`).expect(200)).body).toMatchObject({ items: [], open: true, days: 7 });
    const c = await f.a.post(`/v1/artworks/${r.body.id}/comments`).send({ body: '  하늘이 정말 파래요  ' }).expect(201);
    expect(c.body).toMatchObject({ body: '  하늘이 정말 파래요  ', mine: true, author: 'me' });
    expect((await f.a.post(`/v1/artworks/${r.body.id}/comments`).send({ body: '   ' })).status).toBe(422);
    expect((await f.a.post(`/v1/artworks/${r.body.id}/comments`).send({ body: '가'.repeat(501) })).status).toBe(422);
    await t.db.query(`INSERT INTO artwork_comment (artwork_id, account_id, body) VALUES (?, NULL, '다른 보호자')`, [r.body.id]);
    const list = (await f.a.get(`/v1/artworks/${r.body.id}/comments`).expect(200)).body.items as { id: string; mine: boolean }[];
    expect(list).toHaveLength(2);
    const other = list.find((x) => !x.mine)!;
    expect((await f.a.delete(`/v1/artworks/${r.body.id}/comments/${other.id}`)).status).toBe(403);
    await f.a.delete(`/v1/artworks/${r.body.id}/comments/${c.body.id}`).expect(204);
    // 기한(7일)이 지나면 아무것도 못 건드린다 — 보기만
    await t.db.query(`UPDATE artwork SET hung_at = CURRENT_TIMESTAMP - INTERVAL 8 DAY WHERE artwork_id = ?`, [r.body.id]);
    const late = await f.a.get(`/v1/artworks/${r.body.id}/comments`).expect(200);
    expect(late.body).toMatchObject({ open: false });
    expect(late.body.items).toHaveLength(1);
    expect((await f.a.post(`/v1/artworks/${r.body.id}/comments`).send({ body: '늦은 댓글' })).body).toMatchObject({ code: 'conflict', reason: 'comments_closed' });
    expect((await f.a.delete(`/v1/artworks/${r.body.id}/comments/${other.id}`)).body.reason).toBe('comments_closed');
    const B = await familyWithChild(t, 's6@test.local');
    expect((await B.a.get(`/v1/artworks/${r.body.id}/comments`)).status).toBe(404);
    expect((await B.a.post(`/v1/artworks/${r.body.id}/comments`).send({ body: 'x' })).status).toBe(404);
  });
});

describe('가족 간 차단(T086, Scenario 12)', () => {
  it('다른 가족의 전시·결정·이야기·파일은 404', async () => {
    const A = await reviewed('x1@test.local', 'animated');
    const B = await familyWithChild(t, 'x2@test.local');
    expect((await B.a.get(`/v1/gallery?child=${A.childId}`)).status).toBe(404);
    expect((await B.a.post(`/v1/artworks/${A.id}/decision`).send({ decision: 'like' })).status).toBe(404);
    expect((await B.a.put(`/v1/artworks/${A.id}/story`).send({ title: 'x' })).status).toBe(404);
    const url = (await A.a.get(`/v1/artworks/${A.id}`)).body.originalUrl;
    expect((await B.a.get(url)).status).toBe(404);
    expect((await request(t.app).get(`/v1/gallery?child=${A.childId}`)).status).toBe(401);
  });
});
