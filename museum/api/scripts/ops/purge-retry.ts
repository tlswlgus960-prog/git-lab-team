// 삭제 미완료 재처리(T100, clarify 2026-09-28): 운영자가 원인(저장소 장애 등)을 해결한 뒤 실행한다.
// 연결이 끊긴 채 남은 "삭제 중" 작품에 새 삭제 요청을 만들고 sweeper 한 바퀴를 돌린다. 끝난 만큼 오래된 incomplete를 completed로 넘긴다.
// 출력은 건수만(이미지·식별 정보 없음, BR-ACC-03).
import { loadConfig } from '../../src/config.js';
import { createPool } from '../../src/db/pool.js';
import { LocalFsDriver } from '../../src/storage/LocalFsDriver.js';
import { processDeletions } from '../../src/sweeper/deletion.js';

const cfg = loadConfig();
const db = createPool(cfg.db);
const [orphans] = await db.query(`SELECT a.artwork_id FROM artwork a WHERE a.status = 'deleting' AND NOT EXISTS
  (SELECT 1 FROM deletion_request d WHERE d.artwork_id = a.artwork_id AND d.status IN ('accepted','waiting_stop','deleting_files'))`);
for (const { artwork_id } of orphans as { artwork_id: number }[]) {
  await db.query(`INSERT INTO deletion_request (target_kind, origin, artwork_id, status) VALUES ('artwork','guardian',?, 'deleting_files')`, [artwork_id]);
}
await processDeletions(db, new LocalFsDriver(cfg.storageRoot), cfg.storageRoot);
const [[done]] = (await db.query(`SELECT COUNT(*) n FROM artwork WHERE status = 'deleting'`)) as unknown as [{ n: number }[]];
const fixed = (orphans as unknown[]).length - Number(done.n);
if (fixed > 0) await db.query(`UPDATE deletion_request SET status = 'completed' WHERE status = 'incomplete' ORDER BY deletion_id LIMIT ?`, [fixed]);
console.log(`다시 삭제 대상 ${(orphans as unknown[]).length}건, 완료 ${Math.max(fixed, 0)}건, 남음 ${done.n}건`);
await db.end();
