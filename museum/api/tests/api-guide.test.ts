// US9 B 시험(T123·T124): 'API활용' 명세·버전 대조·시험 호출(G23, BR-API-07~09), 키 발급 CLI(R-09, D17).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { png, seedModels, staff } from './helpers/fixtures.js';

// 가짜 model-api: 명세·외부 작업
const seen: { key?: string; fn?: string; bytes?: number }[] = [];
let specUp = true;
const fake = express();
fake.get('/v1/models/openapi.json', (_q, s) => (specUp ? s.json({ openapi: '3.1.0', info: { title: 'm', 'x-model-versions': { M1: 'v1', M5: 'v0' } }, paths: { '/v1/models/{function}': {} } }) : s.sendStatus(500)));
fake.post('/v1/models/:fn', express.raw({ type: '*/*', limit: '30mb' }), (q, s) => {
  seen.push({ key: q.header('x-api-key'), fn: q.params.fn, bytes: (q.body as Buffer).length });
  if (q.params.fn === 'pose') return s.status(429).set('Retry-After', '30').json({ code: 'rate_limited' });
  s.status(202).json({ jobId: '42', function: q.params.fn, status: 'queued' });
});
fake.get('/v1/models/jobs/:id', (q, s) => s.json({ jobId: q.params.id, function: 'segment', status: 'done', outcome: 'ok', model: { id: 'M1', version: 'v1' } }));
const srv = http.createServer(fake).listen(0, '127.0.0.1');
const port = () => (srv.address() as { port: number }).port;

let t: ReturnType<typeof testApp>;
beforeAll(async () => {
  await new Promise((r) => srv.once('listening', r).listening && r(null));
  t = testApp({ MODEL_API_INTERNAL_URL: `http://127.0.0.1:${port()}`, API_GUIDE_TEST_KEY: 'uam_testkey' });
});
afterAll(async () => { await t.close(); srv.close(); });
beforeEach(async () => { await resetData(t.db); seen.length = 0; specUp = true; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });

describe('명세(R-11, BR-API-07·08)', () => {
  it('/openapi.json 공개, 4묶음·버전 대조, 못 읽으면 마지막 명세와 stale', async () => {
    const o = await request(t.app).get('/openapi.json').expect(200);
    expect(o.body.paths['/v1/gallery']).toBeTruthy();
    const it1 = (await staff(t, 'i@test.local', ['integrator'])).a;
    const r = await it1.get('/v1/admin/api-guide/spec').expect(200);
    expect(r.body.groups.map((g: { name: string }) => g.name)).toEqual(['보호자 앱', '운영', '관리', '모델 기능']);
    expect(Object.keys(r.body.groups[0].spec.paths)).toContain('/v1/auth/signup');
    expect(Object.keys(r.body.groups[2].spec.paths)).toContain('/v1/admin/models');
    expect(r.body.versionCheck).toEqual([
      { modelId: 'M1', specVersion: 'v1', activeVersion: 'v1', match: true },
      { modelId: 'M5', specVersion: 'v0', activeVersion: 'v1', match: false },
    ]);
    expect(r.body.stale).toBe(false);
    specUp = false;
    const s = await it1.get('/v1/admin/api-guide/spec').expect(200);
    expect(s.body).toMatchObject({ stale: true, fetchedAt: r.body.fetchedAt });
    expect(s.body.groups[3].spec.paths).toBeTruthy();
  });
  it('평가 담당만인 계정은 403', async () => {
    await (await staff(t, 'e@test.local', ['evaluator'])).a.get('/v1/admin/api-guide/spec').expect(403);
  });
});

describe('시험 호출(G23, BR-API-09)', () => {
  it('평가 묶음 사진만 test 키로 전달, 그 밖은 422 G23, 거절은 그대로 전달', async () => {
    const ev = (await staff(t, 'ev@test.local', ['evaluator'])).a;
    await ev.post('/v1/admin/eval-items').field('category', 'person').field('expectedPath', 'animated').field('makerAttested', 'true').attach('photo', await png(), 'e.png').expect(201);
    await ev.post('/v1/admin/eval-items').field('category', 'caption_input').field('expectedPath', 'caption').field('makerAttested', 'true').field('inputText', '해').expect(201);
    const [items] = await t.db.query(`SELECT item_id, category FROM eval_item ORDER BY item_id`);
    const [photo, text] = items as { item_id: number }[];
    const op = (await staff(t, 'op@test.local', ['operator'])).a;

    const ok = await op.post('/v1/admin/api-guide/test-call').send({ function: 'segment', evalItemId: String(photo.item_id) }).expect(202);
    expect(ok.body.status).toBe('queued');
    expect(seen[0]).toMatchObject({ key: 'uam_testkey', fn: 'segment' });
    expect(seen[0].bytes).toBeGreaterThan(100);
    const st = await op.get(`/v1/admin/api-guide/test-call/${ok.body.jobId}`).expect(200);
    expect(st.body).toMatchObject({ status: 'done', model: { id: 'M1' } });

    for (const bad of [{ function: 'segment', evalItemId: String(text.item_id) }, { function: 'segment', evalItemId: '999' }, { function: 'segment', artworkId: '1' }]) {
      const e = await op.post('/v1/admin/api-guide/test-call').send(bad).expect(422);
      expect(e.body).toMatchObject({ reason: 'not_eval_item', gate: 'G23' });
    }
    const lim = await op.post('/v1/admin/api-guide/test-call').send({ function: 'pose', evalItemId: String(photo.item_id) }).expect(429);
    expect(lim.headers['retry-after']).toBe('30');
    const [[g]] = (await t.db.query(`SELECT COUNT(*) n FROM gate_event WHERE gate_id = 'G23'`)) as unknown as [{ n: number }[]];
    expect(Number(g.n)).toBe(3);
  });
});

describe('키 발급 CLI(T123)', () => {
  const run = (...a: string[]) => promisify(execFile)(path.resolve('node_modules/.bin/tsx'), ['scripts/ops/key.ts', ...a],
    { env: { ...process.env, DB_SOCKET: inject('DB_SOCKET'), DB_USER: 'root', DB_NAME: 'uam_test', DB_PASSWORD: '' } });
  it('원문은 한 번만 출력, 해시만 저장, external 거부, 폐기', async () => {
    const out = (await run('issue', '--kind', 'test')).stdout;
    const raw = out.match(/uam_[A-Za-z0-9_-]{43}/)![0];
    const [rows] = await t.db.query(`SELECT key_id, key_kind, key_hash, status FROM api_key`);
    const k = (rows as { key_id: number; key_kind: string; key_hash: string; status: string }[])[0];
    expect(k).toMatchObject({ key_kind: 'test', status: 'active', key_hash: createHash('sha256').update(raw).digest('hex') });
    await expect(run('issue', '--kind', 'external')).rejects.toBeTruthy();
    await run('revoke', '--id', String(k.key_id));
    const list = (await run('list')).stdout;
    expect(list).toContain('revoked');
    expect(list).not.toContain(raw);
  }, 30_000);
});

describe('model-api 연결 실패', () => {
  const down = testApp({ MODEL_API_INTERNAL_URL: 'http://127.0.0.1:9', API_GUIDE_TEST_KEY: 'k' });
  afterAll(async () => down.close());
  it('시험 호출 503 model_api_unreachable', async () => {
    await resetData(down.db);
    const op = (await staff(down, 'op2@test.local', ['operator'])).a;
    const r = await op.get('/v1/admin/api-guide/test-call/42').expect(503);
    expect(r.body.reason).toBe('model_api_unreachable');
  });
});
