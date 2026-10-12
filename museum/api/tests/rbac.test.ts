// RBAC(D24, T158~T160): 권한 정본(policy.ts) · 계약(x-permission·보안 범위) · 실제 응답(역할별 허용·거부)을 대조하고,
// 팀원 관리(역할 부여·회수·정지·비밀번호)와 보호자 비밀번호 변경(UC14 A5)을 확인한다. G1 · BR-ACC-05.
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { parse } from 'yaml';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { STAFF_POLICY, permissionsOf, type StaffPermission } from '../src/auth/policy.js';
import { StaffAdminError, addStaff, disableStaff, enableStaff, grantRole, listStaff, revokeRole, setStaffPassword } from '../src/auth/staffAdmin.js';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { PW, familyWithChild, seedModels, staff } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });

const ROLES = ['operator', 'evaluator', 'integrator'] as const;

describe('권한 정본과 계약이 같다(D24 ②)', () => {
  const spec = parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'contracts', 'openapi.yaml'), 'utf8')) as {
    paths: Record<string, Record<string, { security?: Record<string, string[]>[]; 'x-permission'?: string }>>;
  };
  const staffOps = Object.entries(spec.paths).flatMap(([p, ops]) => Object.entries(ops)
    .filter(([m, o]) => ['get', 'post', 'put', 'patch', 'delete'].includes(m) && o.security?.some((s) => 'staffSession' in s))
    .map(([m, o]) => ({ op: `${m.toUpperCase()} ${p}`, scopes: o.security!.find((s) => 'staffSession' in s)!.staffSession, perm: o['x-permission'] })));

  it('역할을 거는 팀원 경로는 모두 x-permission이 있고, 보안 범위가 정본의 역할과 같다', () => {
    const roleChecked = staffOps.filter((o) => o.scopes.length > 0);
    expect(roleChecked.length).toBeGreaterThan(15);
    for (const o of roleChecked) {
      expect(o.perm, `${o.op}: x-permission 없음`).toBeDefined();
      expect(Object.keys(STAFF_POLICY), `${o.op}: 정본에 없는 권한 ${o.perm}`).toContain(o.perm);
      expect([...o.scopes].sort(), o.op).toEqual([...STAFF_POLICY[o.perm as StaffPermission]].sort());
    }
  });

  it('역할 없는 팀원 경로는 로그아웃뿐이다', () => {
    expect(staffOps.filter((o) => o.scopes.length === 0).map((o) => o.op)).toEqual(['POST /v1/ops/auth/logout']);
  });

  it('SD_02 §2-1 표: 운영자는 모든 권한(2026-09-30 이제민), 미도달은 운영자만, 평가·승격은 운영자·평가 담당, API활용에 평가 담당 없음', () => {
    expect(permissionsOf(['operator'])).toEqual(Object.keys(STAFF_POLICY));
    expect(permissionsOf(['evaluator'])).toEqual(expect.arrayContaining(['models.manage', 'models.warmup']));
    expect(permissionsOf(['evaluator'])).not.toContain('apiGuide.use');
    expect(permissionsOf(['integrator'])).toEqual(expect.arrayContaining(['metrics.read', 'models.read', 'apiGuide.use']));
    expect(permissionsOf(['integrator'])).not.toContain('models.warmup');
    expect(STAFF_POLICY['unreached.read']).toEqual(['operator']);
  });
});

describe('역할별 허용·거부가 정본대로 동작한다(G1)', () => {
  // 권한마다 대표 요청 하나. 허용이면 401·403이 아니어야 하고(본문 결과는 다른 시험 몫), 거부면 403 role_missing.
  const probe: Partial<Record<StaffPermission, (a: ReturnType<typeof request.agent>) => request.Test>> = {
    'staff.me': (a) => a.get('/v1/ops/me'),
    'metrics.read': (a) => a.get('/v1/admin/metrics'),
    'unreached.read': (a) => a.get('/v1/admin/unreached'),
    'models.read': (a) => a.get('/v1/admin/models'),
    'models.warmup': (a) => a.post('/v1/ops/models/M1/warmup'),
    'models.manage': (a) => a.get('/v1/admin/eval-runs/999999'),
    'apiGuide.use': (a) => a.get('/v1/admin/api-guide/spec'),
    'models.check': (a) => a.post('/v1/ops/models/M1/check').send({}), // D20
    'models.check.read': (a) => a.get('/v1/ops/model-checks'),
  };
  it('운영자 한 역할로 평가·승격 경로(models.manage)가 막히지 않는다(403 아님)', async () => {
    const s = await staff(t, 'op-all@rbac.test', ['operator']);
    expect((await s.a.get('/v1/admin/eval-runs/999999')).status).not.toBe(403);
    expect((await s.a.get('/v1/admin/eval-items')).status).not.toBe(403);
  });
  for (const role of ROLES) {
    it(`${role} 한 역할만 가진 팀원`, async () => {
      const s = await staff(t, `${role}@rbac.test`, [role]);
      for (const perm of Object.keys(probe) as StaffPermission[]) {
        const res = await probe[perm]!(s.a);
        const allowed = (STAFF_POLICY[perm] as readonly string[]).includes(role);
        if (allowed) expect([401, 403], `${role} ${perm} → ${res.status}`).not.toContain(res.status);
        else { expect(res.status, `${role} ${perm}`).toBe(403); expect(res.body.reason).toBe('role_missing'); }
      }
    });
  }
  it('보호자 세션으로 팀원 경로 → 401(쿠키가 다르다, BR-ACC-03)', async () => {
    const f = await familyWithChild(t, 'g@rbac.test');
    await f.a.get('/v1/admin/metrics').expect(401);
    await f.a.get('/v1/ops/me').expect(401);
  });
});

describe('팀원 관리 CLI 동작(D24 ③)', () => {
  it('역할 회수·부여는 다음 요청부터, 정지는 세션까지 끊는다', async () => {
    const s = await staff(t, 'op2@rbac.test', ['operator']);
    await s.a.get('/v1/admin/unreached').expect(200);
    await revokeRole(t.db, 'op2@rbac.test', 'operator');
    expect((await s.a.get('/v1/admin/unreached').expect(403)).body.reason).toBe('role_missing');
    await grantRole(t.db, 'op2@rbac.test', 'operator');
    await s.a.get('/v1/admin/unreached').expect(200);
    await disableStaff(t.db, 'op2@rbac.test');
    await s.a.get('/v1/admin/unreached').expect(401);
    await request(t.app).post('/v1/ops/auth/login').send({ email: 'op2@rbac.test', password: PW }).expect(401);
    await enableStaff(t.db, 'op2@rbac.test');
    await request(t.app).post('/v1/ops/auth/login').send({ email: 'op2@rbac.test', password: PW }).expect(200);
  });

  it('비밀번호 변경은 기존 세션을 지우고 새 비밀번호로만 들어간다', async () => {
    const s = await staff(t, 'ev@rbac.test', ['evaluator']);
    await setStaffPassword(t.db, 'ev@rbac.test', 'new-staff-pass-1');
    await s.a.get('/v1/ops/me').expect(401);
    await request(t.app).post('/v1/ops/auth/login').send({ email: 'ev@rbac.test', password: PW }).expect(401);
    await request(t.app).post('/v1/ops/auth/login').send({ email: 'ev@rbac.test', password: 'new-staff-pass-1' }).expect(200);
  });

  it('추가·목록(이메일은 가림)·잘못된 입력 거절', async () => {
    const id = await addStaff(t.db, 'new@rbac.test', ['integrator', 'operator'], 'staff-pass-12');
    expect(await listStaff(t.db)).toContainEqual({ memberId: id, emailMasked: 'ne***@rbac.test', roles: ['integrator', 'operator'], disabled: false });
    await expect(addStaff(t.db, 'x@rbac.test', ['admin'], 'staff-pass-12')).rejects.toBeInstanceOf(StaffAdminError);
    await expect(addStaff(t.db, 'y@rbac.test', ['operator'], 'short')).rejects.toThrow('password_too_short');
    await expect(grantRole(t.db, 'nobody@rbac.test', 'operator')).rejects.toThrow('staff_not_found');
  });
});

describe('보호자 비밀번호 변경(UC14 A5, D24 ④)', () => {
  it('바꾸면 다른 기기는 끊기고 이 기기는 로그인 유지, 새 비밀번호로만 로그인', async () => {
    const f = await familyWithChild(t, 'pw@rbac.test');
    const other = request.agent(t.app);
    await other.post('/v1/auth/login').send({ email: 'pw@rbac.test', password: PW }).expect(204);
    await other.get('/v1/me').expect(200);
    await f.a.post('/v1/auth/password').send({ currentPassword: PW, password: 'brand-new-pass-9', passwordConfirm: 'brand-new-pass-9' }).expect(204);
    await f.a.get('/v1/me').expect(200);
    await f.a.get('/v1/children').expect(200);
    await other.get('/v1/me').expect(401);
    await request(t.app).post('/v1/auth/login').send({ email: 'pw@rbac.test', password: PW }).expect(401);
    await request(t.app).post('/v1/auth/login').send({ email: 'pw@rbac.test', password: 'brand-new-pass-9' }).expect(204);
  });

  it('현재 비밀번호가 틀리면 422 current_password_mismatch이고 바뀌지 않는다', async () => {
    const f = await familyWithChild(t, 'pw2@rbac.test');
    const r = await f.a.post('/v1/auth/password').send({ currentPassword: 'wrong-pass-00', password: 'brand-new-pass-9', passwordConfirm: 'brand-new-pass-9' }).expect(422);
    expect(r.body.reason).toBe('current_password_mismatch');
    await f.a.get('/v1/me').expect(200);                                   // 틀려도 로그아웃시키지 않는다
    await request(t.app).post('/v1/auth/login').send({ email: 'pw2@rbac.test', password: PW }).expect(204);
  });

  it('새 비밀번호 규칙·확인 불일치는 422, 로그인 안 한 요청은 401', async () => {
    const f = await familyWithChild(t, 'pw3@rbac.test');
    await f.a.post('/v1/auth/password').send({ currentPassword: PW, password: 'short', passwordConfirm: 'short' }).expect(422);
    await f.a.post('/v1/auth/password').send({ currentPassword: PW, password: 'brand-new-pass-9', passwordConfirm: 'different-pass-9' }).expect(422);
    await request(t.app).post('/v1/auth/password').send({ currentPassword: PW, password: 'brand-new-pass-9', passwordConfirm: 'brand-new-pass-9' }).expect(401);
  });
});
