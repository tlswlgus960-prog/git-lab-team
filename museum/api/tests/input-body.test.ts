// JSON 본문 공통 오류(contracts/openapi.yaml 머리말, 2026-09-30 API 서비스 점검표 계약 2·3행):
// 계약에 없는 칸은 조용히 버리지 않고 422 fields[{name, reason:'unrecognized'}], 본문 검사 실패는 503으로 번지지 않는다.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { PW, familyWithChild, png, seedModels, simulateResult, staff, upload } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
let g: Awaited<ReturnType<typeof familyWithChild>>;
let s: Awaited<ReturnType<typeof staff>>;
let art: string;
beforeAll(async () => {
  await resetData(t.db); await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']);
  g = await familyWithChild(t, 'body@test.local');
  art = (await upload(g.a, g.childId, await png()).expect(202)).body.id;
  await simulateResult(t.db, art, 'animated');
  s = await staff(t, 'body-staff@test.local', ['operator', 'evaluator', 'integrator']);
});

const unrecognized = (r: { status: number; body: Record<string, unknown> }) => {
  expect(r.status).toBe(422);
  expect(r.body).toMatchObject({ code: 'validation_failed', fields: expect.arrayContaining([expect.objectContaining({ name: 'extraField', reason: 'unrecognized' })]) });
};

describe('모르는 칸 → 422 unrecognized (조용히 버리지 않음)', () => {
  it('인증 경로', async () => {
    const anon = () => request(t.app);
    unrecognized(await anon().post('/v1/auth/signup').send({ email: 'n@test.local', password: PW, passwordConfirm: PW, extraField: 1 }));
    unrecognized(await anon().post('/v1/auth/email/verify/resend').send({ email: 'n@test.local', extraField: 1 }));
    unrecognized(await anon().post('/v1/auth/recovery').send({ email: 'n@test.local', extraField: 1 }));
    unrecognized(await anon().post('/v1/auth/login').send({ email: 'body@test.local', password: PW, extraField: 1 }));
    unrecognized(await anon().post('/v1/ops/auth/login').send({ email: 'body-staff@test.local', password: PW, extraField: 1 }));
    unrecognized(await g.a.post('/v1/auth/password').send({ currentPassword: PW, password: 'another-horse-2', passwordConfirm: 'another-horse-2', extraField: 1 }));
  });
  it('보호자 경로', async () => {
    unrecognized(await g.a.post('/v1/family/invites').send({ email: 'co@test.local', extraField: 1 }));
    unrecognized(await g.a.post(`/v1/artworks/${art}/decision`).send({ decision: 'like', extraField: 1 }));
    unrecognized(await g.a.post('/v1/children').send({ alias: '별이', extraField: 1 }));
  });
  it('운영 경로', async () => {
    unrecognized(await s.a.post('/v1/admin/models/M1/deactivate').send({ reason: '시험', extraField: 1 }));
    unrecognized(await s.a.post('/v1/admin/models/M1/rollback').send({ reason: '시험', extraField: 1 }));
    unrecognized(await s.a.post('/v1/admin/models/M1/evaluate').send({ versionId: '100', extraField: 1 }));
  });
});

describe('본문 검사 실패는 503이 아니라 422 + fields', () => {
  it.each([
    ['evaluate 빈 본문', '/v1/admin/models/M1/evaluate', {}, 'versionId'],
    ['evaluate 타입', '/v1/admin/models/M1/evaluate', { versionId: 12345 }, 'versionId'],
    ['promote 빈 본문', '/v1/admin/models/M1/promote', {}, 'versionId'],
    ['promote evalRunId 없음', '/v1/admin/models/M1/promote', { versionId: '100' }, 'evalRunId'],
    ['deactivate 사유 공백만', '/v1/admin/models/M1/deactivate', { reason: '   ' }, 'reason'],
    ['rollback 사유 공백만', '/v1/admin/models/M1/rollback', { reason: '   ' }, 'reason'],
  ])('%s', async (_n, url, body, field) => {
    const r = await s.a.post(url).send(body);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'validation_failed', fields: expect.arrayContaining([expect.objectContaining({ name: field })]) });
  });
});
