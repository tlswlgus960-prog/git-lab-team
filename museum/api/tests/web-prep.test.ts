// D21 웹 구현 전 보완 시험(T146·T147): 팀원 세션 API, 삭제 진행 조회. SD_02 §2-1 · C9 · S9, UC7, G19, BR-ACC-01.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { familyWithChild, png, seedModels, staff, upload } from './helpers/fixtures.js';
import { processDeletions } from '../src/sweeper/deletion.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });
const sweep = () => processDeletions(t.db, t.storage, t.store);

describe('팀원 세션(T146, C9)', () => {
  it('GET /v1/ops/me는 역할과 가린 계정을 돌려주고, 로그아웃 뒤에는 401', async () => {
    const s = await staff(t, 'evalop@test.local', ['evaluator', 'operator']);
    const me = await s.a.get('/v1/ops/me').expect(200);
    expect(me.body.roles.sort()).toEqual(['evaluator', 'operator']);
    expect(me.body.emailMasked).toBe('ev***@test.local');
    await s.a.post('/v1/ops/auth/logout').expect(204);
    expect((await s.a.get('/v1/ops/me')).status).toBe(401);
  });
  it('세션 없이 로그아웃해도 204, /v1/ops/me는 401', async () => {
    await request(t.app).post('/v1/ops/auth/logout').expect(204);
    expect((await request(t.app).get('/v1/ops/me')).status).toBe(401);
  });
  it('보호자 쿠키로는 /v1/ops/me를 열 수 없다', async () => {
    const f = await familyWithChild(t, 'g-ops@test.local');
    expect((await f.a.get('/v1/ops/me')).status).toBe(401);
  });
});

describe('삭제 진행 조회(T147, S9)', () => {
  it('작품: 접수 → G19 보류 → 끝남(done), 다른 가족·없는 번호는 늘 done', async () => {
    const f = await familyWithChild(t, 'dp1@test.local');
    const r = await upload(f.a, f.childId, await png()).expect(202);
    const id = r.body.id as string;
    expect((await f.a.get(`/v1/artworks/${id}/deletion`).expect(200)).body).toEqual({ state: 'done', gate: null }); // 삭제 요청 전
    // 실행 중 작업이 있는 상태에서 삭제
    const [[v]] = (await t.db.query(`SELECT version_id FROM model_version WHERE model_id = 'M1'`)) as unknown as [{ version_id: number }[]];
    await t.db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count, claimed_by, claim_expires_at, started_at)
                      VALUES (?, 'split', 'intake', 'cpu_vision', ?, 'running', 1, 'w1', UTC_TIMESTAMP() + INTERVAL 60 SECOND, UTC_TIMESTAMP())`, [id, v.version_id]);
    await f.a.delete(`/v1/artworks/${id}`).expect(202);
    expect((await f.a.get(`/v1/artworks/${id}/deletion`).expect(200)).body).toEqual({ state: 'accepted', gate: null });
    await sweep();
    expect((await f.a.get(`/v1/artworks/${id}/deletion`).expect(200)).body).toEqual({ state: 'waiting_stop', gate: 'G19' });
    const other = await familyWithChild(t, 'dp1-other@test.local');
    expect((await other.a.get(`/v1/artworks/${id}/deletion`).expect(200)).body).toEqual({ state: 'done', gate: null }); // 존재 비노출
    await t.db.query(`UPDATE stage_job SET status = 'cancelled', stopped_at = CURRENT_TIMESTAMP WHERE status = 'running'`);
    await sweep();
    expect((await f.a.get(`/v1/artworks/${id}/deletion`).expect(200)).body).toEqual({ state: 'done', gate: null });
    expect((await f.a.get('/v1/artworks/999999/deletion').expect(200)).body).toEqual({ state: 'done', gate: null });
  });
  it('삭제 미완료(incomplete)도 진행 목록에서 빠져 done — 미완료 안내는 운영 경로 몫(S9, UC7)', async () => {
    const f = await familyWithChild(t, 'dp3@test.local');
    const id = (await upload(f.a, f.childId, await png()).expect(202)).body.id as string;
    await f.a.delete(`/v1/artworks/${id}`).expect(202);
    expect((await f.a.get(`/v1/artworks/${id}/deletion`).expect(200)).body.state).not.toBe('done');
    // sweeper가 파일 삭제 재시도를 다 쓰면 하는 처리와 같게(sweeper/deletion.ts — 끝난 삭제는 연결을 끊는다, BR-DEL-02)
    await t.db.query(`UPDATE deletion_request SET status = 'incomplete', artwork_id = NULL, child_id = NULL, completed_at = CURRENT_TIMESTAMP WHERE target_kind = 'artwork' AND artwork_id = ?`, [id]);
    expect((await f.a.get(`/v1/artworks/${id}/deletion`).expect(200)).body).toEqual({ state: 'done', gate: null });
  });
  it('아이: 작품 삭제가 남아 있으면 진행 중, 모두 끝나면 done', async () => {
    const f = await familyWithChild(t, 'dp2@test.local');
    await upload(f.a, f.childId, await png()).expect(202);
    await f.a.delete(`/v1/children/${f.childId}`).expect(202);
    const mid = (await f.a.get(`/v1/children/${f.childId}/deletion`).expect(200)).body;
    expect(['accepted', 'deleting_files']).toContain(mid.state);
    for (let i = 0; i < 3; i++) await sweep();
    expect((await f.a.get(`/v1/children/${f.childId}/deletion`).expect(200)).body).toEqual({ state: 'done', gate: null });
  });
  it('세션 없으면 401', async () => {
    expect((await request(t.app).get('/v1/artworks/1/deletion')).status).toBe(401);
  });
});
