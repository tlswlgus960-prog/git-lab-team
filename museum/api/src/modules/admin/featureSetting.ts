// 기능 설정(3D 노출, D10 · D22 ⑨ · G17 · T132) — 운영 CLI(scripts/ops/feature.ts)가 부른다. 화면·HTTP 경로는 두지 않는다.
// 켜는 주체는 서비스 운영자(역할 operator, 정지되지 않음). M7 활성 버전(라이선스 확인)이 없으면 켜지 않는다 — 끄기는 언제나 된다.
// 읽는 쪽(확정 선택지·전시·준비 상태)은 요청마다 feature_setting을 읽으므로 다음 요청부터 반영된다.
import type { Pool } from 'mysql2/promise';

export const FEATURES = ['sculpture_exposure'] as const;
export type Feature = (typeof FEATURES)[number];

export class FeatureSettingError extends Error {}

export interface FeatureState { key: Feature; enabled: boolean; changedAt: string | null; changedByMasked: string | null; m7Active: string | null }

const mask = (e: string) => { const [u, d = ''] = e.split('@'); return `${u.slice(0, 2)}***@${d}`; };
const rows = async <T>(db: Pool, sql: string, p: unknown[] = []) => (await db.query(sql, p))[0] as T[];

async function operatorId(db: Pool, email: string): Promise<number> {
  const [m] = await rows<{ member_id: number }>(db,
    `SELECT t.member_id FROM team_member t JOIN team_member_role r ON r.member_id = t.member_id
      WHERE t.email = ? AND r.role = 'operator' AND t.disabled_at IS NULL`, [email.trim()]);
  if (!m) throw new FeatureSettingError('not_operator'); // 서비스 운영자만(D22 ⑨)
  return Number(m.member_id);
}

async function m7Active(db: Pool): Promise<string | null> {
  const [v] = await rows<{ version_label: string }>(db,
    `SELECT version_label FROM model_version WHERE model_id = 'M7' AND release_state = 'active' AND license_confirmed = TRUE`);
  return v?.version_label ?? null;
}

export async function featureState(db: Pool, key: Feature): Promise<FeatureState> {
  const [f] = await rows<{ enabled: number; changed_at: Date | null; email: string | null }>(db,
    `SELECT f.enabled, f.changed_at, t.email FROM feature_setting f LEFT JOIN team_member t ON t.member_id = f.changed_by WHERE f.setting_key = ?`, [key]);
  return { key, enabled: Boolean(f?.enabled), changedAt: f?.changed_at ? new Date(f.changed_at).toISOString() : null,
    changedByMasked: f?.email ? mask(f.email) : null, m7Active: await m7Active(db) };
}

export async function setFeature(db: Pool, key: string, enabled: boolean, byEmail: string): Promise<FeatureState> {
  if (!(FEATURES as readonly string[]).includes(key)) throw new FeatureSettingError('unknown_feature');
  const by = await operatorId(db, byEmail);
  if (enabled && key === 'sculpture_exposure' && !(await m7Active(db))) throw new FeatureSettingError('m7_not_active'); // 승격 전에는 켜지 않는다
  await db.query(
    `INSERT INTO feature_setting (setting_key, enabled, changed_by, changed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), changed_by = VALUES(changed_by), changed_at = VALUES(changed_at)`,
    [key, enabled, by]);
  return featureState(db, key as Feature);
}
