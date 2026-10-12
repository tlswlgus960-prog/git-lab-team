// 이야기(T090·T142·T163, UC5, FR-7, G11·G12, BR-STY-01~04, FR-9 동시 수정): 부분 저장, 한마디·보호자 감상평은 받은 그대로(트림·교정 없음).
// 전시 여부는 저장하지 않는다(v_exhibit_gate). 공동 보호자 동시 수정은 baseUpdatedAt 비교로 409 story_conflict.
import type { PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import { Problem } from '../../lib/problem.js';

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // 서비스 지역(한국, UTC+9) 기준 오늘
export const storySchema = z.object({
  title: z.string().max(100).nullable().optional(),
  madeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ageAtMaking: z.number().int().min(0).max(18).nullable().optional(),
  childWords: z.string().max(2000).nullable().optional(),
  guardianNote: z.string().max(1000).nullable().optional(), // D25 보호자 감상평 — 전시 조건 아님
  baseUpdatedAt: z.string().datetime().nullable().optional(),
}).strict();

export async function saveStory(conn: PoolConnection, familyId: number, artworkId: number, body: unknown): Promise<void> {
  const r = storySchema.safeParse(body);
  if (!r.success) {
    throw new Problem('validation_failed', 'invalid_fields', 'G11', r.error.issues.map((i) => ({ name: String(i.path[0] ?? ''), reason: i.code })));
  }
  const s = r.data;
  if (s.madeOn && s.madeOn > today()) throw new Problem('validation_failed', 'made_on_in_future', 'G11', [{ name: 'madeOn', reason: 'future' }]);
  if (typeof s.title === 'string' && !s.title.trim()) throw new Problem('validation_failed', 'title_blank', 'G11', [{ name: 'title', reason: 'blank' }]);

  const [rows] = await conn.query(`SELECT status FROM artwork WHERE artwork_id = ? AND family_id = ? FOR UPDATE`, [artworkId, familyId]);
  const a = (rows as { status: string }[])[0];
  if (!a) throw new Problem('not_found');
  if (a.status === 'deleting') throw new Problem('conflict', 'artwork_deleting', 'G11');
  const [cur] = await conn.query(`SELECT updated_at FROM story WHERE artwork_id = ? FOR UPDATE`, [artworkId]);
  const existing = (cur as { updated_at: Date }[])[0];
  if (existing && s.baseUpdatedAt !== undefined) {
    const base = s.baseUpdatedAt ? new Date(s.baseUpdatedAt).getTime() : null;
    if (base === null || Math.floor(base / 1000) !== Math.floor(new Date(existing.updated_at).getTime() / 1000)) {
      throw new Problem('conflict', 'story_conflict', 'G11'); // "다른 보호자가 먼저 고쳤어요"
    }
  }
  const cols: [string, unknown][] = [];
  if (s.title !== undefined) cols.push(['title', s.title === null ? null : s.title.trim()]);
  if (typeof s.title === 'string') cols.push(['title_auto', false]); // D34: 보호자가 제목을 붙이면 자동 제목이 아니다
  if (s.madeOn !== undefined) cols.push(['made_on', s.madeOn]);
  if (s.ageAtMaking !== undefined) cols.push(['age_at_creation', s.ageAtMaking]);
  if (s.childWords !== undefined) cols.push(['utterance', s.childWords]); // BR-STY-03 원문 그대로
  if (s.guardianNote !== undefined) cols.push(['guardian_note', s.guardianNote]); // BR-STY-04 원문 그대로
  if (!existing) {
    await conn.query(
      `INSERT INTO story (artwork_id${cols.map(([c]) => `, ${c}`).join('')}, updated_at) VALUES (?${cols.map(() => ', ?').join('')}, CURRENT_TIMESTAMP)`,
      [artworkId, ...cols.map(([, v]) => v)],
    );
  } else if (cols.length) {
    await conn.query(`UPDATE story SET ${cols.map(([c]) => `${c} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE artwork_id = ?`,
      [...cols.map(([, v]) => v), artworkId]);
  }
}
