// 가족 전시(T091, UC6, FR-8, G12, BR-EXH-01~07, D3·D10): v_gallery만 읽는다(전시 판정 한 곳).
// 아이별 → 연령 묶음 → 제작일 순. 낮춤·원인·점수는 싣지 않는다. 모델 호출 없음.
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Config } from '../../config.js';
import { guardianAuth } from '../../auth/guards.js';
import { Problem } from '../../lib/problem.js';
import { signFileToken } from '../files/token.js';

export function galleryRouter(db: Pool, cfg: Config): Router {
  const r = Router();
  r.get('/v1/gallery', guardianAuth(db, { requireFamily: true }), async (req, res, next) => {
    try {
      const familyId = req.guardian!.familyId!;
      const childId = Number(req.query.child);
      const [c] = await db.query(`SELECT child_id FROM child WHERE child_id = ? AND family_id = ?`, [childId, familyId]);
      if (!(c as unknown[]).length) throw new Problem('not_found');
      const where: string[] = ['g.family_id = ?', 'g.child_id = ?'];
      const p: unknown[] = [familyId, childId];
      if (typeof req.query.q === 'string' && req.query.q.trim()) { where.push('g.title LIKE ?'); p.push(`%${req.query.q.trim().replace(/[%_]/g, '\\$&')}%`); }
      if (typeof req.query.madeOn === 'string') { where.push('g.made_on = ?'); p.push(req.query.madeOn); }
      const [rows] = await db.query(
        `SELECT g.artwork_id, g.age_group, g.made_on, g.title, g.title_auto, g.made_on_auto, g.age_auto, g.utterance, g.guardian_note, g.display_kind, g.result_object_id,
                g.caption_body, g.ai_badge, g.making, j.cutout_object_id, ao.object_id original_id, aw.display_object_id
           FROM v_gallery g
           JOIN artwork aw ON aw.artwork_id = g.artwork_id
           LEFT JOIN judgment j ON j.artwork_id = g.artwork_id
           LEFT JOIN artwork_original ao ON ao.artwork_id = g.artwork_id
          WHERE ${where.join(' AND ')}
          ORDER BY g.age_group IS NULL, g.age_group, g.made_on, g.artwork_id`, p); // D34: 나이 미정(NULL)은 맨 뒤
      const url = (id: number | null) => (id ? `/v1/files/${signFileToken(cfg.sessionSecret, Number(id), familyId)}` : null);
      const groups = new Map<number | null, unknown[]>();
      for (const g of rows as Record<string, unknown>[]) {
        const kind = g.display_kind as string;
        const item = {
          id: String(g.artwork_id), kind,
          primaryUrl: kind === 'frame' ? null : url(g.result_object_id as number | null),
          auxUrl: kind === 'relief' ? url(g.cutout_object_id as number | null) : null,
          posterUrl: null,
          originalUrl: url(g.original_id as number | null),
          photoUrl: url((g.display_object_id ?? g.original_id) as number | null), // D39 고친 사진(없으면 원본)
          making: Boolean(g.making), // D46 만들기 → 미술관 받침대(D45)
          title: g.title, titleAuto: Boolean(g.title_auto), madeOnAuto: Boolean(g.made_on_auto), ageAuto: Boolean(g.age_auto), madeOn: new Date(g.made_on as Date).toISOString().slice(0, 10),
          ageAtMaking: g.age_group === null ? null : Number(g.age_group),
          childWords: g.utterance ?? null,
          guardianNote: g.guardian_note ?? null, // D25 — 한마디와 따로
          aiCaption: cfg.captionEnabled && g.caption_body ? { body: g.caption_body, aiAuthored: Boolean(g.ai_badge) } : null,
          backsideEstimated: kind === 'sculpture',
        };
        const age = g.age_group === null ? null : Number(g.age_group); // D34: 나이 미정
        if (!groups.has(age)) groups.set(age, []);
        groups.get(age)!.push(item);
      }
      res.json({ childId: String(childId), groups: [...groups].map(([ageAtMaking, items]) => ({ ageAtMaking, items })) });
    } catch (e) { next(e); }
  });
  return r;
}
