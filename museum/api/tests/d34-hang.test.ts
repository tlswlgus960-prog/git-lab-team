// D34 시험(올리면 원본 액자로 바로 전시): docs/B/B_D34_설계반영안_2026-09-30.md §7 — 자동 이야기 · 촬영일 · 나이 미정 · 걸린 채 다시 만들기 · 걸린 결과 트리거.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { setStory, familyWithChild, png, seedModels, simulateResult, upload } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });
const q = async <T>(sql: string, p: unknown[] = []) => (await t.db.query(sql, p))[0] as T[];
const withDate = async (a: Parameters<typeof upload>[0], childId: string, capturedOn: string) =>
  a.post('/v1/artworks').set('Idempotency-Key', randomUUID()).field('childId', childId).field('capturedOn', capturedOn).attach('photo', await png(), 'p.png');

describe('D34 올리기 = 바로 전시', () => {
  it('촬영일(capturedOn)이 그린 날이 된다, 미래면 오늘, 형식이 틀리면 422', async () => {
    const { a, childId } = await familyWithChild(t, 'h1@test.local');
    const r = await withDate(a, childId, '2026-05-05');
    expect(r.status).toBe(202);
    expect(r.body.story.madeOn).toBe('2026-05-05');
    const fut = await withDate(a, childId, '2999-01-01');
    expect(fut.body.story.madeOn < '2999-01-01').toBe(true);
    const bad = await withDate(a, childId, '5월 5일');
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ reason: 'captured_on' });
  });
  it('자동 제목은 아이마다 차례로, 나이는 그 아이의 가장 최근 기록 — 없으면 나이 미정 묶음(맨 뒤)', async () => {
    const { a, childId } = await familyWithChild(t, 'h2@test.local');
    const r1 = await upload(a, childId, await png()).expect(202);
    expect(r1.body.story).toMatchObject({ title: '제목 없는 그림 1', ageAtMaking: null });
    let g = await a.get(`/v1/gallery?child=${childId}`).expect(200);
    expect(g.body.groups).toMatchObject([{ ageAtMaking: null, items: [{ title: '제목 없는 그림 1', titleAuto: true, kind: 'frame' }] }]);
    await setStory(t.db, r1.body.id, { ageAtMaking: 6 }); // D46: 올린 뒤 고정 — 시험 준비만 DB로
    const r2 = await upload(a, childId, await png()).expect(202);
    expect(r2.body.story).toMatchObject({ title: '제목 없는 그림 2', ageAtMaking: 6 });
    await setStory(t.db, r2.body.id, { ageAtMaking: null }); // 나이 미정 작품
    g = await a.get(`/v1/gallery?child=${childId}`).expect(200);
    expect(g.body.groups.map((x: { ageAtMaking: number | null }) => x.ageAtMaking)).toEqual([6, null]);
    expect((await a.put(`/v1/artworks/${r2.body.id}/story`).send({ madeOn: null })).status).toBe(409); // D46 올린 뒤 고정
  });
  it('걸린 채 다시 만들기: 처리 중·확인 대기에도 원본 액자로 전시, 좋아요 하면 새 결과로 바꿔 걸림', async () => {
    const { a, childId } = await familyWithChild(t, 'h3@test.local');
    const r = await upload(a, childId, await png()).expect(202);
    await t.db.query(`UPDATE stage_job SET status = 'done', finished_at = started_at WHERE artwork_id = ?`, [r.body.id]);
    await t.db.query(`INSERT INTO judgment (artwork_id, split_ok, suggestion, suggestion_state) VALUES (?, 1, 'animated', 'presented')`, [r.body.id]);
    await t.db.query(`UPDATE artwork SET status = 'awaiting_confirm' WHERE artwork_id = ?`, [r.body.id]);
    const c = await a.post(`/v1/artworks/${r.body.id}/confirm`).send({ kind: 'animated' }).expect(200);
    expect(c.body).toMatchObject({ state: 'processing', exhibited: true, hungResultKind: 'frame' });
    const kinds = async () => (await a.get(`/v1/gallery?child=${childId}`)).body.groups[0].items.map((i: { kind: string }) => i.kind);
    expect(await kinds()).toEqual(['frame']);
    await simulateResult(t.db, r.body.id, 'animated');
    expect((await a.get(`/v1/artworks/${r.body.id}`)).body).toMatchObject({ state: 'awaiting_review', exhibited: true });
    expect(await kinds()).toEqual(['frame']);
    await a.post(`/v1/artworks/${r.body.id}/decision`).send({ decision: 'like' }).expect(200);
    expect(await kinds()).toEqual(['animated']);
  });
  it('걸린 결과는 같은 작품의 결과만(trg_artwork_hung_bu)', async () => {
    const { a, childId } = await familyWithChild(t, 'h4@test.local');
    const r1 = await upload(a, childId, await png()).expect(202);
    const r2 = await upload(a, childId, await png()).expect(202);
    const [o] = await q<{ result_id: number }>(`SELECT result_id FROM result WHERE artwork_id = ?`, [r2.body.id]);
    await expect(t.db.query(`UPDATE artwork SET hung_result_id = ? WHERE artwork_id = ?`, [o.result_id, r1.body.id])).rejects.toThrow(/hung_result_other_artwork/);
  });
});
