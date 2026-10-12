// sweeper 프로세스(pm2 'sweeper'): 10초마다 이어받기 → 삭제 → 정리. 로그는 분류 코드만(BR-PRV-01).
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { LocalFsDriver } from '../storage/LocalFsDriver.js';
import { log } from '../lib/logger.js';
import { takeOver, takeOverExternal } from './takeover.js';
import { processDeletions } from './deletion.js';
import { housekeeping } from './housekeeping.js';

export async function sweepOnce(db: ReturnType<typeof createPool>, storage: LocalFsDriver, storageRoot: string) {
  for (const [name, fn] of [
    ['takeover', () => takeOver(db)],
    ['takeover_external', () => takeOverExternal(db)],
    ['deletion', () => processDeletions(db, storage, storageRoot)],
    ['housekeeping', () => housekeeping(db, storageRoot)],
  ] as const) {
    try { await fn(); } catch (e) { log.error({ event: `sweep_${name}_failed`, code: (e as { code?: string }).code ?? 'error' }); }
  }
}

// pm2 fork 모드에서는 argv[1]이 pm2 컨테이너라서 pm_exec_path도 본다(DEPLOY §7 첫 배포에서 발견)
const entry = process.env.pm_exec_path ?? process.argv[1];
if (entry?.endsWith('main.js') || entry?.endsWith('main.ts')) {
  const cfg = loadConfig();
  const db = createPool(cfg.db);
  const storage = new LocalFsDriver(cfg.storageRoot);
  const tick = async () => { await sweepOnce(db, storage, cfg.storageRoot); setTimeout(tick, 10_000); };
  void tick();
}
