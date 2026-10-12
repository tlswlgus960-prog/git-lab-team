// 'API활용'(T124, UC11, S12, BR-API-07~09, G23, research R-11): 명세 4묶음 + 모델 버전 대조, 평가 묶음 작품만으로 시험 호출.
// app-api는 API 키를 받지 않는다(BR-API-06) — 시험 호출은 app-api가 test 키로 model-api를 대신 부른다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import YAML from 'yaml';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { requirePerm } from '../../auth/policy.js';
import { Problem } from '../../lib/problem.js';
import { recordGate } from '../../lib/gateEvent.js';
import type { StoragePort } from '../../storage/LocalFsDriver.js';

type Spec = { info?: Record<string, unknown>; paths?: Record<string, Record<string, { tags?: string[] }>> } & Record<string, unknown>;
const GROUP_OF_TAG: Record<string, string> = { '인증': '보호자 앱', '보호자 앱': '보호자 앱', '운영': '운영', '관리': '관리' };
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', heic: 'image/heic' };

export function apiGuideRouter(db: Pool, cfg: Config, storage: StoragePort): Router {
  const r = Router();
  const readers = requirePerm(db, 'apiGuide.use'); // D24
  const modelBase = cfg.modelApiUrl.replace(/\/$/, '');
  let appSpec: Spec | null = null;
  let lastModel: { spec: Spec; at: Date } | null = null;

  const loadAppSpec = async () => (appSpec ??= YAML.parse(await fs.readFile(path.join(cfg.contractsDir, 'openapi.yaml'), 'utf8')) as Spec);

  // R-11: app-api 명세 원천(비밀 아님)
  r.get('/openapi.json', async (_req, res, next) => {
    try { res.json(await loadAppSpec()); } catch (e) { next(e); }
  });

  r.get('/v1/admin/api-guide/spec', readers, async (_req, res, next) => {
    try {
      const app = await loadAppSpec();
      const groups = ['보호자 앱', '운영', '관리'].map((name) => {
        const paths: Record<string, Record<string, unknown>> = {};
        for (const [p, ops] of Object.entries(app.paths ?? {})) {
          for (const [m, op] of Object.entries(ops)) {
            if (typeof op === 'object' && op && GROUP_OF_TAG[op.tags?.[0] ?? ''] === name) (paths[p] ??= {})[m] = op;
          }
        }
        return { name, spec: { ...app, paths } as Spec };
      });
      let stale = false;
      try {
        const m = await fetch(`${modelBase}/v1/models/openapi.json`, { signal: AbortSignal.timeout(1500) });
        if (!m.ok) throw new Error('model_spec');
        lastModel = { spec: (await m.json()) as Spec, at: new Date() };
      } catch { stale = true; } // 못 읽으면 마지막 확인 명세와 시각
      groups.push({ name: '모델 기능', spec: (lastModel?.spec ?? {}) as Spec });
      const declared = (lastModel?.spec.info?.['x-model-versions'] ?? {}) as Record<string, string | null>;
      const [active] = await db.query(`SELECT model_id, version_label FROM model_version WHERE release_state = 'active'`);
      const act = new Map((active as { model_id: string; version_label: string }[]).map((x) => [x.model_id, x.version_label]));
      const versionCheck = Object.entries(declared).map(([modelId, specVersion]) => ({
        modelId, specVersion: specVersion ?? null, activeVersion: act.get(modelId) ?? null, match: (specVersion ?? null) === (act.get(modelId) ?? null),
      }));
      res.json({ groups, versionCheck, fetchedAt: lastModel?.at.toISOString() ?? null, stale });
    } catch (e) { next(e); }
  });

  // 시험 호출(G23, BR-API-09): 평가 묶음 사진 항목만. 가족 작품은 받을 길이 없다
  r.post('/v1/admin/api-guide/test-call', readers, async (req, res, next) => {
    try {
      const b = z.object({ function: z.enum(['segment', 'classify', 'pose', 'relief']), evalItemId: z.string().regex(/^\d+$/) }).strict().safeParse(req.body);
      const item = b.success ? ((await db.query(
        `SELECT i.item_id, o.object_key FROM eval_item i JOIN stored_object o ON o.object_id = i.object_id AND o.owner_kind = 'eval_set' WHERE i.item_id = ?`,
        [Number(b.data.evalItemId)]))[0] as { item_id: number; object_key: string }[])[0] : undefined;
      if (!b.success || !item) {
        await recordGate(db, 'G23', 'external_call', null, req.staff!.roles.includes('integrator') ? 'integrator' : 'operator', 'not_eval_item');
        throw new Problem('validation_failed', 'not_eval_item', 'G23');
      }
      if (!cfg.apiGuideTestKey) throw new Problem('not_saved', 'test_key_missing');
      const buf = await storage.read(item.object_key);
      const ext = item.object_key.split('.').pop() ?? 'png';
      const form = new FormData();
      form.append('image', new Blob([new Uint8Array(buf)], { type: MIME[ext] ?? 'application/octet-stream' }), `eval.${ext}`);
      await forward(res, await reach(`${modelBase}/v1/models/${b.data.function}`, {
        method: 'POST', headers: { 'X-API-Key': cfg.apiGuideTestKey }, body: form, signal: AbortSignal.timeout(10_000),
      }));
    } catch (e) { next(e); }
  });

  r.get('/v1/admin/api-guide/test-call/:jobId', readers, async (req, res, next) => {
    try {
      if (!/^[0-9]+$/.test(req.params.jobId)) throw new Problem('not_found');
      if (!cfg.apiGuideTestKey) throw new Problem('not_saved', 'test_key_missing');
      await forward(res, await reach(`${modelBase}/v1/models/jobs/${req.params.jobId}`, {
        headers: { 'X-API-Key': cfg.apiGuideTestKey }, signal: AbortSignal.timeout(3000),
      }));
    } catch (e) { next(e); }
  });

  return r;
}

/** model-api에 닿지 못하면 503 — 아무것도 등록되지 않음 */
async function reach(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init); } catch { throw new Problem('not_saved', 'model_api_unreachable'); }
}

/** model-api 응답을 상태·본문 그대로 전달(거절 코드 포함). */
async function forward(res: import('express').Response, m: Response) {
  const body = await m.json().catch(() => null);
  const retry = m.headers.get('retry-after');
  if (retry) res.setHeader('Retry-After', retry);
  res.status(m.status).type(m.ok ? 'application/json' : 'application/problem+json').send(JSON.stringify(body));
}
