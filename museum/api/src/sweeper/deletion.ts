// 삭제 완료(T099, G19, BR-DEL-01~03, data-model §4, SD_03 §16-3).
// 순서: 멈춤 확인(v_deletion_hold, 점유 만료 + 30초는 강제 취소) → 파일 → stored_object → artwork(CASCADE·SET NULL) → completed.
// 파일 삭제 실패는 1분·5분 뒤 재시도, 세 번째 실패는 incomplete(삭제 미완료 수). 끝난 요청에는 식별 연결이 남지 않는다(trg_deletion_bu).
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'mysql2/promise';
import { withTx } from '../db/pool.js';
import type { StoragePort } from '../storage/LocalFsDriver.js';

const RETRY_AFTER_MIN = [0, 1, 6]; // 누적: 첫 시도 즉시, 1분 뒤, 그 5분 뒤

export async function processDeletions(db: Pool, storage: StoragePort, storageRoot: string): Promise<void> {
  const [reqs] = await db.query(
    `SELECT deletion_id, target_kind, artwork_id, child_id, status, file_retry_count,
            TIMESTAMPDIFF(SECOND, requested_at, CURRENT_TIMESTAMP) age_s
       FROM deletion_request WHERE status IN ('accepted','waiting_stop','deleting_files') ORDER BY deletion_id LIMIT 50`);
  for (const r of reqs as { deletion_id: number; target_kind: string; artwork_id: number | null; child_id: number | null; status: string; file_retry_count: number; age_s: number }[]) {
    if (r.age_s < RETRY_AFTER_MIN[Math.min(r.file_retry_count, 2)] * 60) continue;
    if (r.target_kind === 'artwork' && r.artwork_id !== null) await deleteArtwork(db, storage, storageRoot, r);
    else if (r.target_kind === 'child' && r.child_id !== null) await deleteChildIfEmpty(db, r.deletion_id, r.child_id);
  }
}

async function holding(db: Pool, artworkId: number): Promise<boolean> {
  // 점유 만료 + 30초가 지난 실행 중 작업은 강제로 멈춘 것으로 본다(G19 [추론])
  await db.query(`UPDATE stage_job SET status = 'cancelled', stopped_at = CURRENT_TIMESTAMP, claimed_by = NULL
                   WHERE artwork_id = ? AND status = 'running' AND cancel_requested_at IS NOT NULL
                     AND claim_expires_at < UTC_TIMESTAMP() - INTERVAL 30 SECOND`, [artworkId]);
  const [h] = await db.query(`SELECT running_jobs FROM v_deletion_hold WHERE artwork_id = ?`, [artworkId]);
  return (h as unknown[]).length > 0;
}

async function deleteArtwork(db: Pool, storage: StoragePort, storageRoot: string,
  r: { deletion_id: number; artwork_id: number | null; file_retry_count: number }) {
  const aid = r.artwork_id!;
  if (await holding(db, aid)) {
    await db.query(`UPDATE deletion_request SET status = 'waiting_stop' WHERE deletion_id = ?`, [r.deletion_id]);
    const [open] = await db.query(`SELECT event_id FROM gate_event WHERE gate_id = 'G19' AND subject_kind = 'deletion' AND subject_id = ? AND released_at IS NULL`, [r.deletion_id]);
    if (!(open as unknown[]).length) {
      await db.query(`INSERT INTO gate_event (gate_id, subject_kind, subject_id, actor_role, reason_code) VALUES ('G19','deletion',?, 'system','waiting_stop')`, [r.deletion_id]);
    }
    return;
  }
  await db.query(`UPDATE gate_event SET released_at = CURRENT_TIMESTAMP, release_action = 'stopped', released_by_role = 'system'
                   WHERE gate_id = 'G19' AND subject_kind = 'deletion' AND subject_id = ? AND released_at IS NULL`, [r.deletion_id]);
  await db.query(`UPDATE deletion_request SET status = 'deleting_files' WHERE deletion_id = ?`, [r.deletion_id]);
  const [objs] = await db.query(`SELECT object_key FROM stored_object WHERE artwork_id = ?`, [aid]);
  const [jobs] = await db.query(`SELECT job_id FROM stage_job WHERE artwork_id = ?`, [aid]);
  try {
    for (const o of objs as { object_key: string }[]) await storage.delete(o.object_key);
    for (const j of jobs as { job_id: number }[]) await fs.rm(path.join(storageRoot, 'tmp', String(j.job_id)), { recursive: true, force: true });
    const keys = (objs as { object_key: string }[]).map((o) => o.object_key);
    for (const k of keys) if (await storage.exists(k)) throw new Error('still_exists');
  } catch {
    const n = r.file_retry_count + 1;
    if (n >= 3) {
      await db.query(`UPDATE deletion_request SET status = 'incomplete', file_retry_count = ?, artwork_id = NULL, child_id = NULL,
                             completed_at = CURRENT_TIMESTAMP WHERE deletion_id = ?`, [n, r.deletion_id]);
    } else {
      await db.query(`UPDATE deletion_request SET file_retry_count = ? WHERE deletion_id = ?`, [n, r.deletion_id]);
    }
    return;
  }
  await withTx(db, async (conn) => {
    await conn.query(`UPDATE gate_event SET subject_id = NULL WHERE subject_kind = 'artwork' AND subject_id = ?`, [aid]); // SD_03 §16-3
    await conn.query(`DELETE FROM stored_object WHERE artwork_id = ?`, [aid]);
    await conn.query(`DELETE FROM artwork WHERE artwork_id = ?`, [aid]); // judgment·result·decision·story·caption CASCADE, 집계는 SET NULL
    await conn.query(`UPDATE deletion_request SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE deletion_id = ?`, [r.deletion_id]);
  });
}

async function deleteChildIfEmpty(db: Pool, deletionId: number, childId: number) {
  const [left] = await db.query(`SELECT COUNT(*) n FROM artwork WHERE child_id = ?`, [childId]);
  if (Number((left as { n: number }[])[0].n) > 0) return; // 작품 삭제가 끝나야 아이를 지운다(UC7 A1)
  await withTx(db, async (conn) => {
    await conn.query(`UPDATE gate_event SET subject_id = NULL WHERE subject_kind = 'child' AND subject_id = ?`, [childId]);
    await conn.query(`DELETE FROM child WHERE child_id = ?`, [childId]);
    await conn.query(`UPDATE deletion_request SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE deletion_id = ?`, [deletionId]);
  });
}
