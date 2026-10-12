import sharp from 'sharp';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { tokenOf } from './app.js';

export const PW = 'correct-horse-1';
export const png = () => sharp({ create: { width: 32, height: 32, channels: 3, background: '#88aaee' } }).png().toBuffer();
export const jpg = () => sharp({ create: { width: 32, height: 32, channels: 3, background: '#ee8844' } }).jpeg().toBuffer();

/** 가입·확인한 보호자 agent와 아이 하나 */
export async function familyWithChild(t: { app: import("node:http").Server; mailer: { sent: { link?: string }[] } }, email: string) {
  await request(t.app).post('/v1/auth/signup').send({ email, password: PW, passwordConfirm: PW }).expect(202);
  const a = request.agent(t.app);
  await a.post('/v1/auth/email/verify').send({ token: tokenOf(t.mailer.sent.at(-1)!.link) }).expect(204);
  const c = await a.post('/v1/children').send({ alias: '하늘' }).expect(201);
  return { a, childId: c.body.id as string };
}

/** 모델 버전 시드: 활성(라이선스 확인)으로 둘 모델 목록 */
export async function seedModels(db: Pool, activeModels: string[]) {
  await db.query('DELETE FROM model_version');
  let id = 100;
  for (const m of ['M1', 'M2', 'M3', 'M5', 'M6', 'M7']) {
    const on = activeModels.includes(m);
    await db.query(`INSERT INTO model_version (version_id, model_id, version_label, weights_sha256, config_hash, license_confirmed, release_state)
                    VALUES (?, ?, 'v1', REPEAT('a',64), REPEAT('b',64), ?, ?)`, [id++, m, on, on ? 'active' : 'candidate']);
  }
}

export const upload = (a: ReturnType<typeof request.agent>, childId: string, buf: Buffer, key = randomUUID(), name = 'p.png') =>
  a.post('/v1/artworks').set('Idempotency-Key', key).field('childId', childId).attach('photo', buf, name);

const STAGE: Record<string, [string, string | null, string]> = {
  animated: ['animate_render', 'M3', 'result_animated'], relief: ['depth_relief', 'M5', 'result_relief'],
  frame: ['frame_compose', null, ''], sculpture: ['sculpture', 'M7', 'result_glb'],
};

/** 워커가 결과를 만든 것처럼 흉내 낸다: 판정(마스크)·단계 작업(done)·결과·확인 대기. */
export async function simulateResult(db: Pool, artworkId: string | number, kind: 'animated' | 'relief' | 'frame' | 'sculpture',
  opts: { mask?: boolean; origin?: string; cause?: string | null } = {}) {
  const id = Number(artworkId);
  const [[fam]] = (await db.query(`SELECT family_id FROM artwork WHERE artwork_id = ?`, [id])) as unknown as [{ family_id: number }[]];
  await db.query(`UPDATE stage_job SET status = 'done' WHERE artwork_id = ? AND status IN ('queued','running','retry_wait')`, [id]);
  const [jr] = await db.query(`SELECT artwork_id FROM judgment WHERE artwork_id = ?`, [id]);
  if (!(jr as unknown[]).length) {
    let maskId: number | null = null;
    if (opts.mask !== false) {
      const [m] = await db.query(`INSERT INTO stored_object (owner_kind, family_id, artwork_id, object_kind, object_key) VALUES ('family', ?, ?, 'mask', ?)`, [fam.family_id, id, `family/m${id}/mask/${randomUUID()}.png`]);
      maskId = (m as { insertId: number }).insertId;
    }
    await db.query(`INSERT INTO judgment (artwork_id, split_ok, mask_object_id, suggestion, suggestion_state) VALUES (?, ?, ?, ?, 'presented')`, [id, opts.mask !== false, maskId, opts.mask !== false ? 'animated' : 'frame']); // chk_jd_split_fail_frame
  }
  const [stage, model, objKind] = STAGE[kind];
  const [[v]] = (await db.query(`SELECT version_id FROM model_version WHERE model_id = ? AND release_state = 'active'`, [model ?? 'none'])) as unknown as [{ version_id: number }[]];
  const [j] = await db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count) VALUES (?, ?, ?, 'cpu_vision', ?, 'done', 1)`,
    [id, stage, opts.origin ?? 'confirm', model ? v?.version_id ?? null : null]);
  let objId: number | null = null;
  if (objKind) {
    const [o] = await db.query(`INSERT INTO stored_object (owner_kind, family_id, artwork_id, object_kind, object_key) VALUES ('family', ?, ?, ?, ?)`, [fam.family_id, id, objKind, `family/r${id}/${objKind}/${randomUUID()}`]);
    objId = (o as { insertId: number }).insertId;
  }
  // 워커(chain.py)와 같이 INSERT IGNORE — D34로 원본 액자 결과는 올리기 때 이미 있다
  await db.query(`INSERT IGNORE INTO result (artwork_id, job_id, result_kind, object_id) VALUES (?, ?, ?, ?)`, [id, (j as { insertId: number }).insertId, kind, objId]);
  await db.query(`INSERT INTO artwork_outcome (artwork_id, result_kind, result_cause) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE result_kind = VALUES(result_kind), result_cause = COALESCE(VALUES(result_cause), result_cause)`,
    [id, kind, opts.cause ?? null]);
  await db.query(`UPDATE artwork SET status = 'awaiting_review' WHERE artwork_id = ?`, [id]);
}

/** 팀원 계정(역할) + 로그인한 agent */
export async function staff(t: { app: import('node:http').Server; db: Pool }, email: string, roles: string[]) {
  const argon2 = (await import('argon2')).default;
  const [ins] = await t.db.query(`INSERT INTO team_member (email, password_hash) VALUES (?, ?)`, [email, await argon2.hash(PW, { type: argon2.argon2id })]);
  for (const r of roles) await t.db.query(`INSERT INTO team_member_role (member_id, role) VALUES (?, ?)`, [(ins as { insertId: number }).insertId, r]);
  const a = request.agent(t.app);
  const res = await a.post('/v1/ops/auth/login').send({ email, password: PW }).expect(200);
  return { a, roles: res.body.roles as string[] };
}

/** D46: 올린 뒤에는 이야기 API로 고칠 수 없다 — 시험 준비용으로 DB에 직접 넣는다 */
export async function setStory(db: Pool, artworkId: string | number, v: { title?: string | null; madeOn?: string | null; ageAtMaking?: number | null; childWords?: string | null; guardianNote?: string | null }) {
  const map: [keyof typeof v, string][] = [['title', 'title'], ['madeOn', 'made_on'], ['ageAtMaking', 'age_at_creation'], ['childWords', 'utterance'], ['guardianNote', 'guardian_note']];
  const cols = map.filter(([k]) => v[k] !== undefined);
  if (!cols.length) return;
  const extra = (v.title ? ', title_auto = FALSE' : '') + (v.madeOn ? ', made_on_auto = FALSE' : '') + (v.ageAtMaking != null ? ', age_auto = FALSE' : ''); // 보호자가 적은 것처럼
  await db.query(`UPDATE story SET ${cols.map(([, c]) => `${c} = ?`).join(', ')}${extra} WHERE artwork_id = ?`, [...cols.map(([k]) => v[k]), Number(artworkId)]);
}
