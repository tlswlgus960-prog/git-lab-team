// 모델 평가·승격·롤백·비활성화·평가 항목(T113·T115·T116, UC9, FR-16·17·24, G20~G22, BR-MDL-01·03·04·07, D5, clarify 비활성화).
// 가족 데이터에 닿지 않는다(BR-ACC-03). 평가 작업 실행은 A 평가 실행기(T117) — 여기서는 작업만 등록(origin='eval', priority 50).
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import type { Pool } from 'mysql2/promise';
import YAML from 'yaml';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { withTx } from '../../db/pool.js';
import { requirePerm } from '../../auth/policy.js';
import { Problem, isDup, parseSignal, zodFields } from '../../lib/problem.js';
import { recordGate } from '../../lib/gateEvent.js';
import type { StoragePort } from '../../storage/LocalFsDriver.js';
import { validateUpload, MAX_BYTES } from '../artworks/validateUpload.js';

const MODELS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'];
const EVAL_STAGE: Record<string, [string, string]> = { // 모델 → [단계, 서빙군]
  M1: ['split', 'cpu_vision'], M2: ['judge', 'cpu_vision'], M3: ['animate_render', 'cpu_vision'],
  M5: ['depth_relief', 'gpu'], M6: ['caption', 'llm'], M7: ['sculpture', 'gpu'],
};
// 모델별 평가 대상(D51) — M3는 사람 항목만, M6은 설명 입력만, 나머지는 사진 항목 전체
const EVAL_TARGET: Record<string, string> = { M3: "category = 'person'", M6: "category = 'caption_input'" };
// 채점(D57): 기대 경로를 그 모델이 낼 수 있는 답으로 — M1·M5는 분리·깊이가 되면 relief라 animated를 relief로 본다
export const modelExpected = (m: string, expected: string | null) =>
  (m === 'M1' || m === 'M5') && expected === 'animated' ? 'relief' : expected;
const all = async <T>(db: Pool, sql: string, p: unknown[] = []) => (await db.query(sql, p))[0] as T[];
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);

export function adminRouter(db: Pool, cfg: Config, storage: StoragePort, manifestPath: string): Router {
  const r = Router();
  const evaluator = requirePerm(db, 'models.manage'); // D24 — 권한표 api/src/auth/policy.ts
  const readers = requirePerm(db, 'models.read');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

  async function manifest(): Promise<Record<string, { weights_sha256?: string | null; config_hash?: string | null; license_confirmed?: boolean }> | null> {
    try { return (YAML.parse(await fs.readFile(manifestPath, 'utf8'))?.models ?? {}) as never; } catch { return null; }
  }

  async function modelView(modelId?: string) {
    const models = await all<{ model_id: string; role_name: string; serving_group: string; phase: string }>(db,
      `SELECT model_id, role_name, serving_group, phase FROM model ${modelId ? 'WHERE model_id = ?' : ''} ORDER BY model_id`, modelId ? [modelId] : []);
    const vers = await all<Record<string, unknown>>(db, `SELECT * FROM model_version ORDER BY version_id`);
    // 버전별 가장 최근 평가 기록 — S11이 새로 고친 뒤에도 평가를 이어 간다(계약 ModelVersion.latestEvalRunId)
    const runs = await all<{ version_id: number; run: number }>(db, `SELECT version_id, MAX(evaluation_id) run FROM evaluation GROUP BY version_id`);
    const lastRun = new Map(runs.map((x) => [Number(x.version_id), String(x.run)]));
    const [fs0] = await all<{ enabled: number }>(db, `SELECT enabled FROM feature_setting WHERE setting_key = 'sculpture_exposure'`);
    return models.map((m) => ({
      modelId: m.model_id, roleName: m.role_name, tier: m.phase, servingGroup: m.serving_group,
      exposed: m.model_id === 'M7' ? Boolean(fs0?.enabled) : true,
      versions: vers.filter((v) => v.model_id === m.model_id).map((v) => ({
        id: String(v.version_id), version: v.version_label, weightsSha256: v.weights_sha256, runtime: v.runtime, imageDigest: v.image_digest,
        configHash: v.config_hash, device: v.exec_device, filePath: v.model_path, licenseConfirmed: Boolean(v.license_confirmed), releaseState: v.release_state,
        latestEvalRunId: lastRun.get(Number(v.version_id)) ?? null })),
    }));
  }
  const mid = (s: string) => { if (!MODELS.includes(s)) throw new Problem('not_found'); return s; };

  r.get('/v1/admin/models', readers, async (_req, res, next) => {
    try { res.json(await modelView()); } catch (e) { next(e); }
  });

  // 후보 등록 — 라이선스 확인 여부는 매니페스트(A)가 원천(BR-MDL-07)
  r.post('/v1/admin/models/:mid/versions', evaluator, async (req, res, next) => {
    try {
      const m = mid(req.params.mid);
      const b = z.object({ version: z.string().min(1).max(40), weightsSha256: hex64, runtime: z.string().max(80), imageDigest: hex64,
        configHash: hex64, device: z.enum(['cpu', 'gpu']), filePath: z.string().max(400).optional(), licenseRecord: z.string().max(200).optional() }).strict().safeParse(req.body);
      if (!b.success) throw new Problem('validation_failed', 'version_fields', undefined, zodFields(b.error));
      const man = (await manifest())?.[m];
      try {
        await db.query(`INSERT INTO model_version (model_id, version_label, weights_sha256, runtime, image_digest, config_hash, model_path, exec_device, license_confirmed)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [m, b.data.version, b.data.weightsSha256, b.data.runtime, b.data.imageDigest, b.data.configHash, b.data.filePath ?? null, b.data.device,
            Boolean(man?.license_confirmed && man.weights_sha256 === b.data.weightsSha256)]);
      } catch (e) { if (isDup(e, 'uq_mv_label')) throw new Problem('conflict', 'version_exists'); throw e; }
      res.status(201).json((await modelView(m))[0].versions.at(-1));
    } catch (e) { next(e); }
  });

  // 평가 요청(G21) — 매니페스트 해시 일치. 설치본 해시·런타임 포트 격리는 서빙 쪽 점검(A `ops.models check`)
  r.post('/v1/admin/models/:mid/evaluate', evaluator, async (req, res, next) => {
    try {
      const m = mid(req.params.mid);
      if (!EVAL_STAGE[m]) throw new Problem('conflict', 'rule_not_evaluated', 'G21');
      const versionId = Number(z.object({ versionId: z.string().regex(/^[1-9][0-9]{0,17}$/) }).strict().parse(req.body).versionId);
      const [v] = await all<{ version_id: number; weights_sha256: string | null; config_hash: string | null; release_state: string }>(db,
        `SELECT version_id, weights_sha256, config_hash, release_state FROM model_version WHERE version_id = ? AND model_id = ?`, [versionId, m]);
      if (!v) throw new Problem('not_found');
      const man = await manifest();
      if (!man || !v.weights_sha256 || !v.config_hash || man[m]?.weights_sha256 !== v.weights_sha256 || man[m]?.config_hash !== v.config_hash) {
        await recordGate(db, 'G21', 'model_version', v.version_id, 'evaluator', 'hash_mismatch');
        throw new Problem('conflict', 'hash_mismatch', 'G21');
      }
      if (v.release_state === 'retired') throw new Problem('conflict', 'version_retired', 'G21');
      const [stage, group] = EVAL_STAGE[m];
      const items = await all<{ item_id: number }>(db, `SELECT item_id FROM eval_item WHERE ${EVAL_TARGET[m] ?? "category <> 'caption_input'"} ORDER BY item_id`);
      if (!items.length) throw new Problem('conflict', 'no_eval_items', 'G21');
      const evalId = await withTx(db, async (conn) => {
        const [e] = await conn.query(`INSERT INTO evaluation (version_id, requested_by, item_total) VALUES (?, ?, ?)`, [versionId, req.staff!.memberId, items.length]);
        const id = (e as { insertId: number }).insertId;
        for (const it of items) {
          await conn.query(`INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, evaluation_id, eval_item_id, priority)
                            VALUES (?, 'eval', ?, ?, ?, ?, 50)`, [stage, group === 'gpu' && !cfg.gpuEnabled && m === 'M5' ? 'cpu_vision' : group, versionId, id, it.item_id]);
        }
        return id;
      }).catch((e) => { const s = parseSignal(e); if (s) throw new Problem('conflict', s.reason, 'G21'); throw e; });
      res.status(202).json(await runView(evalId));
    } catch (e) { next(e); }
  });

  async function runView(evaluationId: number) {
    const [e] = await all<Record<string, unknown>>(db,
      `SELECT e.evaluation_id, e.version_id, mv.model_id, e.verdict, e.rationale, p.item_total, p.done_count, p.incomplete_count, p.eligible
         FROM evaluation e JOIN v_promotion_eligibility p ON p.evaluation_id = e.evaluation_id
         JOIN model_version mv ON mv.version_id = e.version_id WHERE e.evaluation_id = ?`, [evaluationId]);
    if (!e) throw new Problem('not_found');
    const results = await all<Record<string, unknown>>(db,
      `SELECT r.item_id, r.status, r.result_path, r.misclass_label, r.processing_ms, i.expected_path
         FROM eval_item_result r JOIN eval_item i ON i.item_id = r.item_id WHERE r.evaluation_id = ? ORDER BY r.item_id`, [evaluationId]);
    return {
      id: String(e.evaluation_id), versionId: String(e.version_id), itemTotal: Number(e.item_total), itemDone: Number(e.done_count),
      doneCount: Number(e.done_count), incompleteCount: Number(e.incomplete_count), verdict: e.verdict ?? null, rationale: e.rationale ?? null,
      eligible: Boolean(Number(e.eligible)),
      results: results.map((x) => ({ evalItemId: String(x.item_id), status: x.status,
        expectedPath: modelExpected(String(e.model_id), (x.expected_path as string | null) ?? null), itemExpectedPath: x.expected_path ?? null,
        actualPath: x.result_path ?? null,
        outcome: null, downgradeReason: null, misclassCode: x.misclass_label ?? null, durationMs: x.processing_ms ?? null })),
    };
  }

  r.get('/v1/admin/eval-runs/:runId', evaluator, async (req, res, next) => {
    try { res.json(await runView(Number(req.params.runId))); } catch (e) { next(e); }
  });
  r.patch('/v1/admin/eval-runs/:runId', evaluator, async (req, res, next) => {
    try {
      const b = z.object({ verdict: z.enum(['pass', 'hold']), rationale: z.string().trim().min(1).max(2000) }).strict().safeParse(req.body);
      if (!b.success) throw new Problem('validation_failed', 'verdict_rationale', undefined, zodFields(b.error));
      const [u] = await db.query(`UPDATE evaluation SET verdict = ?, rationale = ?, judged_by = ?, judged_at = CURRENT_TIMESTAMP WHERE evaluation_id = ?`,
        [b.data.verdict, b.data.rationale, req.staff!.memberId, Number(req.params.runId)]);
      if ((u as { affectedRows: number }).affectedRows === 0) throw new Problem('not_found');
      res.json(await runView(Number(req.params.runId)));
    } catch (e) { next(e); }
  });

  // 승격(G22, D5): 직전 활성 → 롤백 후보, 이전 롤백 후보 → retired. 판정은 v_promotion_eligibility 한 곳(trg_release_event_bi)
  r.post('/v1/admin/models/:mid/promote', evaluator, async (req, res, next) => {
    try {
      const m = mid(req.params.mid);
      const b = z.object({ versionId: z.string().regex(/^[1-9][0-9]{0,17}$/), evalRunId: z.string().regex(/^[1-9][0-9]{0,17}$/) }).strict().parse(req.body);
      const to = Number(b.versionId), ev = Number(b.evalRunId);
      await withTx(db, async (conn) => {
        const [[v]] = (await conn.query(`SELECT version_id, license_confirmed, release_state FROM model_version WHERE version_id = ? AND model_id = ? FOR UPDATE`, [to, m])) as unknown as [{ version_id: number; license_confirmed: number; release_state: string }[]];
        if (!v) throw new Problem('not_found');
        if (!v.license_confirmed) throw new Problem('conflict', 'license_unconfirmed', 'G22');
        const [[el]] = (await conn.query(`SELECT eligible, incomplete_count FROM v_promotion_eligibility WHERE evaluation_id = ? AND version_id = ?`, [ev, to])) as unknown as [{ eligible: number; incomplete_count: number }[]];
        if (!el || !Number(el.eligible)) throw new Problem('conflict', el && Number(el.incomplete_count) > 0 ? 'eval_incomplete' : 'promotion_not_eligible', 'G22');
        const [[cur]] = (await conn.query(`SELECT version_id FROM model_version WHERE model_id = ? AND release_state = 'active' FOR UPDATE`, [m])) as unknown as [{ version_id: number }[]];
        await conn.query(`UPDATE model_version SET release_state = 'retired' WHERE model_id = ? AND release_state = 'rollback_candidate'`, [m]);
        if (cur) await conn.query(`UPDATE model_version SET release_state = 'rollback_candidate' WHERE version_id = ?`, [cur.version_id]);
        await conn.query(`UPDATE model_version SET release_state = 'active' WHERE version_id = ?`, [to]);
        await conn.query(`INSERT INTO release_event (model_id, kind, from_version_id, to_version_id, evaluation_id, actor) VALUES (?, 'promote', ?, ?, ?, ?)`,
          [m, cur?.version_id ?? null, to, ev, req.staff!.memberId]);
      }).catch(async (e) => {
        const s = parseSignal(e);
        const p = e instanceof Problem ? e : s ? new Problem('conflict', s.reason, 'G22') : e;
        if (p instanceof Problem && p.gate) await recordGate(db, p.gate, 'model_version', to, 'evaluator', p.reason ?? p.code);
        throw p;
      });
      res.json((await modelView(m))[0]);
    } catch (e) { next(e); }
  });

  r.post('/v1/admin/models/:mid/rollback', evaluator, async (req, res, next) => {
    try {
      const m = mid(req.params.mid);
      const b = z.object({ reason: z.string().trim().min(1).max(500) }).strict().safeParse(req.body);
      if (!b.success) throw new Problem('validation_failed', 'reason', undefined, zodFields(b.error));
      await withTx(db, async (conn) => {
        const [[rb]] = (await conn.query(`SELECT version_id FROM model_version WHERE model_id = ? AND release_state = 'rollback_candidate' FOR UPDATE`, [m])) as unknown as [{ version_id: number }[]];
        if (!rb) throw new Problem('conflict', 'no_rollback_candidate'); // UC9 E8 "첫 버전이라 되돌릴 후보가 없어요"
        const [[cur]] = (await conn.query(`SELECT version_id FROM model_version WHERE model_id = ? AND release_state = 'active' FOR UPDATE`, [m])) as unknown as [{ version_id: number }[]];
        await conn.query(`INSERT INTO release_event (model_id, kind, from_version_id, to_version_id, reason, actor) VALUES (?, 'rollback', ?, ?, ?, ?)`,
          [m, cur?.version_id ?? rb.version_id, rb.version_id, b.data.reason, req.staff!.memberId]);
        if (cur) await conn.query(`UPDATE model_version SET release_state = 'retired' WHERE version_id = ?`, [cur.version_id]);
        await conn.query(`UPDATE model_version SET release_state = 'active' WHERE version_id = ?`, [rb.version_id]); // 재평가 없이 즉시, 새 작업부터(D5)
      });
      res.json((await modelView(m))[0]);
    } catch (e) { next(e); }
  });

  r.post('/v1/admin/models/:mid/deactivate', evaluator, async (req, res, next) => {
    try {
      const m = mid(req.params.mid);
      const b = z.object({ reason: z.string().trim().min(1).max(500) }).strict().safeParse(req.body);
      if (!b.success) throw new Problem('validation_failed', 'reason', undefined, zodFields(b.error));
      await withTx(db, async (conn) => {
        const [[cur]] = (await conn.query(`SELECT version_id FROM model_version WHERE model_id = ? AND release_state = 'active' FOR UPDATE`, [m])) as unknown as [{ version_id: number }[]];
        if (!cur) throw new Problem('conflict', 'no_active_version');
        await conn.query(`UPDATE model_version SET release_state = 'retired' WHERE version_id = ?`, [cur.version_id]);
        await conn.query(`INSERT INTO release_event (model_id, kind, from_version_id, to_version_id, reason, actor) VALUES (?, 'deactivate', ?, ?, ?, ?)`,
          [m, cur.version_id, cur.version_id, b.data.reason, req.staff!.memberId]);
      });
      res.json((await modelView(m))[0]);
    } catch (e) { next(e); }
  });

  // 평가 항목(G20, BR-MDL-04): 팀원 제작 확인 필수, 사진은 평가 묶음 소유 객체(가족 데이터와 섞지 않음)
  r.get('/v1/admin/eval-items', readers, async (_req, res, next) => {
    try {
      const rows = await all<{ item_id: number; category: string; expected_path: string }>(db, `SELECT item_id, category, expected_path FROM eval_item ORDER BY item_id`);
      res.json(rows.map((i) => ({ id: String(i.item_id), kind: i.category, shootingCondition: null, expectedSuggestion: null, expectedPath: i.expected_path })));
    } catch (e) { next(e); }
  });
  r.post('/v1/admin/eval-items', evaluator, upload.single('photo'), async (req, res, next) => {
    try {
      const b = z.object({ category: z.enum(['person', 'non_person', 'capture_condition', 'sculpture', 'caption_input']),
        expectedPath: z.enum(['animated', 'relief', 'frame', 'sculpture', 'caption']), makerAttested: z.enum(['true']),
        inputText: z.string().max(2000).optional() }).strict().safeParse(req.body);
      if (!b.success) {
        await recordGate(db, 'G20', 'eval_item', null, 'evaluator', 'maker_or_fields');
        throw new Problem('validation_failed', 'maker_or_fields', 'G20', zodFields(b.error));
      }
      const isCaption = b.data.category === 'caption_input';
      if (isCaption ? !b.data.inputText || req.file : !req.file) throw new Problem('validation_failed', 'input_mismatch', 'G20');
      let objectId: number | null = null;
      if (!isCaption) {
        const type = await validateUpload(req.file!.buffer);
        const key = `evalset/${randomUUID().replace(/-/g, '')}.${type.ext}`;
        await storage.putNew(key, req.file!.buffer);
        const [o] = await db.query(`INSERT INTO stored_object (owner_kind, object_kind, object_key) VALUES ('eval_set', 'eval_input', ?)`, [key]);
        objectId = (o as { insertId: number }).insertId;
      }
      const [i] = await db.query(`INSERT INTO eval_item (category, expected_path, object_id, input_text, created_by, maker_attested) VALUES (?, ?, ?, ?, ?, TRUE)`,
        [b.data.category, b.data.expectedPath, objectId, isCaption ? b.data.inputText : null, req.staff!.memberId]);
      res.status(201).json({ id: String((i as { insertId: number }).insertId) });
    } catch (e) { next(e); }
  });

  return r;
}
