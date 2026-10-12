// 모델 점검(D20, FR-33, UC8 A8·E7, UC9 A7, SD_01 7.8~7.10, G30, BR-OPS-05·06).
// 평가 묶음 항목 한 장으로 모델 하나를 샘플 추론한다 — 여기서는 점검 기록과 점검 작업(origin='check', 우선순위 30)만 등록하고,
// 실행은 serving 점검 실행기(A, stage-job §13)가 한다. 점수·객체 키는 응답에 싣지 않는다.
import { Router } from 'express';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { withTx } from '../../db/pool.js';
import { requirePerm } from '../../auth/policy.js';
import { Problem, isDup, parseSignal } from '../../lib/problem.js';
import { recordGate } from '../../lib/gateEvent.js';

const MODELS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'];
const CHECK_STAGE: Record<string, [string, string]> = { // 모델 → [단계, 서빙군] (평가와 같은 대응, stage-job §13)
  M1: ['split', 'cpu_vision'], M2: ['judge', 'cpu_vision'], M3: ['animate_render', 'cpu_vision'],
  M5: ['depth_relief', 'gpu'], M7: ['sculpture', 'gpu'],
};
const START_DEADLINE_MIN = 15; // [추론] D20 ③
const KEEP_PER_MODEL = 20; // [추론] D20 ⑤
const all = async <T>(db: Pool | PoolConnection, sql: string, p: unknown[] = []) => (await db.query(sql, p))[0] as T[];
const iso = (v: unknown) => (v ? new Date(v as Date).toISOString() : null);

type Row = Record<string, unknown>;
const SELECT = `SELECT c.check_id, c.model_id, c.version_id, v.version_label, v.release_state, c.eval_item_id, c.status, c.outcome,
                       c.fail_reason, c.processing_ms, c.memory_mb, c.requested_at, c.started_at, c.finished_at
                  FROM model_check c JOIN model_version v ON v.version_id = c.version_id`;

export function view(r: Row) {
  return {
    id: String(r.check_id), modelId: r.model_id as string, versionId: String(r.version_id), versionLabel: r.version_label as string,
    releaseState: r.release_state as string, evalItemId: String(r.eval_item_id), status: r.status as string,
    outcome: (r.outcome as string | null) ?? null, failReason: (r.fail_reason as string | null) ?? null,
    processingMs: r.processing_ms === null ? null : Number(r.processing_ms), memoryMb: r.memory_mb === null ? null : Number(r.memory_mb),
    requestedAt: iso(r.requested_at)!, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
  };
}

/** 15분 넘게 시작하지 못한 점검을 model_not_ready로 닫고 그 작업을 취소한다(SD_01 7.10). 조회 때 부른다. */
export async function closeStale(db: Pool) {
  const stale = await all<{ check_id: number }>(db,
    `SELECT check_id FROM model_check WHERE status = 'queued' AND requested_at < CURRENT_TIMESTAMP - INTERVAL ${START_DEADLINE_MIN} MINUTE`);
  for (const { check_id } of stale) {
    await withTx(db, async (conn) => {
      const [u] = await conn.query(`UPDATE model_check SET status = 'failed', fail_reason = 'model_not_ready', finished_at = CURRENT_TIMESTAMP
                                     WHERE check_id = ? AND status = 'queued'`, [check_id]);
      if ((u as { affectedRows: number }).affectedRows) {
        await conn.query(`UPDATE stage_job SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
                           WHERE model_check_id = ? AND status IN ('queued','retry_wait')`, [check_id]);
      }
    });
  }
}

/** 모델별 가장 최근 점검(/ready lastCheck · S11 마지막 점검). */
export async function latestChecks(db: Pool) {
  await closeStale(db);
  const rows = await all<Row>(db, `${SELECT} WHERE c.check_id IN (SELECT MAX(check_id) FROM model_check GROUP BY model_id) ORDER BY c.model_id`);
  return rows.map(view);
}

export function modelCheckRouter(db: Pool, cfg: Config): Router {
  const r = Router();
  const runners = requirePerm(db, 'models.check'); // D24 — 권한 정본 api/src/auth/policy.ts
  const readers = requirePerm(db, 'models.check.read');

  r.post('/v1/ops/models/:id/check', runners, async (req, res, next) => {
    const actor = req.staff?.roles.includes('evaluator') ? 'evaluator' : 'operator';
    const refuse = async (versionId: number | null, reason: string, p: Problem) => {
      await recordGate(db, 'G30', 'model_version', versionId, actor, reason);
      return p;
    };
    try {
      const m = req.params.id;
      if (!MODELS.includes(m)) throw new Problem('not_found');
      const b = z.object({ versionId: z.string().regex(/^\d+$/).optional(), evalItemId: z.string().regex(/^\d+$/).optional() }).strict()
        .safeParse(req.body ?? {});
      if (!b.success) throw new Problem('validation_failed', 'check_fields');
      if (m === 'M4') throw new Problem('conflict', 'rule_not_checked');
      if (m === 'M6') throw new Problem('conflict', 'm6_check_p05'); // llm-server 동기 점검은 P0.5(tasks T156)
      if (!cfg.modelCheckEnabled) throw new Problem('not_saved', 'check_runner_missing'); // D20 ⑨ — 점검 실행기 배포 전

      // 대상 버전: 지정 → 활성 → 가장 최근의 폐기 아닌 버전(D20 ⑥)
      const vers = await all<{ version_id: number; release_state: string }>(db,
        `SELECT version_id, release_state FROM model_version WHERE model_id = ? ORDER BY version_id DESC`, [m]);
      let ver: { version_id: number; release_state: string } | undefined;
      if (b.data.versionId) {
        ver = vers.find((v) => Number(v.version_id) === Number(b.data.versionId));
        if (!ver) throw new Problem('not_found');
      } else {
        ver = vers.find((v) => v.release_state === 'active') ?? vers.find((v) => v.release_state !== 'retired');
        if (!ver) throw new Problem('conflict', 'no_version');
      }
      const versionId = Number(ver.version_id);
      if (ver.release_state === 'retired') throw await refuse(versionId, 'version_retired', new Problem('conflict', 'version_retired', 'G30'));

      // 입력: 평가 묶음 사진 항목(M7은 입체). 지정하지 않으면 고른다(M3는 사람 항목 우선)
      const fits = (c: string) => (m === 'M7' ? c === 'sculpture' : c !== 'caption_input');
      let itemId: number;
      if (b.data.evalItemId) {
        const [it] = await all<{ item_id: number; category: string }>(db,
          `SELECT i.item_id, i.category FROM eval_item i JOIN stored_object o ON o.object_id = i.object_id AND o.owner_kind = 'eval_set'
            WHERE i.item_id = ?`, [Number(b.data.evalItemId)]);
        if (!it || !fits(it.category)) throw await refuse(versionId, 'not_check_sample', new Problem('validation_failed', 'not_check_sample', 'G30'));
        itemId = Number(it.item_id);
      } else {
        const items = await all<{ item_id: number; category: string }>(db,
          `SELECT i.item_id, i.category FROM eval_item i JOIN stored_object o ON o.object_id = i.object_id AND o.owner_kind = 'eval_set' ORDER BY i.item_id`);
        const ok = items.filter((i) => fits(i.category));
        const pick = (m === 'M3' ? ok.find((i) => i.category === 'person') : undefined) ?? ok[0];
        if (!pick) throw await refuse(versionId, 'no_check_sample', new Problem('conflict', 'no_check_sample', 'G30'));
        itemId = Number(pick.item_id);
      }

      await closeStale(db); // 오래 멈춘 점검이 새 점검을 막지 않게
      const [stage, group] = CHECK_STAGE[m];
      const checkId = await withTx(db, async (conn) => {
        const [c] = await conn.query(`INSERT INTO model_check (model_id, version_id, eval_item_id, requested_by) VALUES (?, ?, ?, ?)`,
          [m, versionId, itemId, req.staff!.memberId]);
        const id = (c as { insertId: number }).insertId;
        await conn.query(`INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, eval_item_id, model_check_id, priority)
                          VALUES (?, 'check', ?, ?, ?, ?, 30)`, [stage, m === 'M5' && !cfg.gpuEnabled ? 'cpu_vision' : group, versionId, itemId, id]);
        // 보관: 모델마다 최근 KEEP_PER_MODEL건(D20 ⑤) — 점검 작업을 먼저 지운다(FK)
        const old = await all<{ check_id: number }>(conn,
          `SELECT check_id FROM model_check WHERE model_id = ? AND status IN ('passed','failed') ORDER BY check_id DESC LIMIT 1000 OFFSET ${KEEP_PER_MODEL - 1}`, [m]);
        if (old.length) {
          const ids = old.map((o) => o.check_id);
          await conn.query(`DELETE FROM stage_job WHERE origin = 'check' AND model_check_id IN (?)`, [ids]);
          await conn.query(`DELETE FROM model_check WHERE check_id IN (?)`, [ids]);
        }
        return id;
      }).catch(async (e) => {
        if (isDup(e, 'uq_mc_one_inflight')) throw new Problem('conflict', 'check_in_progress');
        const s = parseSignal(e);
        if (s) throw await refuse(versionId, s.reason, new Problem(s.reason === 'rule_not_checked' ? 'conflict' : 'validation_failed', s.reason, s.gate));
        throw e;
      });
      const [row] = await all<Row>(db, `${SELECT} WHERE c.check_id = ?`, [checkId]);
      res.status(202).json(view(row));
    } catch (e) { next(e); }
  });

  r.get('/v1/ops/model-checks', readers, async (_req, res, next) => {
    try { res.json({ checks: await latestChecks(db) }); } catch (e) { next(e); }
  });

  r.get('/v1/ops/model-checks/:checkId', readers, async (req, res, next) => {
    try {
      if (!/^\d+$/.test(req.params.checkId)) throw new Problem('not_found');
      await closeStale(db);
      const [row] = await all<Row>(db, `${SELECT} WHERE c.check_id = ?`, [Number(req.params.checkId)]);
      if (!row) throw new Problem('not_found');
      res.json(view(row));
    } catch (e) { next(e); }
  });

  return r;
}
