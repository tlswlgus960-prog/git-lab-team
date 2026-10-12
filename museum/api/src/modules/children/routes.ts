// 아이 API(T051, UC1, FR-1 v2.2, BR-CHD-01·02, G4). 별칭만 받는다. 별칭은 앞뒤 공백 뺀 1~20자(D22, T149). 중복 검사 없음 — 같으면 저장하고 aliasDuplicate로 안내(D18).
// 다른 가족 아이는 404로 존재를 숨긴다(G0). 삭제는 US5(deletion 모듈).
// D40(SD_02 §17-13 A): 캐릭터·색·미술관 모양은 고를 때만 — 만들 때 안 보내면 NULL, 고칠 때는 보낸 칸만 바꾼다.
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { guardianAuth } from '../../auth/guards.js';
import { Problem, zodFields } from '../../lib/problem.js';
import { recordGate } from '../../lib/gateEvent.js';

export const CHARACTER_KINDS = ['bear', 'rabbit', 'cat', 'dog', 'fox', 'penguin', 'dino', 'owl'] as const;
export const CHARACTER_COLORS = ['sunflower', 'peach', 'sky', 'leaf', 'lavender', 'cloud'] as const;
export const MUSEUM_STYLES = ['glass_pyramid', 'white_spiral', 'column_temple', 'clock_station', 'brick_chimney', 'golden_dome', 'hanok_roof', 'silver_wave'] as const;

const childSchema = z.object({
  alias: z.string(),
  character: z.enum(CHARACTER_KINDS).optional(),
  color: z.enum(CHARACTER_COLORS).optional(),
  museumStyle: z.enum(MUSEUM_STYLES).optional(),
}).strict();
type Look = { character?: string; color?: string; museumStyle?: string };

function cleanChild(body: unknown): { alias: string } & Look {
  const r = childSchema.safeParse(body); // 실명·생년월일 같은 다른 필드는 받지 않는다(BR-CHD-01)
  if (!r.success) throw new Problem('validation_failed', 'invalid_fields', 'G4', zodFields(r.error));
  const alias = r.data.alias.trim();
  if (!alias) throw new Problem('validation_failed', 'alias_blank', 'G4', [{ name: 'alias', reason: 'blank' }]);
  if ([...alias].length > 20) throw new Problem('validation_failed', 'alias_too_long', 'G4', [{ name: 'alias', reason: 'too_long', message: '별칭은 20자 이하로 넣어 주세요.' }]);
  return { ...r.data, alias };
}

type LookRow = { character_kind: string | null; character_color: string | null; museum_style: string | null };
export const lookOf = (c: LookRow) => ({ character: c.character_kind, color: c.character_color, museumStyle: c.museum_style });

export function childrenRouter(db: Pool): Router {
  const r = Router();
  const auth = guardianAuth(db, { requireFamily: true });

  const duplicated = async (familyId: number, alias: string, exceptId?: number) => {
    const [rows] = await db.query(
      `SELECT COUNT(*) n FROM child WHERE family_id = ? AND alias = ? AND child_id <> ?`, [familyId, alias, exceptId ?? 0]);
    return Number((rows as { n: number }[])[0].n) > 0;
  };

  r.get('/v1/children', auth, async (req, res, next) => {
    try {
      const [rows] = await db.query(
        `SELECT v.child_id, v.alias, v.artwork_count, c.character_kind, c.character_color, c.museum_style
           FROM v_child_artwork_count v JOIN child c ON c.child_id = v.child_id
          WHERE v.family_id = ? AND NOT EXISTS (SELECT 1 FROM deletion_request d WHERE d.target_kind = 'child' AND d.child_id = v.child_id AND d.status NOT IN ('completed','incomplete'))
          ORDER BY v.child_id`,
        [req.guardian!.familyId],
      );
      res.json((rows as ({ child_id: number; alias: string; artwork_count: number } & LookRow)[])
        .map((c) => ({ id: String(c.child_id), alias: c.alias, artworkCount: Number(c.artwork_count), ...lookOf(c) })));
    } catch (e) { next(e); }
  });

  r.post('/v1/children', auth, async (req, res, next) => {
    try {
      let body: ReturnType<typeof cleanChild>;
      try { body = cleanChild(req.body); } catch (e) {
        await recordGate(db, 'G4', 'child', null, 'guardian', (e as Problem).reason ?? 'invalid');
        throw e;
      }
      const { alias } = body;
      const familyId = req.guardian!.familyId!;
      const dup = await duplicated(familyId, alias);
      let id: number;
      const look = { character: body.character ?? null, color: body.color ?? null, museumStyle: body.museumStyle ?? null };
      try {
        const [ins] = await db.query(`INSERT INTO child (family_id, alias, character_kind, character_color, museum_style) VALUES (?, ?, ?, ?, ?)`,
          [familyId, alias, look.character, look.color, look.museumStyle]);
        id = (ins as { insertId: number }).insertId;
      } catch { throw new Problem('not_saved', 'child_not_saved', 'G3'); }
      res.status(201).json({ id: String(id), alias, artworkCount: 0, aliasDuplicate: dup, ...look });
    } catch (e) { next(e); }
  });

  r.patch('/v1/children/:childId', auth, async (req, res, next) => {
    try {
      const body = cleanChild(req.body);
      const { alias } = body;
      const familyId = req.guardian!.familyId!;
      const id = Number(req.params.childId);
      const [upd] = await db.query(
        `UPDATE child SET alias = ?, character_kind = COALESCE(?, character_kind), character_color = COALESCE(?, character_color),
                museum_style = COALESCE(?, museum_style), updated_at = CURRENT_TIMESTAMP WHERE child_id = ? AND family_id = ?`,
        [alias, body.character ?? null, body.color ?? null, body.museumStyle ?? null, id, familyId]);
      if ((upd as { affectedRows: number }).affectedRows === 0) throw new Problem('not_found');
      const [rows] = await db.query(
        `SELECT v.artwork_count, c.character_kind, c.character_color, c.museum_style FROM child c JOIN v_child_artwork_count v ON v.child_id = c.child_id WHERE c.child_id = ?`, [id]);
      const row = (rows as ({ artwork_count: number } & LookRow)[])[0];
      res.json({ id: String(id), alias, artworkCount: Number(row?.artwork_count ?? 0), aliasDuplicate: await duplicated(familyId, alias, id), ...lookOf(row) });
    } catch (e) { next(e); }
  });

  return r;
}
