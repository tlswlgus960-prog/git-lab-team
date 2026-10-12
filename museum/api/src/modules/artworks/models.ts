// 모델 활성 상태 조회 — 작업 생성 시 대표 모델 버전(stage-job §2), 확정 선택지 막기(unavailableChoices).
import type { Pool, PoolConnection } from 'mysql2/promise';

export const PRIMARY_MODEL: Record<string, string> = {
  split: 'M1', judge: 'M2', animate_render: 'M3', depth_relief: 'M5', sculpture: 'M7', caption: 'M6',
};
export const JUDGE_MODELS = ['M1', 'M2', 'M3'];

/** model_id → 활성·라이선스 확인 버전 id */
export async function activeVersions(db: Pool | PoolConnection): Promise<Map<string, number>> {
  const [rows] = await db.query(`SELECT model_id, version_id FROM model_version WHERE release_state = 'active' AND license_confirmed = TRUE`);
  return new Map((rows as { model_id: string; version_id: number }[]).map((r) => [r.model_id, Number(r.version_id)]));
}

export async function sculptureExposed(db: Pool | PoolConnection): Promise<boolean> {
  const [rows] = await db.query(`SELECT enabled FROM feature_setting WHERE setting_key = 'sculpture_exposure'`);
  return Boolean((rows as { enabled: number }[])[0]?.enabled);
}

export type ConfirmKind = 'animated' | 'relief' | 'frame' | 'sculpture';
export const KIND_MODEL: Record<ConfirmKind, string | null> = { animated: 'M3', relief: 'M5', frame: null, sculpture: 'M7' };

/** 확정 선택지: 허용 목록과 막힌 선택지(이유). 노출 꺼진 3D는 어디에도 싣지 않는다(D10). */
export async function confirmChoices(db: Pool | PoolConnection) {
  const active = await activeVersions(db);
  const kinds: ConfirmKind[] = ['animated', 'relief', 'frame'];
  if (await sculptureExposed(db)) kinds.push('sculpture');
  const choices: string[] = [];
  const unavailable: { choice: string; reason: 'model_disabled' }[] = [];
  for (const k of kinds) {
    const m = KIND_MODEL[k];
    if (m && !active.has(m)) unavailable.push({ choice: k, reason: 'model_disabled' });
    else choices.push(k);
  }
  return { choices, unavailable, active };
}
