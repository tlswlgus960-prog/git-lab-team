// 모델 점검 시험(D20, FR-33, UC8 A8·E7, UC9 A7, SD_01 7.8~7.10, G30, BR-OPS-05·06).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { png, seedModels, staff } from './helpers/fixtures.js';

const t = testApp({ MODEL_CHECK_ENABLED: 'true' });
const off = testApp(); // 점검 실행기 배포 전(기본 꺼짐)
afterAll(async () => { await t.close(); await off.close(); });

beforeEach(async () => {
  await resetData(t.db);
  await seedModels(t.db, ['M1', 'M5']); // M2·M3·M7은 후보(라이선스 확인 전)
});

type Agent = Awaited<ReturnType<typeof staff>>['a'];
const role = async (r: string, app = t) => (await staff(app, `${r}${Math.random()}@test.local`, [r])).a;
async function item(a: Agent, category = 'non_person', expectedPath = 'relief') {
  const r = await a.post('/v1/admin/eval-items').field('category', category).field('expectedPath', expectedPath).field('makerAttested', 'true')
    .attach('photo', await png(), 'e.png').expect(201);
  return r.body.id as string;
}
const q = async <T>(sql: string, p: unknown[] = []) => (await t.db.query(sql, p))[0] as T[];

describe('점검 요청(7.8)', () => {
  it('활성 버전·평가 묶음 사진 한 장으로 점검 작업 1건(origin check, 우선순위 30)을 등록한다', async () => {
    const ev = await role('evaluator');
    const it1 = await item(ev);
    const r = await ev.post('/v1/ops/models/M1/check').send({}).expect(202);
    expect(r.body).toMatchObject({ modelId: 'M1', versionLabel: 'v1', releaseState: 'active', evalItemId: it1, status: 'queued', outcome: null });
    const jobs = await q<{ origin: string; priority: number; stage_kind: string; artwork_id: number | null; eval_item_id: number }>(
      `SELECT origin, priority, stage_kind, artwork_id, eval_item_id FROM stage_job WHERE model_check_id = ?`, [r.body.id]);
    expect(jobs).toEqual([{ origin: 'check', priority: 30, stage_kind: 'split', artwork_id: null, eval_item_id: Number(it1) }]);
  });
  it('라이선스 확인 전 후보 버전도 점검한다(활성화 아님), M3는 사람 항목을 먼저 고른다', async () => {
    const ev = await role('evaluator');
    await item(ev);
    const person = await item(ev, 'person', 'animated');
    const r = await ev.post('/v1/ops/models/M3/check').send({}).expect(202);
    expect(r.body).toMatchObject({ releaseState: 'candidate', evalItemId: person });
  });
  it('운영자도 실행, 연동 개발은 403', async () => {
    const ev = await role('evaluator');
    await item(ev);
    await (await role('operator')).post('/v1/ops/models/M1/check').send({}).expect(202);
    await (await role('integrator')).post('/v1/ops/models/M5/check').send({}).expect(403);
  });
  it('같은 모델 점검이 진행 중이면 409 check_in_progress', async () => {
    const ev = await role('evaluator');
    await item(ev);
    await ev.post('/v1/ops/models/M1/check').send({}).expect(202);
    const r = await ev.post('/v1/ops/models/M1/check').send({}).expect(409);
    expect(r.body.reason).toBe('check_in_progress');
  });
  it('M4는 rule_not_checked, M6은 m6_check_p05', async () => {
    const ev = await role('evaluator');
    expect((await ev.post('/v1/ops/models/M4/check').send({}).expect(409)).body.reason).toBe('rule_not_checked');
    expect((await ev.post('/v1/ops/models/M6/check').send({}).expect(409)).body.reason).toBe('m6_check_p05');
  });
  it('실행기 배포 전(MODEL_CHECK_ENABLED 꺼짐)은 503 check_runner_missing, 작업을 만들지 않는다', async () => {
    const a = await role('operator', off);
    const r = await a.post('/v1/ops/models/M1/check').send({}).expect(503);
    expect(r.body.reason).toBe('check_runner_missing');
    expect(await q(`SELECT 1 FROM stage_job WHERE origin = 'check'`)).toEqual([]);
  });
});

describe('G30 점검 입력(E7)', () => {
  it('평가 묶음 사진이 없으면 409 no_check_sample, M7은 입체 항목만', async () => {
    const ev = await role('evaluator');
    let r = await ev.post('/v1/ops/models/M1/check').send({}).expect(409);
    expect(r.body).toMatchObject({ reason: 'no_check_sample', gate: 'G30' });
    await item(ev);
    r = await ev.post('/v1/ops/models/M7/check').send({}).expect(409);
    expect(r.body.reason).toBe('no_check_sample');
    const sc = await item(ev, 'sculpture', 'sculpture');
    expect((await ev.post('/v1/ops/models/M7/check').send({}).expect(202)).body.evalItemId).toBe(sc);
    const [[g]] = (await t.db.query(`SELECT COUNT(*) n FROM gate_event WHERE gate_id = 'G30'`)) as unknown as [{ n: number }[]];
    expect(Number(g.n)).toBe(2);
  });
  it('모델에 맞지 않는 항목 지정은 422 not_check_sample, 폐기 버전은 409 version_retired, 없는 버전은 404', async () => {
    const ev = await role('evaluator');
    const photo = await item(ev);
    expect((await ev.post('/v1/ops/models/M7/check').send({ evalItemId: photo }).expect(422)).body).toMatchObject({ reason: 'not_check_sample', gate: 'G30' });
    await ev.post('/v1/ops/models/M1/check').send({ evalItemId: '99999' }).expect(422);
    await t.db.query(`UPDATE model_version SET release_state = 'retired' WHERE model_id = 'M2'`);
    const [v] = await q<{ version_id: number }>(`SELECT version_id FROM model_version WHERE model_id = 'M2'`);
    expect((await ev.post('/v1/ops/models/M2/check').send({ versionId: String(v.version_id) }).expect(409)).body.reason).toBe('version_retired');
    await ev.post('/v1/ops/models/M1/check').send({ versionId: String(v.version_id) }).expect(404); // 다른 모델의 버전
  });
});

describe('점검 결과(7.10)', () => {
  it('워커가 쓴 결과를 폴링으로 본다 — 점수 없음, 모델별 최근 점검, /ready lastCheck', async () => {
    const ev = await role('evaluator');
    await item(ev);
    const id = (await ev.post('/v1/ops/models/M1/check').send({}).expect(202)).body.id;
    await t.db.query(`UPDATE model_check SET status='passed', outcome='quality_below', processing_ms=1234, memory_mb=900,
                        started_at=CURRENT_TIMESTAMP, finished_at=CURRENT_TIMESTAMP WHERE check_id = ?`, [id]);
    const intg = await role('integrator');
    const r = await intg.get(`/v1/ops/model-checks/${id}`).expect(200);
    expect(r.body).toMatchObject({ status: 'passed', outcome: 'quality_below', failReason: null, processingMs: 1234, memoryMb: 900 });
    expect(r.body).not.toHaveProperty('score');
    const list = await intg.get('/v1/ops/model-checks').expect(200);
    expect(list.body.checks.map((c: { modelId: string }) => c.modelId)).toEqual(['M1']);
    const ready = await intg.get('/ready');
    const m1 = ready.body.models.find((m: { modelId: string }) => m.modelId === 'M1');
    expect(m1.lastCheck).toMatchObject({ status: 'passed', failReason: null });
    expect(ready.body.models.find((m: { modelId: string }) => m.modelId === 'M5').lastCheck).toBeNull();
    await intg.get('/v1/ops/model-checks/424242').expect(404);
  });
  it('15분 넘게 시작하지 못한 점검은 조회 때 model_not_ready로 닫고 작업을 취소한다', async () => {
    const ev = await role('evaluator');
    await item(ev);
    const id = (await ev.post('/v1/ops/models/M1/check').send({}).expect(202)).body.id;
    await t.db.query(`UPDATE model_check SET requested_at = CURRENT_TIMESTAMP - INTERVAL 20 MINUTE WHERE check_id = ?`, [id]);
    const r = await ev.get(`/v1/ops/model-checks/${id}`).expect(200);
    expect(r.body).toMatchObject({ status: 'failed', failReason: 'model_not_ready' });
    expect(await q(`SELECT status FROM stage_job WHERE model_check_id = ?`, [id])).toEqual([{ status: 'cancelled' }]);
    await ev.post('/v1/ops/models/M1/check').send({}).expect(202); // 닫힌 뒤 새 점검
  });
  it('점검 작업은 운영 지표에 들어가지 않고(BR-OPS-05), 모델마다 최근 20건만 남는다', async () => {
    const ev = await role('evaluator');
    await item(ev);
    for (let i = 0; i < 22; i++) {
      const id = (await ev.post('/v1/ops/models/M1/check').send({}).expect(202)).body.id;
      await t.db.query(`UPDATE stage_job SET status='failed', error_class='timeout', started_at=CURRENT_TIMESTAMP, finished_at=CURRENT_TIMESTAMP WHERE model_check_id = ?`, [id]);
      await t.db.query(`UPDATE model_check SET status='failed', fail_reason='timeout', finished_at=CURRENT_TIMESTAMP WHERE check_id = ?`, [id]);
    }
    expect(await q(`SELECT COUNT(*) n FROM model_check WHERE model_id = 'M1'`)).toEqual([{ n: 20 }]);
    expect(await q(`SELECT COUNT(*) n FROM stage_job WHERE origin = 'check'`)).toEqual([{ n: 20 }]);
    const m = await ev.get('/v1/admin/metrics').expect(200);
    expect(m.body.models).toEqual([]);
    expect(m.body.causes.infraFailure).toEqual({});
  });
});

describe('이어받기', () => {
  it('점유가 만료된 점검 작업은 재시도하지 않고 engine_down 실패로 닫는다', async () => {
    const { takeOver } = await import('../src/sweeper/takeover.js');
    const ev = await role('evaluator');
    await item(ev);
    const id = (await ev.post('/v1/ops/models/M1/check').send({}).expect(202)).body.id;
    await t.db.query(`UPDATE stage_job SET status='running', attempt_count=1, claimed_by='w', started_at=UTC_TIMESTAMP(),
                        claim_expires_at=UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE model_check_id = ?`, [id]);
    await t.db.query(`UPDATE model_check SET status='running', started_at=CURRENT_TIMESTAMP WHERE check_id = ?`, [id]);
    await takeOver(t.db);
    expect(await q(`SELECT status, error_class FROM stage_job WHERE model_check_id = ?`, [id])).toEqual([{ status: 'failed', error_class: 'engine_down' }]);
    expect((await ev.get(`/v1/ops/model-checks/${id}`).expect(200)).body).toMatchObject({ status: 'failed', failReason: 'engine_down' });
  });
});
