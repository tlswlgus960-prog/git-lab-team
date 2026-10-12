// 운영(T108·T110·T143, UC8, FR-12·13·26, BR-OPS-01~04, G1): 가족 이미지·식별 정보로 가는 경로 없음(BR-ACC-03).
import fs from 'node:fs/promises';
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import client from 'prom-client';
import type { Config } from '../../config.js';
import { requirePerm } from '../../auth/policy.js';
import { STAFF_COOKIE, loadSession } from '../../auth/session.js';
import { Problem } from '../../lib/problem.js';
import type { ModelApi } from './modelApi.js';
import { latestChecks } from './modelCheck.js';

const MODELS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'];
const all = async <T>(db: Pool, sql: string, p: unknown[] = []) => (await db.query(sql, p))[0] as T[];

export function opsRouter(db: Pool, cfg: Config, modelApi: ModelApi): Router {
  const r = Router();

  async function readiness(detail: boolean) {
    const checks = { db: false, queue: false, storage: false };
    try { await db.query('SELECT 1'); checks.db = true; } catch { /* 준비 안 됨 */ }
    try { await db.query(`SELECT 1 FROM stage_job LIMIT 1`); checks.queue = checks.db; } catch { /* 준비 안 됨 */ }
    try { await fs.mkdir(cfg.storageRoot, { recursive: true }); await fs.access(cfg.storageRoot, fs.constants.W_OK); checks.storage = true; } catch { /* 준비 안 됨 */ }
    const status = checks.db && checks.queue && checks.storage ? 'ready' : 'not_ready';
    const loads = await modelApi.models();
    const anyLoading = Boolean(loads?.some((m) => m.hint === 'model_loading'));
    if (!detail) return { status, anyLoading };
    const vers = checks.db ? await all<{ model_id: string; version_label: string; release_state: string; license_confirmed: number; serving_group: string }>(db,
      `SELECT m.model_id, m.serving_group, v.version_label, v.release_state, v.license_confirmed FROM model m
         LEFT JOIN model_version v ON v.model_id = m.model_id`) : [];
    let exposed = false;
    try { exposed = Boolean((await all<{ enabled: number }>(db, `SELECT enabled FROM feature_setting WHERE setting_key = 'sculpture_exposure'`))[0]?.enabled); } catch { /* */ }
    const models = MODELS.map((id) => {
      const rows = vers.filter((v) => v.model_id === id);
      const active = rows.find((v) => v.release_state === 'active' && v.license_confirmed);
      const group = rows[0]?.serving_group ?? 'cpu_vision';
      let state = 'unknown';
      if (id === 'M4') state = 'ready'; // 규칙 — 판정 워커 준비에 포함
      else if (id === 'M6' && !cfg.captionEnabled) state = 'inactive_tier';
      else if (id === 'M7' && (!exposed || !cfg.gpuEnabled)) state = 'hidden';
      else if (!active) state = rows.some((v) => !v.license_confirmed) ? 'inactive_license' : 'not_ready';
      else if (loads) {
        const l = loads.find((m) => m.modelId === id)?.load?.state;
        state = l === 'ready' || l === 'cold' ? (id === 'M5' && !cfg.gpuEnabled ? 'cpu_fallback' : 'ready') : l ? 'not_ready' : 'unknown';
      }
      return { modelId: id, servingGroup: id === 'M5' && !cfg.gpuEnabled ? 'cpu_vision' : group, state, activeVersion: active?.version_label ?? null };
    });
    // D20 ⑦: 팀원 세션이면 모델별 마지막 점검만 곁들인다(준비 확인이 점검을 일으키지 않음)
    const last = checks.db ? await latestChecks(db).catch(() => []) : [];
    for (const m of models) {
      const c = last.find((x) => x.modelId === m.modelId);
      (m as Record<string, unknown>).lastCheck = c ? { status: c.status, failReason: c.failReason, finishedAt: c.finishedAt } : null;
    }
    return { status, anyLoading, checks, models };
  }

  r.get('/live', (_req, res) => res.json({ status: 'live' }));
  r.get('/ready', async (req, res, next) => {
    try {
      const staff = await loadSession(db, 'staff', req.cookies?.[STAFF_COOKIE]).catch(() => null);
      const body = await readiness(Boolean(staff));
      res.status(body.status === 'ready' ? 200 : 503).json(body);
    } catch (e) { next(e); }
  });

  // --- 지표(FR-13·26, SD_03 v_metrics_*, §19 #18) ---
  async function metrics(from?: string, to?: string) {
    const period = Boolean(from || to);
    const f = from ?? '1970-01-01', t = to ?? '2999-12-31';
    const svc = period
      ? (await all<Record<string, number | null>>(db, `SELECT
          (SELECT SUM(CASE WHEN first_decision = 'like' THEN 1 ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN in_approval_base THEN 1 ELSE 0 END), 0)
             FROM artwork_outcome WHERE first_decided_at BETWEEN ? AND ?) first_result_approval_rate,
          (SELECT SUM(CASE WHEN is_modified THEN 1 ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN suggestion_at_confirm IN ('animated','relief','frame') THEN 1 ELSE 0 END), 0)
             FROM artwork_outcome WHERE confirmed_at BETWEEN ? AND ?) suggestion_modify_rate,
          (SELECT COUNT(*) FROM artwork_outcome WHERE result_cause = 'not_delivered' AND confirmed_at BETWEEN ? AND ?) not_delivered_count,
          (SELECT COUNT(*) FROM deletion_request WHERE status = 'incomplete' AND requested_at BETWEEN ? AND ?) deletion_incomplete_count,
          (SELECT COUNT(*) * 1.0 / NULLIF(COUNT(*) + (SELECT COUNT(*) FROM stage_job WHERE stage_kind = 'caption' AND status = 'done' AND finished_at BETWEEN ? AND ?), 0)
             FROM caption_check_failure WHERE occurred_at BETWEEN ? AND ?) caption_rule_fail_rate`, [f, t, f, t, f, t, f, t, f, t, f, t]))[0]
      : (await all<Record<string, number | null>>(db, `SELECT * FROM v_metrics_service`))[0];
    const pf = period ? `AND j.finished_at BETWEEN ? AND ?` : '';
    const pp = period ? [f, t] : [];
    const models = await all<{ model_id: string; version_label: string; serving_group: string; attempts: number; downgrade_rate: number | null; retry_rate: number | null }>(db,
      `SELECT mv.model_id, mv.version_label, j.serving_group, COUNT(*) attempts,
              SUM(CASE WHEN j.downgrade_cause IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) downgrade_rate,
              SUM(CASE WHEN j.attempt_count > 1 THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) retry_rate
         FROM stage_job j JOIN model_version mv ON mv.version_id = j.model_version_id
        WHERE j.status <> 'cancelled' AND j.origin NOT IN ('eval','check') ${pf}
        GROUP BY mv.model_id, mv.version_label, j.serving_group`, pp);
    const durs = await all<{ model_id: string; version_label: string; ms: number }>(db,
      `SELECT mv.model_id, mv.version_label, TIMESTAMPDIFF(MICROSECOND, j.started_at, j.finished_at) / 1000 ms
         FROM stage_job j JOIN model_version mv ON mv.version_id = j.model_version_id
        WHERE j.status IN ('done','done_downgraded') AND j.origin NOT IN ('eval','check') AND j.started_at IS NOT NULL AND j.finished_at IS NOT NULL ${pf}`, pp);
    const p95 = (m: string, v: string) => {
      const xs = durs.filter((d) => d.model_id === m && d.version_label === v).map((d) => Number(d.ms)).sort((a, b) => a - b);
      return xs.length ? Math.round(xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]) : null; // p95는 앱에서만(SD_03 주석)
    };
    const causes = await all<{ result_cause: string; n: number }>(db, period
      ? `SELECT result_cause, COUNT(*) n FROM artwork_outcome WHERE result_cause IS NOT NULL AND confirmed_at BETWEEN ? AND ? GROUP BY result_cause`
      : `SELECT result_cause, n FROM v_cause_breakdown`, period ? [f, t] : []);
    const infra = await all<{ error_class: string; n: number }>(db,
      `SELECT j.error_class, COUNT(*) n FROM stage_job j WHERE j.error_class IS NOT NULL AND j.status <> 'cancelled' AND j.origin NOT IN ('eval','check') ${pf} GROUP BY j.error_class`, pp);
    const queues = await all<{ serving_group: string; waiting: number; oldest: number | null }>(db,
      `SELECT serving_group, COUNT(*) waiting, TIMESTAMPDIFF(SECOND, MIN(queued_at), CURRENT_TIMESTAMP) oldest
         FROM stage_job WHERE status IN ('queued','retry_wait') AND available_at <= UTC_TIMESTAMP() GROUP BY serving_group`);
    const extQ = await all<{ waiting: number; oldest: number | null }>(db,
      `SELECT COUNT(*) waiting, TIMESTAMPDIFF(SECOND, MIN(queued_at), CURRENT_TIMESTAMP) oldest FROM external_job WHERE status = 'queued'`);
    const ext = await all<{ endpoint: string; accepted: number; rejected: number }>(db, `SELECT * FROM v_external_usage`);
    const count = (c: string) => Number(causes.find((x) => x.result_cause === c)?.n ?? 0);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      period: { from: from ?? null, to: to ?? null },
      service: {
        firstApprovalRate: num(svc?.first_result_approval_rate), suggestionModifyRate: num(svc?.suggestion_modify_rate),
        captionRuleFailRate: num(svc?.caption_rule_fail_rate), unreachedCount: Number(svc?.not_delivered_count ?? 0),
        deletionIncompleteCount: Number(svc?.deletion_incomplete_count ?? 0),
      },
      causes: {
        guardianChoice: count('guardian_choice'), modelDowngrade: count('model_downgrade'), guardianSwitch: count('guardian_switch'),
        infraFailure: Object.fromEntries(infra.map((i) => [i.error_class, Number(i.n)])), unreached: count('not_delivered'),
      },
      models: models.map((m) => ({ modelId: m.model_id, modelVersion: m.version_label, servingGroup: m.serving_group, attempts: Number(m.attempts),
        downgradeRate: num(m.downgrade_rate), p95Ms: p95(m.model_id, m.version_label), retryRate: num(m.retry_rate) })),
      queues: [...queues.map((q) => ({ servingGroup: q.serving_group, waiting: Number(q.waiting), oldestWaitSeconds: num(q.oldest) })),
        { servingGroup: 'external', waiting: Number(extQ[0]?.waiting ?? 0), oldestWaitSeconds: num(extQ[0]?.oldest) }],
      external: ext.map((e) => ({ function: e.endpoint, calls: Number(e.accepted) + Number(e.rejected), rejected: Number(e.rejected) })),
    };
  }

  r.get('/v1/admin/metrics', requirePerm(db, 'metrics.read'), // D21: 세 역할 읽기(UC9 A1·UC11 A5), D24
    async (req, res, next) => {
    try {
      const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString().slice(0, 19).replace('T', ' ') : undefined);
      if ((req.query.from && !iso(req.query.from)) || (req.query.to && !iso(req.query.to))) throw new Problem('validation_failed', 'period');
      res.json(await metrics(iso(req.query.from), iso(req.query.to)));
    } catch (e) { next(e); }
  });

  r.get('/v1/admin/unreached', requirePerm(db, 'unreached.read'), async (_req, res, next) => {
    try {
      const rows = await all<Record<string, unknown>>(db,
        `SELECT t.job_id, j.stage_kind, t.model_id, t.version_label, t.error_class, t.attempt_count, t.finished_at,
                TIMESTAMPDIFF(MICROSECOND, j.started_at, j.finished_at) / 1000 ms
           FROM v_not_delivered_trace t JOIN stage_job j ON j.job_id = t.job_id ORDER BY t.finished_at DESC LIMIT 200`);
      res.json(rows.map((x) => ({ stageJobId: String(x.job_id), stage: x.stage_kind, modelId: x.model_id, modelVersion: x.version_label,
        errorClass: x.error_class, attempt: Number(x.attempt_count), durationMs: x.ms === null ? null : Math.round(Number(x.ms)),
        finishedAt: x.finished_at ? new Date(x.finished_at as Date).toISOString() : null })));
    } catch (e) { next(e); }
  });

  // --- 모델 적재 상태(T143, A 모델적재 §4) ---
  r.get('/v1/ops/models', requirePerm(db, 'models.read'), async (_req, res, next) => {
    try { res.json({ models: (await modelApi.models()) ?? [] }); } catch (e) { next(e); }
  });
  r.post('/v1/ops/models/:id/warmup', requirePerm(db, 'models.warmup'), async (req, res, next) => {
    try {
      const out = await modelApi.warmup(req.params.id);
      if (!out) throw new Problem('not_saved', 'model_api_unreachable');
      if (out.status === 409) throw new Problem('conflict', 'm6_preload_at_start_only');
      if (out.status === 404) throw new Problem('not_found');
      res.status(202).json(out.body);
    } catch (e) { next(e); }
  });

  // --- /metrics(Prometheus, 라벨은 model_id·model_version·serving_group·cause·error_class만, BR-OPS-04) ---
  const reg = new client.Registry();
  const g = (name: string, help: string, labels: string[] = []) => new client.Gauge({ name, help, labelNames: labels, registers: [reg] });
  const gauges = {
    approval: g('uam_first_result_approval_rate', '첫 결과 승인율(정의와 검증 계획이며 실적 아님)'),
    modify: g('uam_suggestion_modify_rate', '판정 수정률'),
    unreached: g('uam_not_delivered_total', '결과 미도달 수(목표 0)'),
    delIncomplete: g('uam_deletion_incomplete_total', '삭제 미완료 수'),
    cause: g('uam_result_cause_total', '결과 원인 5분류', ['cause']),
    infra: g('uam_infra_failure_total', '인프라 실패(오류 분류별)', ['error_class']),
    downgrade: g('uam_model_downgrade_rate', '모델별 낮춤률', ['model_id', 'model_version', 'serving_group']),
    retry: g('uam_model_retry_rate', '모델별 재시도율', ['model_id', 'model_version', 'serving_group']),
    p95: g('uam_model_duration_p95_ms', '모델별 처리 시간 p95', ['model_id', 'model_version', 'serving_group']),
    queue: g('uam_queue_waiting', '서빙군별 큐 적체', ['serving_group']),
  };
  r.get('/metrics', async (_req, res, next) => {
    try {
      const m = await metrics();
      reg.resetMetrics();
      if (m.service.firstApprovalRate !== null) gauges.approval.set(m.service.firstApprovalRate);
      if (m.service.suggestionModifyRate !== null) gauges.modify.set(m.service.suggestionModifyRate);
      gauges.unreached.set(m.service.unreachedCount);
      gauges.delIncomplete.set(m.service.deletionIncompleteCount);
      for (const [cause, n] of Object.entries({ guardian_choice: m.causes.guardianChoice, model_downgrade: m.causes.modelDowngrade, guardian_switch: m.causes.guardianSwitch, not_delivered: m.causes.unreached })) gauges.cause.set({ cause }, n);
      for (const [error_class, n] of Object.entries(m.causes.infraFailure)) gauges.infra.set({ error_class }, n);
      for (const x of m.models) {
        const l = { model_id: x.modelId, model_version: x.modelVersion, serving_group: x.servingGroup };
        if (x.downgradeRate !== null) gauges.downgrade.set(l, x.downgradeRate);
        if (x.retryRate !== null) gauges.retry.set(l, x.retryRate);
        if (x.p95Ms !== null) gauges.p95.set(l, x.p95Ms);
      }
      for (const q of m.queues) gauges.queue.set({ serving_group: q.servingGroup }, q.waiting);
      res.type(reg.contentType).send(await reg.metrics());
    } catch (e) { next(e); }
  });

  return r;
}
