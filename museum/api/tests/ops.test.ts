// US7 운영 시험(T108·T110·T143): UC8, FR-12·13·26, BR-OPS-01~04, BR-ACC-03·05, G1, SD_03 §19 #18.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { setStory, familyWithChild, png, seedModels, simulateResult, staff, upload } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; t.modelApi.list = null; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });

describe('생존·준비(FR-12)', () => {
  it('/live 200, /ready 익명은 상위 상태만, 팀원은 모델별 상태', async () => {
    await request(t.app).get('/live').expect(200, { status: 'live' });
    const anon = await request(t.app).get('/ready').expect(200);
    expect(anon.body).toEqual({ status: 'ready', anyLoading: false });
    const op = await staff(t, 'op@test.local', ['operator']);
    t.modelApi.list = [{ modelId: 'M5', load: { state: 'ready' }, hint: null }, { modelId: 'M1', load: { state: 'loading' }, hint: 'model_loading' }];
    const r = await op.a.get('/ready').expect(200);
    const st = Object.fromEntries(r.body.models.map((m: { modelId: string; state: string }) => [m.modelId, m.state]));
    expect(st).toMatchObject({ M1: 'not_ready', M4: 'ready', M5: 'cpu_fallback', M6: 'inactive_tier', M7: 'hidden', M2: 'unknown' });
    expect(r.body.anyLoading).toBe(true);
    expect(r.body.checks).toEqual({ db: true, queue: true, storage: true });
  });
});

describe('지표(FR-13·26, BR-OPS-02~04)', () => {
  async function scenario() {
    const f = await familyWithChild(t, 'm@test.local');
    const titles: string[] = [];
    for (const [kind, decision] of [['animated', 'like'], ['relief', 'frame'], ['animated', 'use_lower']] as const) {
      const r = await upload(f.a, f.childId, await png()).expect(202);
      const [mo] = await t.db.query(`INSERT INTO stored_object (owner_kind, family_id, artwork_id, object_kind, object_key)
        SELECT 'family', family_id, artwork_id, 'mask', CONCAT('family/x', artwork_id, '/mask/m.png') FROM artwork WHERE artwork_id = ?`, [r.body.id]);
      await t.db.query(`INSERT INTO judgment (artwork_id, split_ok, mask_object_id, suggestion, suggestion_state) VALUES (?, TRUE, ?, 'animated', 'presented')`,
        [r.body.id, (mo as { insertId: number }).insertId]);
      await f.a.post(`/v1/artworks/${r.body.id}/confirm`).send({ kind: kind === 'relief' ? 'relief' : 'animated' }).expect(200);
      await simulateResult(t.db, r.body.id, kind, { cause: kind === 'relief' ? 'guardian_choice' : null });
      await f.a.post(`/v1/artworks/${r.body.id}/decision`).send({ decision }).expect(200);
      titles.push(`비밀제목${r.body.id}`);
      await setStory(t.db, r.body.id, { title: titles.at(-1) }); // D46 시험 준비만 DB로
    }
    // 인프라 실패(저장소) 1건 — 모델 낮춤으로 섞이지 않아야 한다
    await t.db.query(`UPDATE stage_job SET error_class = 'storage', attempt_count = 2 WHERE stage_kind = 'split' LIMIT 1`);
    return { f, titles };
  }
  it('원인 5분류가 따로, 수정률·승인율·재시도율, 식별 정보 없음, 운영자만(G1)', async () => {
    const { titles } = await scenario();
    const op = await staff(t, 'op2@test.local', ['operator']);
    const m = await op.a.get('/v1/admin/metrics').expect(200);
    expect(m.body.service.firstApprovalRate).toBeCloseTo(1 / 3, 4); // MariaDB 나눗셈은 소수 5자리
    expect(m.body.service.suggestionModifyRate).toBeCloseTo(1 / 3, 4);
    expect(m.body.service).toMatchObject({ unreachedCount: 0, deletionIncompleteCount: 0 });
    expect(m.body.causes).toMatchObject({ guardianChoice: 0, guardianSwitch: 2, modelDowngrade: 0, infraFailure: { storage: 1 }, unreached: 0 });
    const m1 = m.body.models.find((x: { modelId: string }) => x.modelId === 'M1');
    expect(m1.retryRate).toBeGreaterThan(0);
    const text = JSON.stringify(m.body);
    for (const s of [...titles, 'm@test.local', '하늘', 'family/']) expect(text).not.toContain(s);
    // D21: 지표는 세 역할이 읽고(UC9 A1·UC11 A5), 결과 미도달 목록은 운영자 전용
    const ev = await staff(t, 'ev@test.local', ['evaluator']);
    expect((await ev.a.get('/v1/admin/metrics')).status).toBe(200);
    expect((await ev.a.get('/v1/admin/unreached')).status).toBe(403);
    const ig = await staff(t, 'ig-m@test.local', ['integrator']);
    expect((await ig.a.get('/v1/admin/metrics')).status).toBe(200);
    expect((await ig.a.get('/v1/admin/unreached')).status).toBe(403);
    expect((await request(t.app).get('/v1/admin/metrics')).status).toBe(401);
  });
  it('기간 필터: 전체를 덮는 기간은 뷰 결과와 같고, 지난 기간은 비어 있다(§19 #18)', async () => {
    await scenario();
    const op = await staff(t, 'op3@test.local', ['operator']);
    const allTime = (await op.a.get('/v1/admin/metrics').expect(200)).body;
    const covering = (await op.a.get('/v1/admin/metrics?from=2000-01-01T00:00:00Z&to=2999-01-01T00:00:00Z').expect(200)).body;
    expect(covering.service).toEqual(allTime.service);
    const past = (await op.a.get('/v1/admin/metrics?from=2000-01-01T00:00:00Z&to=2000-12-31T00:00:00Z').expect(200)).body;
    expect(past.service).toMatchObject({ firstApprovalRate: null, suggestionModifyRate: null });
  });
  it('결과 미도달 목록은 단계 작업 번호·모델·오류 분류만, /metrics 라벨은 허용 목록만', async () => {
    const f = await familyWithChild(t, 'u@test.local');
    const r = await upload(f.a, f.childId, await png()).expect(202);
    const [[v]] = (await t.db.query(`SELECT version_id FROM model_version WHERE model_id = 'M3'`)) as unknown as [{ version_id: number }[]];
    await t.db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count, error_class, started_at, finished_at)
                      VALUES (?, 'animate_render', 'confirm', 'cpu_vision', ?, 'failed', 3, 'engine_down', UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [r.body.id, v.version_id]);
    await t.db.query(`INSERT INTO artwork_outcome (artwork_id, confirmed_path, confirmed_at, result_cause) VALUES (?, 'animated', UTC_TIMESTAMP(), 'not_delivered')`, [r.body.id]);
    const op = await staff(t, 'op4@test.local', ['operator']);
    const u = await op.a.get('/v1/admin/unreached').expect(200);
    expect(u.body).toHaveLength(1);
    expect(Object.keys(u.body[0]).sort()).toEqual(['attempt', 'durationMs', 'errorClass', 'finishedAt', 'modelId', 'modelVersion', 'stage', 'stageJobId']);
    const text = (await request(t.app).get('/metrics').expect(200)).text;
    const labels = new Set([...text.matchAll(/\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((kv) => kv.split('=')[0])));
    for (const l of labels) expect(['model_id', 'model_version', 'serving_group', 'cause', 'error_class']).toContain(l);
    expect(text).toContain('uam_not_delivered_total 1');
  });
});

describe('모델 적재 상태(T143)', () => {
  it('운영 경로 프록시, M6 불러오기는 409, 역할(integrator 읽기·불러오기 불가)', async () => {
    t.modelApi.list = [{ modelId: 'M1', load: { state: 'loading', remainingSeconds: 12 }, hint: 'model_loading' }];
    const op = await staff(t, 'op5@test.local', ['operator']);
    expect((await op.a.get('/v1/ops/models').expect(200)).body.models).toHaveLength(1);
    await op.a.post('/v1/ops/models/M1/warmup').expect(202);
    expect((await op.a.post('/v1/ops/models/M6/warmup')).body.reason).toBe('m6_preload_at_start_only');
    const ig = await staff(t, 'ig@test.local', ['integrator']);
    await ig.a.get('/v1/ops/models').expect(200);
    expect((await ig.a.post('/v1/ops/models/M1/warmup')).status).toBe(403);
  });
  it('보호자 진행 응답: 대기 단계 모델이 적재 중이면 waitingForModel·etaSeconds만(모델 이름 없음)', async () => {
    t.modelApi.list = [{ modelId: 'M1', load: { state: 'loading', remainingSeconds: 12 }, hint: 'model_loading' }];
    const f = await familyWithChild(t, 'w@test.local');
    const r = await upload(f.a, f.childId, await png()).expect(202);
    const d = await f.a.get(`/v1/artworks/${r.body.id}`).expect(200);
    expect(d.body.stages[0]).toMatchObject({ stage: 'split', waitingForModel: true, etaSeconds: 12 });
    const noUrls = JSON.stringify({ ...d.body, originalUrl: null, cutoutUrl: null }); // 파일 토큰(무작위)에 우연히 'M1'이 섞일 수 있다
    expect(noUrls).not.toMatch(/"M\d"|model_loading|BiRefNet/);
  });
});
