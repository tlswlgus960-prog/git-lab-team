// 결과 확인 결정(T088·T089, UC4, FR-6, G9·G10, BR-APR-02~06, D2·D11·D14, SD_03 §19 #17).
// 선택지 규칙은 이 파일 한 곳(SD_03 §2-3 "결과 종류별 선택지는 애플리케이션 규칙 함수 1곳").
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { Config } from '../../config.js';
import type { StoragePort } from '../../storage/LocalFsDriver.js';
import { Problem, isDup } from '../../lib/problem.js';
import { activeVersions } from './models.js';
import { hangOriginalFrame } from './hang.js';
import { requestArtworkDeletion } from '../deletion/request.js';

type Q = Pool | PoolConnection;
export type DecisionCode = 'like' | 'use_lower' | 'frame' | 'retake';
export interface Options { choices: DecisionCode[]; unavailable: { choice: DecisionCode; reason: 'model_disabled' | 'needs_result' | 'original_unreadable' }[] }

const one = async <T>(db: Q, sql: string, p: unknown[]) => ((await db.query(sql, p))[0] as T[])[0];

async function state(db: Q, artworkId: number) {
  const a = await one<{ status: string }>(db, `SELECT status FROM artwork WHERE artwork_id = ?`, [artworkId]);
  const cr = await one<{ result_kind: string }>(db, `SELECT result_kind FROM v_current_result WHERE artwork_id = ?`, [artworkId]);
  const j = await one<{ mask_object_id: number | null }>(db, `SELECT mask_object_id FROM judgment WHERE artwork_id = ?`, [artworkId]);
  const d = await one<{ review_round: number; decision_code: DecisionCode }>(db,
    `SELECT review_round, decision_code FROM decision WHERE artwork_id = ? ORDER BY review_round DESC LIMIT 1`, [artworkId]);
  const o = await one<{ object_key: string }>(db,
    `SELECT so.object_key FROM artwork_original ao JOIN stored_object so ON so.object_id = ao.object_id WHERE ao.artwork_id = ?`, [artworkId]);
  return { status: a?.status, kind: cr?.result_kind ?? null, hasMask: Boolean(j?.mask_object_id), last: d, originalKey: o?.object_key };
}

/** UC4 §1 · A1~A8 · E1 · SD_02 S5 */
export async function decisionOptions(db: Q, storage: StoragePort, artworkId: number): Promise<Options> {
  const s = await state(db, artworkId);
  const out: Options = { choices: [], unavailable: [] };
  const originalOk = s.originalKey ? await storage.exists(s.originalKey) : false;
  const frame = () => (originalOk ? out.choices.push('frame') : out.unavailable.push({ choice: 'frame', reason: 'original_unreadable' }));
  if (s.status === 'failed') { frame(); out.choices.push('retake'); return out; } // G9
  if (s.status !== 'awaiting_review') return out;
  if (!s.kind) { out.unavailable.push({ choice: 'like', reason: 'needs_result' }); out.choices.push('retake'); return out; }
  out.choices.push('like');
  if ((s.kind === 'animated' || s.kind === 'sculpture') && s.hasMask && !s.last) {
    if ((await activeVersions(db)).has('M5')) out.choices.push('use_lower');
    else out.unavailable.push({ choice: 'use_lower', reason: 'model_disabled' });
  }
  if (s.kind !== 'frame') frame();
  out.choices.push('retake');
  return out;
}

export async function decide(db: Pool, cfg: Config, storage: StoragePort, conn: PoolConnection, familyId: number, accountId: number,
  artworkId: number, code: DecisionCode): Promise<{ alreadyDecided: boolean; retakeChildId?: number }> {
  const [rows] = await conn.query(`SELECT status, child_id FROM artwork WHERE artwork_id = ? AND family_id = ? FOR UPDATE`, [artworkId, familyId]);
  const a = (rows as { status: string; child_id: number }[])[0];
  if (!a) throw new Problem('not_found');
  if (a.status === 'deleting') throw new Problem('conflict', 'deleting', 'G10');
  const s = await state(conn, artworkId);
  if (s.status !== 'awaiting_review' && s.status !== 'failed') {
    if (s.last) return { alreadyDecided: true }; // E7 중복 — 첫 결정 유지
    throw new Problem('conflict', 'decision_not_allowed_in_state', 'G10');
  }
  const round = s.last ? Number(s.last.review_round) + 1 : 1;
  const opts = await decisionOptions(conn, storage, artworkId);
  if (!opts.choices.includes(code)) throw new Problem('conflict', 'decision_not_allowed', s.status === 'failed' ? 'G9' : 'G10');
  try {
    await conn.query(`INSERT INTO decision (artwork_id, review_round, decision_code) VALUES (?, ?, ?)`, [artworkId, round, code]);
  } catch (e) {
    if (isDup(e, 'uq_dc_round')) return { alreadyDecided: true };
    throw e;
  }
  const failed = s.status === 'failed';
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (round === 1) { sets.push('first_decision = ?', 'in_approval_base = ?', 'first_decided_at = UTC_TIMESTAMP()'); vals.push(code, !failed); } // D2·D14, FR-13
  if (code === 'use_lower' || (code === 'frame' && !failed && s.kind !== 'frame')) { sets.push(`result_cause = 'guardian_switch'`); } // BR-APR-04
  if (code === 'frame') sets.push(`result_kind = 'frame'`); // SD_03 §19 #17
  if (sets.length) await conn.query(`UPDATE artwork_outcome SET ${sets.join(', ')} WHERE artwork_id = ?`, [...vals, artworkId]);

  if (code === 'like' || code === 'frame') {
    await conn.query(`UPDATE artwork SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE artwork_id = ?`, [artworkId]);
    // D34: 좋아요 = 걸린 결과를 이 결과로 바꿔 건다. 액자로 두기 = 원본 액자(이미 걸려 있으면 그대로)
    if (code === 'like') {
      await conn.query(
        `UPDATE artwork a JOIN v_current_result cr ON cr.artwork_id = a.artwork_id
            SET a.hung_result_id = cr.result_id, a.hung_at = COALESCE(a.hung_at, CURRENT_TIMESTAMP) WHERE a.artwork_id = ?`, [artworkId]);
    } else await hangOriginalFrame(conn, artworkId);
  } else if (code === 'use_lower') {
    const v = (await activeVersions(conn)).get('M5');
    await conn.query(
      `INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id) VALUES (?, 'depth_relief', 'use_lower', ?, ?)`,
      [artworkId, cfg.gpuEnabled ? 'gpu' : 'cpu_vision', v],
    );
    await conn.query(`UPDATE artwork SET status = 'processing' WHERE artwork_id = ?`, [artworkId]);
  } else {
    await requestArtworkDeletion(conn, artworkId, 'retake', accountId); // EXT2 · BR-APR-05
    return { alreadyDecided: false, retakeChildId: Number(a.child_id) };
  }
  void db;
  return { alreadyDecided: false };
}
