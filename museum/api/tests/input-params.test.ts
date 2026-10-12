// 경로·쿼리 입력 공통 오류(contracts/openapi.yaml 머리말, 2026-09-30 API 서비스 점검표 계약 2·4·5행):
// 숫자 id·필수 쿼리·modelId 목록·날짜 쿼리가 틀리면 소유 확인·DB보다 먼저 422 invalid_param — 503·200으로 새지 않는다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { familyWithChild, seedModels, staff } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
let g: Awaited<ReturnType<typeof familyWithChild>>;
let s: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  await resetData(t.db); await seedModels(t.db, ['M1']);
  g = await familyWithChild(t, 'param@test.local');
  s = await staff(t, 'param-staff@test.local', ['operator', 'evaluator', 'integrator']);
});

const invalid = (name: string, reason: string) => (r: { status: number; body: Record<string, unknown> }) => {
  expect(r.status).toBe(422);
  expect(r.body).toMatchObject({ code: 'validation_failed', reason: 'invalid_param', fields: [{ name, reason }] });
};

describe('보호자 경로 — 숫자 id·쿼리', () => {
  const BAD = ['abc', '-1', '0', '1.5', '99999999999999999999'];
  it.each(BAD)('경로 id %s → 422 (503·404·200 아님)', async (bad) => {
    const cases: [string, string, string][] = [
      ['patch', `/v1/children/${bad}`, 'childId'], ['delete', `/v1/children/${bad}`, 'childId'],
      ['get', `/v1/children/${bad}/deletion`, 'childId'],
      ['get', `/v1/artworks/${bad}`, 'artworkId'], ['delete', `/v1/artworks/${bad}`, 'artworkId'],
      ['get', `/v1/artworks/${bad}/deletion`, 'artworkId'], ['post', `/v1/artworks/${bad}/confirm`, 'artworkId'],
      ['post', `/v1/artworks/${bad}/decision`, 'artworkId'], ['put', `/v1/artworks/${bad}/story`, 'artworkId'],
      ['post', `/v1/artworks/${bad}/captions`, 'artworkId'], ['put', `/v1/artworks/1/captions/${bad}`, 'captionId'],
      ['delete', `/v1/family/invites/${bad}`, 'inviteId'], ['delete', `/v1/family/members/${bad}`, 'memberId'],
    ];
    for (const [m, url, name] of cases) invalid(name, 'not_positive_integer')(await (g.a as any)[m](url).send({}));
  });
  it('GET /v1/gallery — child 없음 422 required, 숫자 아님 422, 날짜 형식 아님 422', async () => {
    invalid('child', 'required')(await g.a.get('/v1/gallery'));
    invalid('child', 'not_positive_integer')(await g.a.get('/v1/gallery?child=abc'));
    invalid('madeOn', 'not_date')(await g.a.get(`/v1/gallery?child=${g.childId}&madeOn=2026-13-45`));
    expect((await g.a.get(`/v1/gallery?child=${g.childId}&madeOn=2026-09-01`)).status).toBe(200);
  });
  it('GET /v1/artworks?child= — 선택 쿼리라도 값이 있으면 형식 검사', async () => {
    invalid('child', 'not_positive_integer')(await g.a.get('/v1/artworks?child=abc'));
    expect((await g.a.get('/v1/artworks')).status).toBe(200);
    expect((await g.a.get(`/v1/artworks?child=${g.childId}`)).status).toBe(200);
  });
  it('형식이 맞는 남의·없는 id는 그대로 404(존재 숨김, BR-ACC-01)', async () => {
    expect((await g.a.get('/v1/artworks/999999')).status).toBe(404);
    expect((await g.a.get('/v1/gallery?child=999999')).status).toBe(404);
  });
});

describe('운영 경로 — 숫자 id·modelId', () => {
  it('eval-runs·model-checks·test-call id 형식 → 422', async () => {
    invalid('runId', 'not_positive_integer')(await s.a.get('/v1/admin/eval-runs/abc'));
    invalid('runId', 'not_positive_integer')(await s.a.patch('/v1/admin/eval-runs/abc').send({ verdict: 'pass', rationale: 'x' }));
    invalid('checkId', 'not_positive_integer')(await s.a.get('/v1/ops/model-checks/abc'));
    invalid('jobId', 'not_positive_integer')(await s.a.get('/v1/admin/api-guide/test-call/abc'));
  });
  it('modelId 목록 밖 → 422 not_in_enum (warmup이 받아들이지 않는다)', async () => {
    invalid('modelId', 'not_in_enum')(await s.a.post('/v1/ops/models/X9/warmup'));
    invalid('modelId', 'not_in_enum')(await s.a.post('/v1/ops/models/X9/check').send({}));
    invalid('modelId', 'not_in_enum')(await s.a.post('/v1/admin/models/X9/deactivate').send({ reason: 'x' }));
  });
});
