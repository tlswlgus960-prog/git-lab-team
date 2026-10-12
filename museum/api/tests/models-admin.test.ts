// US8 모델 관리 시험(T113·T115·T116): UC9, FR-16·17·24, G20~G22, BR-MDL-03·04·07, D5, clarify 비활성화.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { png, seedModels, staff } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), D = 'd'.repeat(64);
const writeManifest = (m: Record<string, { w: string; c: string; lic: boolean }>) => fs.writeFileSync(path.join(t.cfg.storageRoot, 'manifest.yaml'),
  'models:\n' + Object.entries(m).map(([k, v]) => `  ${k}:\n    weights_sha256: "${v.w}"\n    config_hash: "${v.c}"\n    license_confirmed: ${v.lic}\n`).join(''));

beforeEach(async () => {
  await resetData(t.db);
  await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']);
  writeManifest({ M5: { w: C, c: D, lic: true } });
});

async function evaluator() { return (await staff(t, `ev${Math.random()}@test.local`, ['evaluator'])).a; }
async function addItems(a: Awaited<ReturnType<typeof evaluator>>, n = 2) {
  for (let i = 0; i < n; i++) {
    await a.post('/v1/admin/eval-items').field('category', 'non_person').field('expectedPath', 'relief').field('makerAttested', 'true')
      .attach('photo', await png(), 'e.png').expect(201);
  }
}
async function candidate(a: Awaited<ReturnType<typeof evaluator>>, label = 'v2') {
  const r = await a.post('/v1/admin/models/M5/versions').send({ version: label, weightsSha256: C, runtime: 'transformers-4.44 mps', imageDigest: A, configHash: D, device: 'gpu' }).expect(201);
  return r.body.id as string;
}
const finish = async (evalId: string, status = 'done') => {
  await t.db.query(`INSERT INTO eval_item_result (evaluation_id, item_id, status, result_path) SELECT evaluation_id, eval_item_id, ?, 'relief' FROM stage_job WHERE evaluation_id = ?`, [status, evalId]);
};

describe('매니페스트·후보 등록(FR-24, BR-MDL-07)', () => {
  it('목록은 M1~M7, 등록한 후보는 candidate이고 라이선스는 매니페스트 원천', async () => {
    const a = await evaluator();
    const list = await a.get('/v1/admin/models').expect(200);
    expect(list.body.map((m: { modelId: string }) => m.modelId)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']);
    const r = await a.post('/v1/admin/models/M5/versions').send({ version: 'v2', weightsSha256: C, runtime: 'x', imageDigest: A, configHash: D, device: 'gpu' }).expect(201);
    expect(r.body).toMatchObject({ releaseState: 'candidate', licenseConfirmed: true, weightsSha256: C });
    await a.post('/v1/admin/models/M5/versions').send({ version: 'v2', weightsSha256: C, runtime: 'x', imageDigest: A, configHash: D, device: 'gpu' }).expect(409);
    const r2 = await a.post('/v1/admin/models/M1/versions').send({ version: 'v2', weightsSha256: C, runtime: 'x', imageDigest: A, configHash: D, device: 'cpu' }).expect(201);
    expect(r2.body.licenseConfirmed).toBe(false);
  });
  it('운영자는 모든 권한 — 조회와 등록 모두(등록 본문이 틀리면 403이 아니라 422, 2026-09-30 이제민)', async () => {
    const op = (await staff(t, 'op@test.local', ['operator'])).a;
    await op.get('/v1/admin/models').expect(200);
    await op.post('/v1/admin/models/M5/versions').send({}).expect(422);
  });
  it('연동 개발은 조회만, 등록은 403', async () => {
    const ig = (await staff(t, 'ig@test.local', ['integrator'])).a;
    await ig.get('/v1/admin/models').expect(200);
    await ig.post('/v1/admin/models/M5/versions').send({}).expect(403);
  });
});

describe('평가 항목(G20, BR-MDL-04)', () => {
  it('팀원 제작 확인 없으면 422와 G20 기록, 사진은 평가 묶음 소유', async () => {
    const a = await evaluator();
    const bad = await a.post('/v1/admin/eval-items').field('category', 'person').field('expectedPath', 'animated').attach('photo', await png(), 'e.png').expect(422);
    expect(bad.body.gate).toBe('G20');
    const [[g]] = (await t.db.query(`SELECT COUNT(*) n FROM gate_event WHERE gate_id = 'G20'`)) as unknown as [{ n: number }[]];
    expect(Number(g.n)).toBe(1);
    await addItems(a, 1);
    await a.post('/v1/admin/eval-items').field('category', 'caption_input').field('expectedPath', 'caption').field('makerAttested', 'true').field('inputText', '해가 웃어요').expect(201);
    const [objs] = await t.db.query(`SELECT owner_kind, object_kind, object_key FROM stored_object`);
    expect(objs).toHaveLength(1);
    expect((objs as { owner_kind: string; object_key: string }[])[0]).toMatchObject({ owner_kind: 'eval_set', object_kind: 'eval_input' });
    expect((objs as { object_key: string }[])[0].object_key).toMatch(/^evalset\//);
    const list = await a.get('/v1/admin/eval-items').expect(200);
    expect(list.body.map((i: { kind: string }) => i.kind)).toEqual(['non_person', 'caption_input']);
  });
});

describe('평가 → 판단 → 승격 → 롤백 → 비활성화(G21·G22, D5)', () => {
  it('해시 불일치면 G21 409, 일치하면 항목마다 eval 작업', async () => {
    const a = await evaluator();
    await addItems(a, 2);
    const vid = await candidate(a);
    writeManifest({ M5: { w: A, c: D, lic: true } });
    const bad = await a.post('/v1/admin/models/M5/evaluate').send({ versionId: vid }).expect(409);
    expect(bad.body).toMatchObject({ gate: 'G21', reason: 'hash_mismatch' });
    writeManifest({ M5: { w: C, c: D, lic: true } });
    const ev = await a.post('/v1/admin/models/M5/evaluate').send({ versionId: vid }).expect(202);
    expect(ev.body).toMatchObject({ itemTotal: 2, doneCount: 0, eligible: false, verdict: null });
    // 새로 고친 뒤에도 이어 가도록 매니페스트에 가장 최근 평가 기록 번호가 실린다(ModelVersion.latestEvalRunId)
    const man = (await a.get('/v1/admin/models').expect(200)).body as { modelId: string; versions: { id: string; latestEvalRunId: string | null }[] }[];
    expect(man.find((m) => m.modelId === 'M5')!.versions.find((v) => v.id === String(vid))!.latestEvalRunId).toBe(String(ev.body.id));
    const [jobs] = await t.db.query(`SELECT origin, stage_kind, priority, artwork_id FROM stage_job WHERE evaluation_id = ?`, [ev.body.id]);
    expect(jobs).toEqual([{ origin: 'eval', stage_kind: 'depth_relief', priority: 50, artwork_id: null }, { origin: 'eval', stage_kind: 'depth_relief', priority: 50, artwork_id: null }]);
  });

  it('M3는 사람 항목만 평가 대상(D51) — 없으면 409 no_eval_items, M5는 사진 항목 전체', async () => {
    const a = await evaluator();
    await addItems(a, 2); // 비인물 2
    await t.db.query(`UPDATE model_version SET weights_sha256 = ?, config_hash = ? WHERE model_id = 'M3'`, [A, B]);
    writeManifest({ M3: { w: A, c: B, lic: true }, M5: { w: C, c: D, lic: true } });
    const [[m3]] = (await t.db.query(`SELECT version_id FROM model_version WHERE model_id = 'M3' LIMIT 1`)) as unknown as [{ version_id: number }[]];
    const none = await a.post('/v1/admin/models/M3/evaluate').send({ versionId: String(m3.version_id) }).expect(409);
    expect(none.body).toMatchObject({ gate: 'G21', reason: 'no_eval_items' });
    await a.post('/v1/admin/eval-items').field('category', 'person').field('expectedPath', 'animated').field('makerAttested', 'true')
      .attach('photo', await png(), 'p.png').expect(201);
    const ev = await a.post('/v1/admin/models/M3/evaluate').send({ versionId: String(m3.version_id) }).expect(202);
    expect(ev.body.itemTotal).toBe(1);
    const all5 = await a.post('/v1/admin/models/M5/evaluate').send({ versionId: await candidate(a) }).expect(202);
    expect(all5.body.itemTotal).toBe(3);
  });

  it('평가 기록의 기대 경로는 그 모델 기준(D57) — M5는 항목 기대 animated를 relief로, 원래 값은 itemExpectedPath', async () => {
    const a = await evaluator();
    await a.post('/v1/admin/eval-items').field('category', 'person').field('expectedPath', 'animated').field('makerAttested', 'true')
      .attach('photo', await png(), 'p.png').expect(201);
    const ev = (await a.post('/v1/admin/models/M5/evaluate').send({ versionId: await candidate(a) }).expect(202)).body.id as string;
    await finish(ev);
    const run = (await a.get(`/v1/admin/eval-runs/${ev}`).expect(200)).body;
    expect(run.results[0]).toMatchObject({ expectedPath: 'relief', itemExpectedPath: 'animated', actualPath: 'relief' });
  });

  it('미완료 항목이 있으면 승격 막힘, 전부 완료·통과면 승격하고 직전 활성은 롤백 후보', async () => {
    const a = await evaluator();
    await addItems(a, 2);
    const vid = await candidate(a);
    const ev = (await a.post('/v1/admin/models/M5/evaluate').send({ versionId: vid }).expect(202)).body.id as string;
    await a.patch(`/v1/admin/eval-runs/${ev}`).send({ verdict: 'pass' }).expect(422);
    await a.patch(`/v1/admin/eval-runs/${ev}`).send({ verdict: 'pass', rationale: '기대 경로 일치' }).expect(200);
    const blocked = await a.post('/v1/admin/models/M5/promote').send({ versionId: vid, evalRunId: ev }).expect(409);
    expect(blocked.body).toMatchObject({ gate: 'G22', reason: 'promotion_not_eligible' });
    await finish(ev);
    expect((await a.get(`/v1/admin/eval-runs/${ev}`).expect(200)).body).toMatchObject({ doneCount: 2, eligible: true });
    const p = await a.post('/v1/admin/models/M5/promote').send({ versionId: vid, evalRunId: ev }).expect(200);
    const st = Object.fromEntries(p.body.versions.map((v: { version: string; releaseState: string }) => [v.version, v.releaseState]));
    expect(st).toEqual({ v1: 'rollback_candidate', v2: 'active' });

    // 롤백: 사유 필수, 즉시 전환(재평가 없음), 되돌린 버전은 retired
    await a.post('/v1/admin/models/M5/rollback').send({}).expect(422);
    const rb = await a.post('/v1/admin/models/M5/rollback').send({ reason: 'quality_regression' }).expect(200);
    expect(Object.fromEntries(rb.body.versions.map((v: { version: string; releaseState: string }) => [v.version, v.releaseState]))).toEqual({ v1: 'active', v2: 'retired' });
    const e8 = await a.post('/v1/admin/models/M5/rollback').send({ reason: 'again' }).expect(409);
    expect(e8.body.reason).toBe('no_rollback_candidate');

    // 비활성화: 활성 → retired, 이후 없음이면 409
    const d = await a.post('/v1/admin/models/M5/deactivate').send({ reason: 'license_issue' }).expect(200);
    expect(d.body.versions.every((v: { releaseState: string }) => v.releaseState === 'retired')).toBe(true);
    await a.post('/v1/admin/models/M5/deactivate').send({ reason: 'x' }).expect(409);
    const [ev2] = await t.db.query(`SELECT kind, reason FROM release_event ORDER BY event_id`);
    expect(ev2).toEqual([{ kind: 'promote', reason: null }, { kind: 'rollback', reason: 'quality_regression' }, { kind: 'deactivate', reason: 'license_issue' }]);
  });

  it('라이선스 미확인 후보는 승격 막힘(BR-MDL-07)', async () => {
    const a = await evaluator();
    writeManifest({ M5: { w: C, c: D, lic: false } });
    await addItems(a, 1);
    const vid = await candidate(a);
    const ev = (await a.post('/v1/admin/models/M5/evaluate').send({ versionId: vid }).expect(202)).body.id as string;
    await finish(ev);
    await a.patch(`/v1/admin/eval-runs/${ev}`).send({ verdict: 'pass', rationale: 'ok' }).expect(200);
    const r = await a.post('/v1/admin/models/M5/promote').send({ versionId: vid, evalRunId: ev }).expect(409);
    expect(r.body).toMatchObject({ gate: 'G22', reason: 'license_unconfirmed' });
  });
});
