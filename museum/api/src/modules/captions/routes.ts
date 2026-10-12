// 설명 초안(T128, UC10, FR-27, BR-CAP-01~07, G13~G16, D1·D6, stage-job §11, llm-contract). P0에서는 CAPTION_ENABLED=false라 모두 404.
// 입력은 허용 필드만 서버가 다시 조립한다(이미지·별칭·제목 없음). 걸린 초안 문장은 받지도 저장하지도 않는다(BR-CAP-07).
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { withTx } from '../../db/pool.js';
import { guardianAuth } from '../../auth/guards.js';
import { Problem, parseSignal, zodFields } from '../../lib/problem.js';
import { recordGate } from '../../lib/gateEvent.js';
import type { CaptionOk, InfraClass, LlmPort } from './llmServer.js';

const schema = z.object({
  keywords: z.array(z.string().max(20)).max(5),
  selectedTags: z.array(z.string().max(40)).max(5),
  fallback: z.enum(['template', 'direct']).optional(),
  body: z.string().min(1).max(1000).optional(),
}).strict();
const putSchema = z.object({ action: z.enum(['edit', 'approve', 'discard']), body: z.string().min(1).max(1000).optional() }).strict();
const FAIL: Record<string, string> = { fail_event: 'event', fail_emotion: 'emotion', fail_development: 'development' };
const STATE: Record<string, string> = { pending: 'pending_approval', approved: 'approved', discarded: 'discarded' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const one = async <T>(db: Pool | PoolConnection, sql: string, p: unknown[]) => ((await db.query(sql, p))[0] as T[])[0];

type Row = { caption_id: number; source: string; body: string; ai_badge: number; is_edited: number; status: string; generation_count: number };
export const captionView = (c: Row) => ({
  id: String(c.caption_id), body: c.body, source: c.source, aiAuthored: Boolean(c.ai_badge), edited: Boolean(c.is_edited),
  state: STATE[c.status], generationCount: Number(c.generation_count),
});
export const currentCaption = (db: Pool | PoolConnection, artworkId: number) => one<Row>(db,
  `SELECT caption_id, source, body, ai_badge, is_edited, status, generation_count FROM caption
    WHERE artwork_id = ? AND status <> 'discarded' ORDER BY (status = 'approved') DESC, caption_id DESC LIMIT 1`, [artworkId]);

/** 템플릿 기준선 — LLM 서버가 멈춰도 쓰도록 app-api에서 만든다(UC10 특별 요구, llm-contract §3.5 [추론 문구]). 없는 칸은 뺀다. */
export function templateCaption(age: number | null, words: string[]): string {
  const parts: string[] = [];
  if (age !== null) parts.push(`${age}살 때 그린 작품이에요.`);
  const uniq = [...new Set(words)];
  if (uniq.length) parts.push(`${uniq.join('·')}을(를) 그렸어요.`);
  return parts.join(' ') || '아이가 그린 작품이에요.'; // llm-server cap.template과 같은 문장
}

export function captionsRouter(db: Pool, cfg: Config, llm: LlmPort, retryDelaysMs = [1000, 3000]): Router {
  const r = Router();
  const auth = guardianAuth(db, { requireFamily: true });
  const enabled = (_req: unknown, _res: unknown, next: (e?: unknown) => void) => next(cfg.captionEnabled ? undefined : new Problem('not_found'));

  /** 작품 잠금 + 공통 거절(E3·E7). 트랜잭션 안에서 부른다 */
  async function lockArtwork(conn: PoolConnection, familyId: number, id: number) {
    const a = await one<{ status: string }>(conn, `SELECT status FROM artwork WHERE artwork_id = ? AND family_id = ? FOR UPDATE`, [id, familyId]);
    if (!a) throw new Problem('not_found');
    if (a.status === 'deleting') throw new Problem('conflict', 'deleting');
    if (await one(conn, `SELECT 1 x FROM caption WHERE artwork_id = ? AND status = 'approved'`, [id])) throw new Problem('conflict', 'caption_locked');
  }
  /** 새 초안은 이전 미승인 초안을 대체한다(A1). 누적 생성 횟수를 돌려준다 */
  async function replacePending(conn: PoolConnection, id: number): Promise<number> {
    const g = await one<{ n: number | null }>(conn, `SELECT MAX(generation_count) n FROM caption WHERE artwork_id = ?`, [id]);
    await conn.query(`UPDATE caption SET status = 'discarded' WHERE artwork_id = ? AND status = 'pending'`, [id]);
    return Number(g?.n ?? 0);
  }
  async function insertCaption(conn: PoolConnection, id: number, v: { jobId: number | null; keywords: string[]; source: string; body: string; gen: number }) {
    const [ins] = await conn.query(`INSERT INTO caption (artwork_id, job_id, keywords, source, body, generation_count) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, v.jobId, v.keywords.length ? JSON.stringify(v.keywords) : null, v.source, v.body, v.gen]);
    return (ins as { insertId: number }).insertId;
  }
  const gateFail = async (e: unknown) => {
    const s = parseSignal(e);
    if (s) throw new Problem('conflict', s.reason === 'approved_caption_fixed' ? 'caption_locked' : s.reason === 'artwork_deleting' ? 'deleting' : s.reason);
    throw e;
  };

  r.get('/v1/captions/model-status', enabled, auth, async (_req, res, next) => {
    try {
      const v = await llm.ready(); // 모델 이름·버전·원래 상태값은 싣지 않는다(BR-SUG-02)
      const st = v?.model?.state;
      res.json({ warming: st === 'cold' || st === 'loading', maxWaitSeconds: v?.model?.maxObservedLoadSeconds ?? null, busy: Number(v?.queue?.waiting ?? 0) > 0 });
    } catch (e) { next(e); }
  });

  r.post('/v1/artworks/:id/captions', enabled, auth, async (req, res, next) => {
    const familyId = req.guardian!.familyId!;
    const id = Number(req.params.id);
    try {
      const p = schema.safeParse(req.body);
      if (!p.success) throw new Problem('validation_failed', 'invalid_fields', undefined, zodFields(p.error));
      const keywords = p.data.keywords.map((k) => k.trim()).filter(Boolean);
      const tags = [...new Set(p.data.selectedTags)];
      const st = await one<{ age_at_creation: number | null; age_auto: number | null; made_on: Date | null; utterance: string | null }>(db,
        `SELECT s.age_at_creation, s.age_auto, s.made_on, s.utterance FROM artwork a LEFT JOIN story s ON s.artwork_id = a.artwork_id WHERE a.artwork_id = ? AND a.family_id = ?`, [id, familyId]);
      if (!st) throw new Problem('not_found');

      // A3 직접 쓰기 — 출처 direct, "AI 작성" 없음, 단계 작업 없음
      if (p.data.fallback === 'direct') {
        if (!p.data.body?.trim()) throw new Problem('validation_failed', 'body_required', undefined, [{ name: 'body', reason: 'required' }]);
        const cid = await withTx(db, async (conn) => {
          await lockArtwork(conn, familyId, id);
          await replacePending(conn, id);
          return insertCaption(conn, id, { jobId: null, keywords, source: 'direct', body: p.data.body!, gen: 0 });
        }).catch(gateFail);
        return res.status(201).json(captionView((await one<Row>(db, `SELECT * FROM caption WHERE caption_id = ?`, [cid]))!));
      }

      if (!keywords.length && !tags.length) throw new Problem('validation_failed', 'keywords_required', 'G14'); // E6
      if (tags.length) { // BR-CAP-06: M2 후보 중 고른 것만
        const [rows] = await db.query(`SELECT label FROM tag_candidate WHERE artwork_id = ? AND label IN (?)`, [id, tags]);
        if ((rows as unknown[]).length !== tags.length) throw new Problem('validation_failed', 'tag_not_candidate', 'G14', [{ name: 'selectedTags', reason: 'not_candidate' }]);
      }

      // E1 인프라 소진 뒤 보호자가 고른 템플릿 — LLM을 부르지 않고, 설명 낮춤률에 넣지 않는다(단계 작업 없음)
      if (p.data.fallback === 'template') {
        const cid = await withTx(db, async (conn) => {
          await lockArtwork(conn, familyId, id);
          const gen = await replacePending(conn, id);
          return insertCaption(conn, id, { jobId: null, keywords, source: 'template', body: templateCaption(st.age_auto ? null : st.age_at_creation, [...keywords, ...tags]) /* D46 ⑩ 자동 나이는 단정하지 않음 */, gen });
        }).catch(gateFail);
        return res.status(201).json(captionView((await one<Row>(db, `SELECT * FROM caption WHERE caption_id = ?`, [cid]))!));
      }

      // G13: M6 활성 버전(라이선스 확인)이 없으면 LLM을 부르지 않는다(E4 — 템플릿·직접 입력만)
      const m6 = await one<{ version_id: number }>(db, `SELECT version_id FROM model_version WHERE model_id = 'M6' AND release_state = 'active' AND license_confirmed = TRUE`, []);
      if (!m6) throw new Problem('conflict', 'model_disabled', 'G13');

      const publicId = randomUUID();
      const jobId = await withTx(db, async (conn) => {
        await lockArtwork(conn, familyId, id);
        const [j] = await conn.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count, started_at)
                                      VALUES (?, 'caption', 'caption', 'llm', ?, 'running', 1, CURRENT_TIMESTAMP)`, [id, m6.version_id]);
        return (j as { insertId: number }).insertId;
      }).catch(gateFail);

      const input = {
        requestId: publicId, keywords, tags,
        ...(st.utterance ? { words: st.utterance } : {}),
        ...(st.age_at_creation !== null ? { ageAtMaking: st.age_at_creation } : {}),
        ...(st.made_on ? { madeOn: new Date(st.made_on).toISOString().slice(0, 10) } : {}),
      };
      // 인프라 재시도: 첫 시도 포함 최대 3회, 1초·3초 뒤(stage-job §11). 규칙 검사 재생성은 llm-server 안에서 일어나며 시도로 세지 않는다
      let reply = await llm.caption(input);
      for (let attempt = 1; reply.outcome !== 'ok' && reply.outcome !== 'cancelled' && attempt < 3; attempt++) {
        await db.query(`UPDATE stage_job SET attempt_count = attempt_count + 1 WHERE job_id = ?`, [jobId]);
        await sleep(retryDelaysMs[attempt - 1] ?? 0);
        reply = await llm.caption(input);
      }

      if (reply.outcome !== 'ok') {
        const cancelled = reply.outcome === 'cancelled';
        await db.query(`UPDATE stage_job SET status = ?, error_class = ?, finished_at = CURRENT_TIMESTAMP WHERE job_id = ?`,
          [cancelled ? 'cancelled' : 'failed', cancelled ? null : reply.outcome, jobId]);
        throw new Problem('llm_unavailable', reply.outcome as InfraClass, 'G15'); // "지금은 AI 초안을 만들 수 없어요" — template / later / direct
      }

      const ok = reply as CaptionOk;
      const fails = (ok.failClasses ?? (ok.lastFailClass ? [ok.lastFailClass] : [])).map((f) => FAIL[f]).filter(Boolean);
      const cid = await withTx(db, async (conn) => {
        try { await lockArtwork(conn, familyId, id); } catch (e) {
          // E7 삭제 중이거나 그새 다른 보호자가 승인함 — 결과를 저장하지 않고 작업만 닫는다
          await db.query(`UPDATE stage_job SET status = 'cancelled', cancel_requested_at = CURRENT_TIMESTAMP, stopped_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP WHERE job_id = ?`, [jobId]);
          throw e;
        }
        for (const f of fails) await conn.query(`INSERT INTO caption_check_failure (job_id, failure_class) VALUES (?, ?)`, [jobId, f]);
        if (fails.length) await recordGate(conn, 'G16', 'stage_job', jobId, 'system', ok.source === 'template' ? 'llm_to_template' : 'regenerated');
        const downgraded = ok.source === 'template';
        await conn.query(`UPDATE stage_job SET status = ?, downgrade_cause = ?, finished_at = CURRENT_TIMESTAMP WHERE job_id = ?`,
          [downgraded ? 'done_downgraded' : 'done', downgraded ? 'llm_to_template' : null, jobId]);
        const gen = await replacePending(conn, id);
        return insertCaption(conn, id, { jobId, keywords, source: ok.source, body: ok.body, gen: gen + Number(ok.generationCount ?? 1) });
      }).catch(gateFail);
      res.status(201).json(captionView((await one<Row>(db, `SELECT * FROM caption WHERE caption_id = ?`, [cid]))!));
    } catch (e) {
      if (e instanceof Problem && e.gate) await recordGate(db, e.gate, 'artwork', id, 'guardian', e.reason ?? e.code);
      next(e);
    }
  });

  // 수정·승인·폐기(BR-CAP-04, D6): 고쳐도 출처 유지·수정 표시, 승인하면 고정
  r.put('/v1/artworks/:id/captions/:cid', enabled, auth, async (req, res, next) => {
    const familyId = req.guardian!.familyId!;
    const id = Number(req.params.id), cid = Number(req.params.cid);
    try {
      const p = putSchema.safeParse(req.body);
      if (!p.success || (p.data.action === 'edit' && !p.data.body?.trim())) throw new Problem('validation_failed', 'invalid_fields', undefined, p.success ? [{ name: 'body', reason: 'blank' }] : zodFields(p.error));
      await withTx(db, async (conn) => {
        const a = await one<{ status: string }>(conn, `SELECT status FROM artwork WHERE artwork_id = ? AND family_id = ? FOR UPDATE`, [id, familyId]);
        if (!a) throw new Problem('not_found');
        if (a.status === 'deleting') throw new Problem('conflict', 'deleting');
        const c = await one<{ status: string }>(conn, `SELECT status FROM caption WHERE caption_id = ? AND artwork_id = ? FOR UPDATE`, [cid, id]);
        if (!c) throw new Problem('not_found');
        if (c.status === 'approved') throw new Problem('conflict', 'caption_locked');
        if (c.status === 'discarded') throw new Problem('conflict', 'caption_discarded');
        if (p.data.action === 'edit') await conn.query(`UPDATE caption SET body = ?, is_edited = (source <> 'direct') WHERE caption_id = ?`, [p.data.body, cid]);
        else if (p.data.action === 'approve') await conn.query(`UPDATE caption SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE caption_id = ?`, [cid]);
        else await conn.query(`UPDATE caption SET status = 'discarded' WHERE caption_id = ?`, [cid]);
      }).catch(gateFail);
      res.json(captionView((await one<Row>(db, `SELECT * FROM caption WHERE caption_id = ?`, [cid]))!));
    } catch (e) { next(e); }
  });

  return r;
}
