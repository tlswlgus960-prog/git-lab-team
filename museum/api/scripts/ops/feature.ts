// 기능 설정 운영 CLI(T132, D10 · D22 ⑨ · G17) — 3D 노출은 서비스 운영자가 여기서만 켠다(화면·API 없음).
//   npm run ops:feature -- status  sculpture_exposure
//   npm run ops:feature -- enable  sculpture_exposure --by <운영자 이메일>   # M7 활성 버전이 없으면 거부
//   npm run ops:feature -- disable sculpture_exposure --by <운영자 이메일>
import { loadConfig } from '../../src/config.js';
import { createPool } from '../../src/db/pool.js';
import { FeatureSettingError, featureState, setFeature, type Feature } from '../../src/modules/admin/featureSetting.js';

const USAGE = '사용법: ops:feature status|enable|disable sculpture_exposure [--by <운영자 이메일>]';
const REASON: Record<string, string> = {
  not_operator: '서비스 운영자(정지되지 않은 operator 역할)만 바꿀 수 있어요',
  m7_not_active: 'M7(3D) 활성 버전이 없어요 — 평가 통과·승격 뒤에 켜요',
  unknown_feature: '없는 설정이에요(지금은 sculpture_exposure 하나)',
};
const [cmd, key, ...argv] = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };

async function main(): Promise<number> {
  if (!['status', 'enable', 'disable'].includes(cmd ?? '') || !key || (cmd !== 'status' && !arg('by'))) { console.error(USAGE); return 2; }
  const db = createPool(loadConfig().db);
  try {
    const s = cmd === 'status' ? await featureState(db, key as Feature) : await setFeature(db, key, cmd === 'enable', arg('by')!);
    console.log(`${s.key}: ${s.enabled ? '켜짐' : '꺼짐'} · 마지막 변경 ${s.changedAt ?? '없음'}${s.changedByMasked ? ` (${s.changedByMasked})` : ''} · M7 활성 ${s.m7Active ?? '없음'}`);
    return 0;
  } catch (e) {
    if (e instanceof FeatureSettingError) { console.error(`거절: ${REASON[e.message] ?? e.message}`); return 2; }
    throw e;
  } finally { await db.end(); }
}

main().then((c) => process.exit(c));
