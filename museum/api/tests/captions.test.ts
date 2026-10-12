// US10 설명 초안 시험(T128): UC10, FR-27, BR-CAP-01~07, G13~G16, D1·D6, stage-job §11, llm-contract.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { setStory, familyWithChild, png, seedModels, upload } from './helpers/fixtures.js';

const t = testApp({ CAPTION_ENABLED: 'true' });
const off = testApp();
afterAll(async () => { await t.close(); await off.close(); });

const OK = (o: Partial<{ source: 'llm' | 'template'; body: string; generationCount: number; failClasses: string[] }> = {}) =>
  ({ outcome: 'ok' as const, source: o.source ?? 'llm', body: o.body ?? '5살 때 바다를 그린 작품이에요.', generationCount: o.generationCount ?? 1, failClasses: o.failClasses ?? [] });

async function artwork() {
  const f = await familyWithChild(t, `c${Math.random()}@test.local`);
  const r = await upload(f.a, f.childId, await png()).expect(202);
  await t.db.query(`INSERT INTO tag_candidate (artwork_id, label) VALUES (?, '바다'), (?, '해')`, [r.body.id, r.body.id]);
  await setStory(t.db, r.body.id, { ageAtMaking: 5, childWords: '엄마랑 바다 갔어', title: '비밀제목' }); // D46 올린 뒤 고정 — 시험 준비만 DB로
  return { ...f, id: r.body.id as string };
}
const job = async (id: string) => ((await t.db.query(`SELECT status, attempt_count, downgrade_cause, error_class FROM stage_job WHERE artwork_id = ? AND stage_kind = 'caption' ORDER BY job_id DESC LIMIT 1`, [id]))[0] as Record<string, unknown>[])[0];

beforeEach(async () => {
  await resetData(t.db);
  t.mailer.sent.length = 0; t.llm.replies = []; t.llm.calls = [];
  await seedModels(t.db, ['M1', 'M2', 'M3', 'M5', 'M6']);
});

describe('P0 비노출', () => {
  it('CAPTION_ENABLED=false면 404', async () => {
    const f = await familyWithChild(off, 'off@test.local');
    await f.a.get('/v1/captions/model-status').expect(404);
    await f.a.post('/v1/artworks/1/captions').send({ keywords: ['해'], selectedTags: [] }).expect(404);
  });
});

describe('초안 생성(BR-CAP-01~03, G14·G16)', () => {
  it('허용 필드만 보내고, 통과 초안은 승인 대기·AI 작성, 단계 작업 done', async () => {
    const f = await artwork();
    await t.db.query(`UPDATE story SET guardian_note = '감상평비밀' WHERE artwork_id = ?`, [f.id]); // D25: 보호자 감상평은 AI 입력에 넣지 않는다
    t.llm.replies = [OK()];
    const r = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: [' 파란색 '], selectedTags: ['바다'] }).expect(201);
    expect(r.body).toMatchObject({ source: 'llm', aiAuthored: true, edited: false, state: 'pending_approval', generationCount: 1 });
    // D34: 그린 날은 올리기 때 자동으로 채워져 함께 간다(허용 필드 — CaptionRequest '발언·나이·제작일은 서버가 채운다')
    expect(Object.keys(t.llm.calls[0]).sort()).toEqual(['ageAtMaking', 'keywords', 'madeOn', 'requestId', 'tags', 'words']);
    expect(t.llm.calls[0]).toMatchObject({ keywords: ['파란색'], tags: ['바다'], words: '엄마랑 바다 갔어', ageAtMaking: 5 });
    expect(JSON.stringify(t.llm.calls[0])).not.toContain('비밀제목');
    expect(JSON.stringify(t.llm.calls[0])).not.toContain('감상평비밀');
    expect(await job(f.id)).toMatchObject({ status: 'done', attempt_count: 1, downgrade_cause: null });
    const d = await f.a.get(`/v1/artworks/${f.id}`).expect(200);
    expect(d.body.caption.id).toBe(r.body.id);
    expect(d.body.tagCandidates).toEqual(['바다', '해']);
  });

  it('입력 없음 G14 422, 후보에 없는 태그 422, 여분 필드 422', async () => {
    const f = await artwork();
    const e = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['  '], selectedTags: [] }).expect(422);
    expect(e.body).toMatchObject({ reason: 'keywords_required', gate: 'G14' });
    const e2 = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: [], selectedTags: ['공룡'] }).expect(422);
    expect(e2.body.reason).toBe('tag_not_candidate');
    await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [], image: 'x' }).expect(422);
    expect(t.llm.calls).toHaveLength(0);
  });

  it('규칙 검사 반복 실패 → 템플릿(done_downgraded llm_to_template), 걸린 초안마다 실패 분류만', async () => {
    const f = await artwork();
    t.llm.replies = [OK({ source: 'template', body: '5살 때 그린 작품이에요. 바다을(를) 그렸어요.', generationCount: 3, failClasses: ['fail_event', 'fail_emotion', 'fail_emotion'] })];
    const r = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: [], selectedTags: ['바다'] }).expect(201);
    expect(r.body).toMatchObject({ source: 'template', aiAuthored: true, generationCount: 3 });
    expect(await job(f.id)).toMatchObject({ status: 'done_downgraded', downgrade_cause: 'llm_to_template' });
    const [fails] = await t.db.query(`SELECT failure_class FROM caption_check_failure ORDER BY failure_id`);
    expect((fails as { failure_class: string }[]).map((x) => x.failure_class)).toEqual(['event', 'emotion', 'emotion']);
  });

  it('다시 만들기는 이전 미승인 초안을 대체하고 생성 횟수를 누적(A1)', async () => {
    const f = await artwork();
    t.llm.replies = [OK({ generationCount: 2, failClasses: ['fail_event'] }), OK()];
    const a = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [] }).expect(201);
    const b = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [] }).expect(201);
    expect(b.body.generationCount).toBe(3);
    const [rows] = await t.db.query(`SELECT caption_id, status FROM caption WHERE artwork_id = ? ORDER BY caption_id`, [f.id]);
    expect(rows).toEqual([{ caption_id: Number(a.body.id), status: 'discarded' }, { caption_id: Number(b.body.id), status: 'pending' }]);
  });
});

describe('인프라·비활성(G13·G15, D1, BR-FBK-04)', () => {
  it('인프라 3회 소진 → 503 llm_unavailable, 두 번째 시도의 낮춤은 허용', async () => {
    const f = await artwork();
    t.llm.replies = [{ outcome: 'timeout' }, { outcome: 'engine_down' }, { outcome: 'engine_down' }];
    const e = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [] }).expect(503);
    expect(e.body).toMatchObject({ code: 'llm_unavailable', gate: 'G15' });
    expect(t.llm.calls).toHaveLength(3);
    expect(await job(f.id)).toMatchObject({ status: 'failed', attempt_count: 3, error_class: 'engine_down' });

    t.llm.calls = [];
    t.llm.replies = [{ outcome: 'timeout' }, OK({ source: 'template', generationCount: 3, failClasses: ['fail_event', 'fail_event', 'fail_event'] })];
    await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [] }).expect(201);
    expect(await job(f.id)).toMatchObject({ status: 'done_downgraded', attempt_count: 2, downgrade_cause: 'llm_to_template', error_class: null });
  });

  it('소진 뒤 보호자 선택 template은 LLM을 부르지 않고 단계 작업도 없음(낮춤률 제외), direct는 AI 작성 아님', async () => {
    const f = await artwork();
    const tp = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: ['바다'], fallback: 'template' }).expect(201);
    expect(tp.body).toMatchObject({ source: 'template', aiAuthored: true, body: '5살 때 그린 작품이에요. 해·바다을(를) 그렸어요.' });
    await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: [], selectedTags: [], fallback: 'direct' }).expect(422);
    const dr = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: [], selectedTags: [], fallback: 'direct', body: '우리 아이가 좋아한 바다' }).expect(201);
    expect(dr.body).toMatchObject({ source: 'direct', aiAuthored: false });
    expect(t.llm.calls).toHaveLength(0);
    expect(await job(f.id)).toBeUndefined();
  });

  it('M6 비활성이면 409 model_disabled G13(E4)', async () => {
    await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']);
    const f = await artwork();
    const e = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [] }).expect(409);
    expect(e.body).toMatchObject({ reason: 'model_disabled', gate: 'G13' });
    expect(t.llm.calls).toHaveLength(0);
  });
});

describe('수정·승인·고정(BR-CAP-04, D6)', () => {
  it('고치면 출처 유지·수정 표시, 승인 뒤 재생성·수정 409 caption_locked, 전시에 AI 작성으로', async () => {
    const f = await artwork();
    t.llm.replies = [OK()];
    const c = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [] }).expect(201);
    const e = await f.a.put(`/v1/artworks/${f.id}/captions/${c.body.id}`).send({ action: 'edit', body: '고친 문장' }).expect(200);
    expect(e.body).toMatchObject({ source: 'llm', edited: true, aiAuthored: true, body: '고친 문장' });
    const ap = await f.a.put(`/v1/artworks/${f.id}/captions/${c.body.id}`).send({ action: 'approve' }).expect(200);
    expect(ap.body.state).toBe('approved');
    const l1 = await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [] }).expect(409);
    expect(l1.body.reason).toBe('caption_locked');
    await f.a.put(`/v1/artworks/${f.id}/captions/${c.body.id}`).send({ action: 'edit', body: 'x' }).expect(409);
    await f.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: [], selectedTags: [], fallback: 'direct', body: 'y' }).expect(409);
  });

  it('다른 가족 작품은 404', async () => {
    const f = await artwork();
    const g = await familyWithChild(t, 'other@test.local');
    await g.a.post(`/v1/artworks/${f.id}/captions`).send({ keywords: ['해'], selectedTags: [] }).expect(404);
  });
});

describe('대기 요약(model-status)', () => {
  it('cold → warming, 대기 → busy, 모델 이름 없음', async () => {
    const f = await familyWithChild(t, 'ms@test.local');
    t.llm.readyBody = { model: { state: 'cold', maxObservedLoadSeconds: 13.5 }, queue: { waiting: 1 } };
    const r = await f.a.get('/v1/captions/model-status').expect(200);
    expect(r.body).toEqual({ warming: true, maxWaitSeconds: 13.5, busy: true });
    t.llm.readyBody = null;
    expect((await f.a.get('/v1/captions/model-status').expect(200)).body).toEqual({ warming: false, maxWaitSeconds: null, busy: false });
    await request(t.app).get('/v1/captions/model-status').expect(401);
  });
});
