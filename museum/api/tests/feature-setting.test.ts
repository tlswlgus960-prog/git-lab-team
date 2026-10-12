// T132 3D 노출 설정(D10 · D22 ⑨ · G17): 서비스 운영자만, M7 활성 버전 없이는 켜지 않음, 끄기는 언제나, 켜면 모델 목록(S11)의 노출 표시가 바뀐다.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { seedModels, staff } from './helpers/fixtures.js';
import { FeatureSettingError, featureState, setFeature } from '../src/modules/admin/featureSetting.js';

const t = testApp({ GPU_ENABLED: 'true' });
afterAll(async () => t.close());
beforeEach(async () => {
  await resetData(t.db);
  await t.db.query(`UPDATE feature_setting SET enabled = FALSE, changed_by = NULL, changed_at = NULL`);
});

describe('ops:feature sculpture_exposure (T132)', () => {
  it('운영자가 아니면 거절, M7 활성 버전이 없으면 켜기 거절(끄기는 됨)', async () => {
    await seedModels(t.db, ['M1', 'M5']);
    await staff(t, 'op@test.local', ['operator']);
    await staff(t, 'ev@test.local', ['evaluator']);
    await expect(setFeature(t.db, 'sculpture_exposure', true, 'ev@test.local')).rejects.toThrow(new FeatureSettingError('not_operator'));
    await expect(setFeature(t.db, 'sculpture_exposure', true, 'op@test.local')).rejects.toThrow('m7_not_active');
    await expect(setFeature(t.db, 'nope', true, 'op@test.local')).rejects.toThrow('unknown_feature');
    const off = await setFeature(t.db, 'sculpture_exposure', false, 'op@test.local');
    expect(off).toMatchObject({ enabled: false, changedByMasked: 'op***@test.local', m7Active: null });
  });
  it('M7 활성이면 켜지고 누가 언제 바꿨는지 남는다 — 모델 목록의 노출 표시도 바뀐다', async () => {
    await seedModels(t.db, ['M1', 'M5', 'M7']);
    await staff(t, 'op2@test.local', ['operator']);
    const on = await setFeature(t.db, 'sculpture_exposure', true, 'op2@test.local');
    expect(on).toMatchObject({ enabled: true, m7Active: 'v1', changedByMasked: 'op***@test.local' });
    expect(on.changedAt).not.toBeNull();
    const ev = (await staff(t, 'ev2@test.local', ['evaluator'])).a;
    const m7 = (await ev.get('/v1/admin/models').expect(200)).body.find((m: { modelId: string }) => m.modelId === 'M7');
    expect(m7.exposed).toBe(true);
    await setFeature(t.db, 'sculpture_exposure', false, 'op2@test.local');
    expect((await featureState(t.db, 'sculpture_exposure')).enabled).toBe(false);
  });
});
