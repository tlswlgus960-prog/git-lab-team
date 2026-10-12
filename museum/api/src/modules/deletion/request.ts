// 삭제 요청(G18, BR-DEL-01·05, D4, data-model §4): deleting 전환 + 단계 작업 취소 신호 + deletion_request(waiting_stop).
// 대기 작업은 바로 cancelled·stopped_at, 실행 중은 cancel_requested_at만(워커가 멈추고 stopped_at). 파일 삭제는 sweeper(G19).
import type { PoolConnection } from 'mysql2/promise';

export async function requestArtworkDeletion(conn: PoolConnection, artworkId: number, origin: 'guardian' | 'retake', requestedBy: number): Promise<void> {
  await conn.query(`UPDATE artwork SET status = 'deleting', deleting_since = CURRENT_TIMESTAMP WHERE artwork_id = ?`, [artworkId]);
  await conn.query(
    `UPDATE stage_job SET cancel_requested_at = CURRENT_TIMESTAMP,
            status = IF(status IN ('queued','retry_wait'), 'cancelled', status),
            stopped_at = IF(status IN ('queued','retry_wait'), CURRENT_TIMESTAMP, stopped_at)
      WHERE artwork_id = ? AND status IN ('queued','retry_wait','running')`,
    [artworkId],
  );
  await conn.query(
    `INSERT INTO deletion_request (target_kind, origin, artwork_id, requested_by, status) VALUES ('artwork', ?, ?, ?, 'waiting_stop')`,
    [origin, artworkId, requestedBy],
  );
}
