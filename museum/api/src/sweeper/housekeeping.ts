// 정리(FR-11, BR-PRC-08, D8): 끝난·버려진 작업의 tmp, 접수 중 남은 조각, 만료 세션·토큰, 외부 결과 보관 상한(1시간, U12 예시값).
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'mysql2/promise';

const TMP_GRACE_MS = 10 * 60 * 1000;

async function oldEntries(dir: string): Promise<string[]> {
  try {
    const out: string[] = [];
    for (const name of await fs.readdir(dir)) {
      const st = await fs.stat(path.join(dir, name));
      if (Date.now() - st.mtimeMs > TMP_GRACE_MS) out.push(name);
    }
    return out;
  } catch { return []; }
}

export async function housekeeping(db: Pool, storageRoot: string): Promise<void> {
  const tmp = path.join(storageRoot, 'tmp');
  const [live] = await db.query(`SELECT job_id FROM stage_job WHERE status IN ('queued','running','retry_wait')`);
  const alive = new Set((live as { job_id: number }[]).map((j) => String(j.job_id)));
  for (const name of await oldEntries(tmp)) {
    if (name === 'intake' || alive.has(name)) continue;
    await fs.rm(path.join(tmp, name), { recursive: true, force: true });
  }
  for (const name of await oldEntries(path.join(tmp, 'intake'))) await fs.rm(path.join(tmp, 'intake', name), { force: true });

  const [exp] = await db.query(`SELECT ext_job_id FROM external_job WHERE result_temp_ref IS NOT NULL AND delivered_at IS NULL
                                  AND finished_at < CURRENT_TIMESTAMP - INTERVAL 1 HOUR`);
  for (const { ext_job_id } of exp as { ext_job_id: number }[]) {
    await fs.rm(path.join(storageRoot, 'ext', String(ext_job_id)), { recursive: true, force: true });
    await db.query(`UPDATE external_job SET result_temp_ref = NULL WHERE ext_job_id = ?`, [ext_job_id]);
  }
  // 실패한 외부 작업은 결과가 없으니 입력만 남는다 — 끝난 뒤 곧바로 지운다(D8)
  const [failed] = await db.query(`SELECT ext_job_id FROM external_job WHERE status = 'failed' AND finished_at < CURRENT_TIMESTAMP - INTERVAL 10 MINUTE`);
  for (const { ext_job_id } of failed as { ext_job_id: number }[]) {
    await fs.rm(path.join(storageRoot, 'ext', String(ext_job_id)), { recursive: true, force: true });
  }
  await db.query(`DELETE FROM app_session WHERE expires_at < UTC_TIMESTAMP()`);
  await db.query(`DELETE FROM auth_email_token WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 7 DAY`);
  await db.query(`DELETE FROM auth_rate_event WHERE occurred_at < UTC_TIMESTAMP() - INTERVAL 2 DAY`);
}
