// 흐름 E2E가 처리 상태를 만들 때만 쓰는 임시 DB 연결(e2e/stack이 띄운 것 — 팀 DB 아님).
// 워커가 만들 수 없는 상태(대기·다시 시도 중·낮춤·처리하지 못함)를 단계 작업 행으로 직접 둔다(T075).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** web에는 mysql2가 없다 — api/node_modules의 것을 빌려 쓰고, 쓰는 부분만 타입으로 적는다 */
export interface Connection { query(sql: string, params?: unknown[]): Promise<unknown>; end(): Promise<void> }
const mysql = require('../../../api/node_modules/mysql2/promise.js') as { createConnection(o: object): Promise<Connection> };

export async function e2eDb(): Promise<Connection> {
  const socketPath = process.env.E2E_DB_SOCKET;
  if (!socketPath) throw new Error('E2E_DB_SOCKET 없음 — e2e/stack global-setup으로만 연다');
  return mysql.createConnection({ socketPath, user: 'root', database: 'uam_e2e', timezone: 'Z' });
}

/** 움직임으로 확정한 것처럼 두고, 단계 작업 행을 넣는다.
 *  trg_stage_job_bi(BR-MDL-07)는 활성 버전의 작업만 받는다 — 임시 DB에서만, 가짜(runtime='fake') M3 버전을
 *  작업을 넣는 동안만 활성으로 두고 곧바로 retired로 내린다(serving/tests/seed.py와 같은 방식). 다른 시험은 여전히 "활성 모델 없음"을 본다.
 *  팀 DB·실제 모델과는 무관하다. */
export async function animatedJobs(db: Connection, artworkId: string, insert: (versionId: number) => Promise<void>) {
  const [v] = await db.query(`INSERT INTO model_version (model_id, version_label, weights_sha256, config_hash, runtime, license_confirmed, release_state, exec_device)
    VALUES ('M3', CONCAT('e2e-', LEFT(REPLACE(UUID(), '-', ''), 12)), REPEAT('0', 64), REPEAT('0', 64), 'fake', TRUE, 'active', 'cpu')`) as [{ insertId: number }];
  try {
    await db.query(`UPDATE artwork SET status = 'processing', confirmed_at = UTC_TIMESTAMP() WHERE artwork_id = ?`, [artworkId]);
    await db.query(`INSERT INTO artwork_outcome (artwork_id, suggestion_at_confirm, confirmed_path, in_approval_base) VALUES (?, NULL, 'animated', TRUE)`, [artworkId]);
    await insert(v.insertId);
  } finally {
    await db.query(`UPDATE model_version SET release_state = 'retired' WHERE version_id = ?`, [v.insertId]);
  }
}
