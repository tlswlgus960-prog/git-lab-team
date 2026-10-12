// US5·sweeper 시험(T097·T033·T099): UC7, FR-10·11, G18·G19, BR-DEL-01~05, D4, stage-job §3·§4.3, BR-PRC-05.
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { familyWithChild, png, seedModels, simulateResult, upload } from './helpers/fixtures.js';
import { processDeletions } from '../src/sweeper/deletion.js';
import { takeOver, takeOverExternal } from '../src/sweeper/takeover.js';
import { LocalFsDriver } from '../src/storage/LocalFsDriver.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });
const q = async <T>(sql: string, p: unknown[] = []) => (await t.db.query(sql, p))[0] as T[];
const sweep = () => processDeletions(t.db, t.storage, t.store);

async function processingArtwork(email: string) {
  const f = await familyWithChild(t, email);
  const r = await upload(f.a, f.childId, await png()).expect(202);
  await simulateResult(t.db, r.body.id, 'animated');
  const [o] = await q<{ object_key: string }>(`SELECT so.object_key FROM artwork_original ao JOIN stored_object so ON so.object_id = ao.object_id WHERE ao.artwork_id = ?`, [r.body.id]);
  fs.mkdirSync(path.join(t.store, path.dirname(o.object_key.replace('/original/', '/mask/'))), { recursive: true });
  // 워커가 depth_relief를 실행 중인 상태(Scenario 11)
  const [[v]] = (await t.db.query(`SELECT version_id FROM model_version WHERE model_id = 'M5'`)) as unknown as [{ version_id: number }[]];
  await t.db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count, claimed_by, claim_expires_at, started_at)
                    VALUES (?, 'depth_relief', 'use_lower', 'gpu', ?, 'running', 1, 'w1', UTC_TIMESTAMP() + INTERVAL 60 SECOND, UTC_TIMESTAMP())`, [r.body.id, v.version_id]);
  await t.db.query(`UPDATE artwork SET status = 'processing' WHERE artwork_id = ?`, [r.body.id]);
  return { ...f, id: r.body.id as string, originalKey: o.object_key };
}

describe('작품 삭제(UC7, Scenario 11)', () => {
  it('202 → 목록에서 즉시 사라짐 → 실행 중 작업이 멈출 때까지 보류(G19) → 파일·기록 삭제, 집계만 남음', async () => {
    const f = await processingArtwork('del1@test.local');
    await f.a.delete(`/v1/artworks/${f.id}`).expect(202);
    expect((await f.a.get('/v1/artworks')).body).toEqual([]);
    expect((await f.a.get(`/v1/artworks/${f.id}`)).status).toBe(404);
    expect(await q(`SELECT status FROM stage_job WHERE status = 'running' AND cancel_requested_at IS NOT NULL`)).toHaveLength(1);
    await sweep();
    expect(await q(`SELECT status FROM deletion_request`)).toEqual([{ status: 'waiting_stop' }]);
    expect(await q(`SELECT gate_id FROM gate_event WHERE gate_id = 'G19' AND released_at IS NULL`)).toHaveLength(1);
    // 워커가 취소를 감지하고 멈춤
    await t.db.query(`UPDATE stage_job SET status = 'cancelled', stopped_at = CURRENT_TIMESTAMP WHERE status = 'running'`);
    await sweep();
    expect(await q(`SELECT status, artwork_id, child_id FROM deletion_request`)).toEqual([{ status: 'completed', artwork_id: null, child_id: null }]);
    expect(await q(`SELECT * FROM artwork`)).toHaveLength(0);
    expect(await q(`SELECT * FROM stored_object`)).toHaveLength(0);
    expect(fs.existsSync(path.join(t.store, f.originalKey))).toBe(false);
    const left = await q<{ artwork_id: number | null }>(`SELECT artwork_id FROM stage_job`);
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((j) => j.artwork_id === null)).toBe(true);
    expect(await q(`SELECT artwork_id, result_kind FROM artwork_outcome`)).toEqual([{ artwork_id: null, result_kind: 'animated' }]);
    expect(await q(`SELECT * FROM gate_event WHERE subject_kind = 'artwork' AND subject_id IS NOT NULL`)).toHaveLength(0);
  });
  it('점유가 만료된 실행 중 작업은 30초 뒤 강제로 멈춘 것으로 보고 삭제를 끝낸다', async () => {
    const f = await processingArtwork('del2@test.local');
    await f.a.delete(`/v1/artworks/${f.id}`).expect(202);
    await t.db.query(`UPDATE stage_job SET claim_expires_at = UTC_TIMESTAMP() - INTERVAL 40 SECOND WHERE status = 'running'`);
    await sweep();
    expect((await q<{ status: string }>(`SELECT status FROM deletion_request`))[0].status).toBe('completed');
  });
  it('저장소 삭제 실패는 1·5분 뒤 재시도, 세 번째 실패면 incomplete(BR-DEL-03)', async () => {
    const f = await processingArtwork('del3@test.local');
    await f.a.delete(`/v1/artworks/${f.id}`).expect(202);
    await t.db.query(`UPDATE stage_job SET status = 'cancelled', stopped_at = CURRENT_TIMESTAMP WHERE status = 'running'`);
    const broken = new (class extends LocalFsDriver { async delete() { throw new Error('storage down'); } })(t.store);
    for (let i = 1; i <= 3; i++) {
      await t.db.query(`UPDATE deletion_request SET requested_at = CURRENT_TIMESTAMP - INTERVAL 10 MINUTE`);
      await processDeletions(t.db, broken, t.store);
    }
    expect(await q(`SELECT status, file_retry_count, artwork_id FROM deletion_request`)).toEqual([{ status: 'incomplete', file_retry_count: 3, artwork_id: null }]);
    expect((await q<{ n: number }>(`SELECT deletion_incomplete_count n FROM v_metrics_service`))[0].n).toBe(1);
  });
  it('아이 삭제: 작품을 모두 지운 뒤 아이를 지운다(UC7 A1), 목록에서 즉시 사라짐', async () => {
    const f = await familyWithChild(t, 'del4@test.local');
    await upload(f.a, f.childId, await png()).expect(202);
    await upload(f.a, f.childId, await png()).expect(202);
    await f.a.delete(`/v1/children/${f.childId}`).expect(202);
    expect((await f.a.get('/v1/children')).body).toEqual([]);
    await sweep();
    await sweep();
    expect(await q(`SELECT * FROM child`)).toHaveLength(0);
    expect(await q(`SELECT * FROM artwork`)).toHaveLength(0);
    expect(await q<{ target_kind: string; status: string }>(`SELECT target_kind, status FROM deletion_request ORDER BY deletion_id`))
      .toEqual([{ target_kind: 'artwork', status: 'completed' }, { target_kind: 'artwork', status: 'completed' }, { target_kind: 'child', status: 'completed' }]);
  });
  it('다른 가족 작품·아이 삭제는 404, 비로그인은 401(BR-ACC-04)', async () => {
    const A = await processingArtwork('del5@test.local');
    const B = await familyWithChild(t, 'del6@test.local');
    expect((await B.a.delete(`/v1/artworks/${A.id}`)).status).toBe(404);
    expect((await B.a.delete(`/v1/children/${A.childId}`)).status).toBe(404);
    expect((await request(t.app).delete(`/v1/artworks/${A.id}`)).status).toBe(401);
  });
});

describe('이어받기(BR-PRC-05, stage-job §4.3)', () => {
  const running = async (email: string, stage: string, origin: string, attempt: number) => {
    const f = await familyWithChild(t, email);
    const r = await upload(f.a, f.childId, await png()).expect(202);
    await t.db.query(`UPDATE stage_job SET status = 'done' WHERE artwork_id = ?`, [r.body.id]);
    const model = { judge: 'M2', animate_render: 'M3', depth_relief: 'M5', split: 'M1' }[stage]!;
    const [[v]] = (await t.db.query(`SELECT version_id FROM model_version WHERE model_id = ?`, [model])) as unknown as [{ version_id: number }[]];
    await t.db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count, claimed_by, claim_expires_at)
                      VALUES (?, ?, ?, 'cpu_vision', ?, 'running', ?, 'w1', UTC_TIMESTAMP() - INTERVAL 5 SECOND)`, [r.body.id, stage, origin, v.version_id, attempt]);
    return r.body.id as string;
  };
  it('외부 작업 점유 만료: 3회 미만 queued, 3회째 failed(stage-job §9)', async () => {
    await t.db.query(`INSERT INTO api_key (key_id, key_kind, key_hash) VALUES (900, 'team_internal', REPEAT('9', 64))`);
    const [[v]] = (await t.db.query(`SELECT version_id FROM model_version WHERE model_id = 'M1'`)) as unknown as [{ version_id: number }[]];
    for (const [id, n] of [[901, 1], [902, 3]]) {
      await t.db.query(`INSERT INTO external_job (ext_job_id, key_id, func, model_version_id, status, attempt_count, claimed_by, claim_expires_at)
                        VALUES (?, 900, 'segment', ?, 'running', ?, 'w1', UTC_TIMESTAMP() - INTERVAL 5 SECOND)`, [id, v.version_id, n]);
    }
    expect(await takeOverExternal(t.db)).toBe(2);
    expect(await q(`SELECT ext_job_id, status, error_class FROM external_job ORDER BY ext_job_id`)).toEqual([
      { ext_job_id: 901, status: 'queued', error_class: 'engine_down' }, { ext_job_id: 902, status: 'failed', error_class: 'engine_down' }]);
    await t.db.query(`DELETE FROM external_job`); await t.db.query(`DELETE FROM api_key`);
  });
  it('시도가 남으면 retry_wait(engine_down)', async () => {
    await running('to1@test.local', 'split', 'intake', 1);
    await takeOver(t.db);
    expect(await q(`SELECT status, error_class FROM stage_job WHERE claimed_by IS NULL AND attempt_count = 1`)).toEqual([{ status: 'retry_wait', error_class: 'engine_down' }]);
  });
  it('판정 3회 소진: 제안 없음·확정 대기(G7)', async () => {
    const id = await running('to2@test.local', 'judge', 'intake', 3);
    await takeOver(t.db);
    expect(await q(`SELECT suggestion_state FROM judgment WHERE artwork_id = ?`, [id])).toEqual([{ suggestion_state: 'exhausted' }]);
    expect(await q(`SELECT status FROM artwork WHERE artwork_id = ?`, [id])).toEqual([{ status: 'awaiting_confirm' }]);
  });
  it('결과 단계 3회 소진: 처리하지 못함·결과 미도달(G9), use_lower 소진은 확인 대기로 복귀(H6)', async () => {
    const id = await running('to3@test.local', 'animate_render', 'confirm', 3);
    await t.db.query(`UPDATE artwork SET status = 'processing' WHERE artwork_id = ?`, [id]);
    await takeOver(t.db);
    expect(await q(`SELECT status FROM artwork WHERE artwork_id = ?`, [id])).toEqual([{ status: 'failed' }]);
    expect(await q(`SELECT result_cause FROM artwork_outcome WHERE artwork_id = ?`, [id])).toEqual([{ result_cause: 'not_delivered' }]);
    const id2 = await running('to4@test.local', 'depth_relief', 'use_lower', 3);
    await t.db.query(`UPDATE artwork SET status = 'processing' WHERE artwork_id = ?`, [id2]);
    await takeOver(t.db);
    expect(await q(`SELECT status FROM artwork WHERE artwork_id = ?`, [id2])).toEqual([{ status: 'awaiting_review' }]);
  });
  it('판정 소진 뒤 잠긴 확정 작업을 연다 — relief + 분리 실패면 split_fail·frame_compose(stage-job §2)', async () => {
    const f = await familyWithChild(t, 'to5@test.local');
    const r = await upload(f.a, f.childId, await png()).expect(202);
    await f.a.post(`/v1/artworks/${r.body.id}/confirm`).send({ kind: 'relief' }).expect(200);
    await t.db.query(`UPDATE stage_job SET status = 'running', attempt_count = 3, claimed_by = 'w', claim_expires_at = UTC_TIMESTAMP() - INTERVAL 5 SECOND
                      WHERE artwork_id = ? AND stage_kind = 'judge'`, [r.body.id]);
    await takeOver(t.db);
    expect(await q(`SELECT stage_kind, status, downgrade_cause, origin FROM stage_job WHERE artwork_id = ? AND stage_kind IN ('depth_relief','frame_compose') ORDER BY job_id`, [r.body.id]))
      .toEqual([{ stage_kind: 'depth_relief', status: 'done_downgraded', downgrade_cause: 'split_fail', origin: 'confirm' },
                { stage_kind: 'frame_compose', status: 'queued', downgrade_cause: null, origin: 'downgrade' }]);
  });
  it('삭제 중 작품의 만료 작업은 cancelled', async () => {
    const id = await running('to6@test.local', 'split', 'intake', 1);
    await t.db.query(`UPDATE artwork SET status = 'deleting', deleting_since = CURRENT_TIMESTAMP WHERE artwork_id = ?`, [id]);
    await takeOver(t.db);
    expect(await q(`SELECT status FROM stage_job WHERE artwork_id = ? AND claimed_by IS NULL AND attempt_count = 1`, [id])).toEqual([{ status: 'cancelled' }]);
  });
});
