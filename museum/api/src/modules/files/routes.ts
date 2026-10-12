// GET /v1/files/{token} (T026) — 토큰의 가족과 세션의 가족이 같아야 한다. 운영은 nginx X-Accel-Redirect, 개발·시험은 직접 전송.
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Config } from '../../config.js';
import type { StoragePort } from '../../storage/LocalFsDriver.js';
import { guardianAuth } from '../../auth/guards.js';
import { Problem } from '../../lib/problem.js';
import { verifyFileToken } from './token.js';

export function filesRouter(db: Pool, cfg: Config, storage: StoragePort, accel = process.env.FILES_ACCEL === '1'): Router {
  const r = Router();
  r.get('/v1/files/:token', guardianAuth(db, { requireFamily: true }), async (req, res, next) => {
    try {
      const t = verifyFileToken(cfg.sessionSecret, req.params.token);
      if (!t || t.familyId !== req.guardian!.familyId) throw new Problem('not_found');
      const [rows] = await db.query(
        `SELECT object_key FROM stored_object WHERE object_id = ? AND family_id = ? AND owner_kind = 'family'`,
        [t.objectId, t.familyId],
      );
      const key = (rows as { object_key: string }[])[0]?.object_key;
      if (!key) throw new Problem('not_found');
      res.setHeader('Cache-Control', 'private, max-age=300');
      if (accel) {
        res.setHeader('X-Accel-Redirect', `/_files/${key}`);
        res.end();
        return;
      }
      res.sendFile(storage.absolutePath(key));
    } catch (e) {
      next(e);
    }
  });
  return r;
}
