// D34 올리면 원본 액자로 바로 전시(docs/B/B_D34_설계반영안_2026-09-30.md §2·§3): 걸린 결과를 처리 상태와 떼어 둔다.
import type { PoolConnection } from 'mysql2/promise';

/** D34: 원본 액자 결과(파일 없음 · 작업 없음)를 만들어 건다. 이미 있으면 그것을 건다. */
export async function hangOriginalFrame(conn: PoolConnection, artworkId: number): Promise<void> {
  await conn.query(`INSERT IGNORE INTO result (artwork_id, job_id, result_kind, object_id) VALUES (?, NULL, 'frame', NULL)`, [artworkId]);
  await conn.query(
    `UPDATE artwork a JOIN result r ON r.artwork_id = a.artwork_id AND r.result_kind = 'frame'
        SET a.hung_result_id = r.result_id, a.hung_at = COALESCE(a.hung_at, CURRENT_TIMESTAMP) WHERE a.artwork_id = ?`, [artworkId]);
}
