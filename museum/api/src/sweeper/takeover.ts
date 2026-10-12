// 점유 만료 이어받기(T033, BR-PRC-05, stage-job §3·§4.3). 워커가 멈춰 점유가 만료된 running 작업을 되돌린다.
// 이어받기도 시도에 포함 — 3회를 다 쓴 작업은 소진 규칙(D1)을 워커와 같게 적용한다. 원인 분류는 engine_down(워커 소실).
import type { Pool, PoolConnection } from 'mysql2/promise';
import { withTx } from '../db/pool.js';

const RESULT_STAGES = ['animate_render', 'depth_relief', 'sculpture'];

/** 판정이 끝났을 때(소진 포함) 잠긴 확정 작업을 연다(stage-job §2 "판정 전 확정의 순서", T144와 같은 규칙). */
export async function openConfirmJobs(conn: PoolConnection, artworkId: number): Promise<void> {
  const [jr] = await conn.query(`SELECT split_ok FROM judgment WHERE artwork_id = ?`, [artworkId]);
  const splitOk = (jr as { split_ok: number | null }[])[0]?.split_ok === 1;
  const [locked] = await conn.query(
    `SELECT job_id, stage_kind FROM stage_job WHERE artwork_id = ? AND origin = 'confirm' AND status = 'queued'
        AND available_at > UTC_TIMESTAMP() FOR UPDATE`, [artworkId]);
  for (const j of locked as { job_id: number; stage_kind: string }[]) {
    if (j.stage_kind === 'depth_relief' && !splitOk) {
      await conn.query(`UPDATE stage_job SET status = 'done_downgraded', downgrade_cause = 'split_fail', attempt_count = 1,
                               started_at = UTC_TIMESTAMP(), finished_at = UTC_TIMESTAMP() WHERE job_id = ?`, [j.job_id]);
      await conn.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group) VALUES (?, 'frame_compose', 'downgrade', 'cpu_vision')`, [artworkId]);
    } else {
      await conn.query(`UPDATE stage_job SET available_at = UTC_TIMESTAMP() WHERE job_id = ?`, [j.job_id]);
    }
  }
}

export async function takeOver(db: Pool): Promise<number> {
  const [rows] = await db.query(`SELECT job_id FROM stage_job WHERE status = 'running' AND claim_expires_at < UTC_TIMESTAMP() LIMIT 50`);
  let n = 0;
  for (const { job_id } of rows as { job_id: number }[]) {
    await withTx(db, async (conn) => {
      const [jr] = await conn.query(
        `SELECT j.job_id, j.artwork_id, j.stage_kind, j.origin, j.attempt_count, j.cancel_requested_at, a.status artwork_status
           FROM stage_job j LEFT JOIN artwork a ON a.artwork_id = j.artwork_id
          WHERE j.job_id = ? AND j.status = 'running' AND j.claim_expires_at < UTC_TIMESTAMP() FOR UPDATE`, [job_id]);
      const j = (jr as { job_id: number; artwork_id: number | null; stage_kind: string; origin: string; attempt_count: number; cancel_requested_at: Date | null; artwork_status: string | null }[])[0];
      if (!j) return;
      n++;
      if (j.cancel_requested_at || j.artwork_status === 'deleting') {
        // 멈춤은 취소 요청 뒤에만(chk_sj_stop_after_cancel) — 삭제 중이라 요청 표시가 없던 작업도 요청 시각을 함께 적는다
        await conn.query(`UPDATE stage_job SET status = 'cancelled', cancel_requested_at = COALESCE(cancel_requested_at, CURRENT_TIMESTAMP),
                                 stopped_at = CURRENT_TIMESTAMP, claimed_by = NULL WHERE job_id = ?`, [j.job_id]);
        return;
      }
      if (j.origin === 'check') {
        // D20 · stage-job §13: 점검은 재시도하지 않는다 — 점유가 만료된 점검은 engine_down 실패로 닫는다
        await conn.query(`UPDATE stage_job SET status = 'failed', error_class = 'engine_down', claimed_by = NULL, claim_expires_at = NULL,
                                 finished_at = UTC_TIMESTAMP() WHERE job_id = ?`, [j.job_id]);
        await conn.query(`UPDATE model_check c JOIN stage_job s ON s.model_check_id = c.check_id
                             SET c.status = 'failed', c.fail_reason = 'engine_down', c.finished_at = CURRENT_TIMESTAMP
                           WHERE s.job_id = ? AND c.status IN ('queued','running')`, [j.job_id]);
        return;
      }
      if (j.attempt_count < 3) {
        await conn.query(`UPDATE stage_job SET status = 'retry_wait', error_class = 'engine_down', claimed_by = NULL, claim_expires_at = NULL,
                                 available_at = UTC_TIMESTAMP() WHERE job_id = ?`, [j.job_id]);
        return;
      }
      await conn.query(`UPDATE stage_job SET status = 'failed', error_class = 'engine_down', claimed_by = NULL, claim_expires_at = NULL,
                               finished_at = UTC_TIMESTAMP() WHERE job_id = ?`, [j.job_id]);
      const aid = j.artwork_id;
      if (aid === null) return;
      if (j.stage_kind === 'split') {
        await conn.query(`UPDATE stage_job SET available_at = UTC_TIMESTAMP() WHERE artwork_id = ? AND stage_kind = 'judge' AND status IN ('queued','retry_wait')`, [aid]);
      } else if (j.stage_kind === 'judge') {
        await conn.query(`INSERT INTO judgment (artwork_id, judge_job_id, suggestion_state) VALUES (?, ?, 'exhausted')
                          ON DUPLICATE KEY UPDATE suggestion = NULL, suggestion_state = 'exhausted'`, [aid, j.job_id]);
        await conn.query(`UPDATE artwork SET status = 'awaiting_confirm' WHERE artwork_id = ? AND status IN ('received','judging')`, [aid]);
        await openConfirmJobs(conn, aid);
      } else if (RESULT_STAGES.includes(j.stage_kind)) {
        if (j.origin === 'use_lower') {
          await conn.query(`UPDATE artwork SET status = 'awaiting_review' WHERE artwork_id = ? AND status = 'processing'`, [aid]); // H6 소진
        } else {
          await conn.query(`UPDATE artwork SET status = 'failed' WHERE artwork_id = ? AND status = 'processing'`, [aid]); // G9
          await conn.query(`INSERT INTO artwork_outcome (artwork_id, result_cause) VALUES (?, 'not_delivered')
                            ON DUPLICATE KEY UPDATE result_cause = 'not_delivered'`, [aid]);
        }
      }
    });
  }
  return n;
}

/** 외부 작업 이어받기(stage-job §9): 점유가 만료된 running 외부 작업 — 3회 미만이면 다시 대기, 3회째면 failed·engine_down. */
export async function takeOverExternal(db: Pool): Promise<number> {
  const [u1] = await db.query(`UPDATE external_job SET status = 'queued', error_class = 'engine_down', claimed_by = NULL, claim_expires_at = NULL,
                                      available_at = UTC_TIMESTAMP()
                                WHERE status = 'running' AND claim_expires_at < UTC_TIMESTAMP() AND attempt_count < 3`);
  const [u2] = await db.query(`UPDATE external_job SET status = 'failed', error_class = 'engine_down', claimed_by = NULL, claim_expires_at = NULL,
                                      finished_at = UTC_TIMESTAMP()
                                WHERE status = 'running' AND claim_expires_at < UTC_TIMESTAMP() AND attempt_count >= 3`);
  return (u1 as { affectedRows: number }).affectedRows + (u2 as { affectedRows: number }).affectedRows;
}
