// 미술관 마을 · 이웃(D40, SD_02 §17-13 D·E·F, UC_16, SD_03 family_neighbor · neighbor_invite).
// 이웃은 초대 링크로만(한 번 · 7일 · 가족당 대기 1건, family_invite와 같은 규칙) · 상한 30가족 [추론] · 만든·공동 보호자 모두.
// 모르는 가족은 존재(건물 모양)만 — 아이 정보 없음(BR-ACC-01). 방문 미술관은 그림 · 별칭 · 제목 · 캐릭터만, 파일은 받을 때마다 이웃 재확인.
import { createHmac, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { withTx } from '../../db/pool.js';
import { guardianAuth } from '../../auth/guards.js';
import { Problem, zodFields } from '../../lib/problem.js';
import type { StoragePort } from '../../storage/LocalFsDriver.js';
import { hashToken } from '../auth/tokens.js';
import { lookOf } from '../children/routes.js';
import { signVisitToken, verifyVisitToken } from '../files/token.js';

const NEIGHBOR_MAX = 30;   // [추론] SD_02 §17-13 E
const STRANGER_MAX = 12;   // [추론] SD_02 §17-13 D
const TOWN_COLS = 6;       // 건물 자리 = 가족 번호로 정해진 격자

type Db = Pool | PoolConnection;
const rowsOf = async <T>(db: Db, sql: string, p: unknown[] = []) => (await db.query(sql, p))[0] as T[];
const pair = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)];
const cell = (familyId: number) => ({ x: (familyId - 1) % TOWN_COLS, y: Math.floor((familyId - 1) / TOWN_COLS) });

/** 이웃 가족 번호들 */
async function neighborIds(db: Db, familyId: number, lock = false): Promise<number[]> {
  const r = await rowsOf<{ f: number }>(db,
    `SELECT CASE WHEN family_low = ? THEN family_high ELSE family_low END f FROM family_neighbor WHERE family_low = ? OR family_high = ?${lock ? ' FOR UPDATE' : ''}`,
    [familyId, familyId, familyId]);
  return r.map((x) => Number(x.f));
}

async function areNeighbors(db: Db, a: number, b: number): Promise<boolean> {
  return (await rowsOf(db, `SELECT 1 FROM family_neighbor WHERE family_low = ? AND family_high = ?`, pair(a, b))).length > 0;
}

type ChildRow = { child_id: number; family_id: number; alias: string; character_kind: string | null; character_color: string | null; museum_style: string | null };
/** 가족들의 아이(지우는 중 제외, 만든 순) */
async function childrenOf(db: Db, familyIds: number[]): Promise<ChildRow[]> {
  if (!familyIds.length) return [];
  return rowsOf<ChildRow>(db,
    `SELECT c.child_id, c.family_id, c.alias, c.character_kind, c.character_color, c.museum_style FROM child c
      WHERE c.family_id IN (?) AND NOT EXISTS (SELECT 1 FROM deletion_request d WHERE d.target_kind = 'child' AND d.child_id = c.child_id AND d.status NOT IN ('completed','incomplete'))
      ORDER BY c.child_id`, [familyIds]);
}

export function neighborsRouter(db: Pool, cfg: Config, storage: StoragePort, accel = process.env.FILES_ACCEL === '1'): Router {
  const r = Router();
  const auth = guardianAuth(db, { requireFamily: true });
  /** 건물 id — 가족 번호를 드러내지 않는 서명 값 */
  const buildingId = (familyId: number) => 'b_' + createHmac('sha256', cfg.sessionSecret).update(`building.${familyId}`).digest('base64url').slice(0, 16);

  async function buildings(familyIds: number[], relation: (f: number) => 'mine' | 'neighbor' | 'stranger') {
    const kids = await childrenOf(db, familyIds);
    return familyIds.map((f) => {
      const mine = kids.filter((c) => Number(c.family_id) === f);
      const rel = relation(f);
      const b = { id: buildingId(f), ...cell(f), relation: rel, style: mine[0]?.museum_style ?? null }; // 건물 모양 = 첫 아이의 미술관 모양 [추론]
      return rel === 'stranger' ? b : { ...b, children: mine.map((c) => ({ id: String(c.child_id), alias: c.alias, ...lookOf(c) })) };
    });
  }

  r.get('/v1/town', auth, async (req, res, next) => {
    try {
      const me = req.guardian!.familyId!;
      const nbs = await neighborIds(db, me);
      const { x, y } = cell(me);
      const strangers = await rowsOf<{ family_id: number }>(db,
        `SELECT f.family_id FROM family f
          WHERE f.family_id NOT IN (?) AND EXISTS (SELECT 1 FROM guardian_account g WHERE g.family_id = f.family_id)
          ORDER BY ABS(((f.family_id - 1) % ${TOWN_COLS}) - ?) + ABS(FLOOR((f.family_id - 1) / ${TOWN_COLS}) - ?), f.family_id LIMIT ${STRANGER_MAX}`,
        [[me, ...nbs], x, y]);
      const ids = [me, ...nbs, ...strangers.map((s) => Number(s.family_id))];
      res.json({ buildings: await buildings(ids, (f) => (f === me ? 'mine' : nbs.includes(f) ? 'neighbor' : 'stranger')) });
    } catch (e) { next(e); }
  });

  r.get('/v1/neighbors', auth, async (req, res, next) => {
    try {
      res.json(await buildings(await neighborIds(db, req.guardian!.familyId!), () => 'neighbor'));
    } catch (e) { next(e); }
  });

  r.delete('/v1/neighbors/:buildingId', auth, async (req, res, next) => {
    try {
      const me = req.guardian!.familyId!;
      const other = (await neighborIds(db, me)).find((f) => buildingId(f) === req.params.buildingId);
      if (other === undefined) throw new Problem('not_found');
      await db.query(`DELETE FROM family_neighbor WHERE family_low = ? AND family_high = ?`, pair(me, other)); // 문은 즉시 잠김(방문 파일도 매번 확인)
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // --- 초대 링크(한 번 · 7일 · 대기 1건) ---
  r.get('/v1/neighbors/invites', auth, async (req, res, next) => {
    try {
      const rows = await rowsOf<{ invite_id: number; expires_at: Date }>(db,
        `SELECT invite_id, expires_at FROM neighbor_invite WHERE family_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY invite_id`,
        [req.guardian!.familyId]);
      res.json(rows.map((i) => ({ id: String(i.invite_id), expiresAt: new Date(i.expires_at).toISOString() })));
    } catch (e) { next(e); }
  });

  r.post('/v1/neighbors/invites', auth, async (req, res, next) => {
    const g = req.guardian!;
    try {
      const b = z.object({}).strict().safeParse(req.body ?? {});
      if (!b.success) throw new Problem('validation_failed', 'invalid_fields', undefined, zodFields(b.error));
      const out = await withTx(db, async (conn) => {
        if ((await neighborIds(conn, g.familyId!)).length >= NEIGHBOR_MAX) throw new Problem('conflict', 'neighbor_full');
        await conn.query(`UPDATE neighbor_invite SET revoked_at = UTC_TIMESTAMP() WHERE family_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`, [g.familyId]);
        const token = randomBytes(32).toString('base64url');
        const [ins] = await conn.query(
          `INSERT INTO neighbor_invite (family_id, invited_by, token_hash, expires_at) VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL 7 DAY)`,
          [g.familyId, g.accountId, hashToken(token)]);
        const id = (ins as { insertId: number }).insertId;
        const [row] = await rowsOf<{ expires_at: Date }>(conn, `SELECT expires_at FROM neighbor_invite WHERE invite_id = ?`, [id]);
        return { id: String(id), link: `${cfg.appBaseUrl}/app/neighbor?token=${encodeURIComponent(token)}`, expiresAt: new Date(row.expires_at).toISOString() };
      });
      res.status(201).json(out);
    } catch (e) { next(e); }
  });

  r.delete('/v1/neighbors/invites/:inviteId', auth, async (req, res, next) => {
    try {
      const [u] = await db.query(`UPDATE neighbor_invite SET revoked_at = UTC_TIMESTAMP() WHERE invite_id = ? AND family_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
        [Number(req.params.inviteId), req.guardian!.familyId]);
      if ((u as { affectedRows: number }).affectedRows === 0) throw new Problem('not_found');
      res.status(204).end();
    } catch (e) { next(e); }
  });

  r.post('/v1/neighbors/accept', auth, async (req, res, next) => {
    const me = req.guardian!.familyId!;
    try {
      const b = z.object({ token: z.string().min(10).max(200) }).strict().safeParse(req.body);
      if (!b.success) throw new Problem('token_invalid', 'token_invalid');
      await withTx(db, async (conn) => {
        const [inv] = await rowsOf<{ invite_id: number; family_id: number }>(conn,
          `SELECT invite_id, family_id FROM neighbor_invite
            WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE`, [hashToken(b.data.token)]);
        if (!inv) throw new Problem('token_invalid', 'token_invalid'); // 쓰임·만료·취소 구분 없음
        const other = Number(inv.family_id);
        if (other === me) throw new Problem('conflict', 'own_family');
        if (!(await areNeighbors(conn, me, other))) {
          const full = (await neighborIds(conn, me, true)).length >= NEIGHBOR_MAX || (await neighborIds(conn, other, true)).length >= NEIGHBOR_MAX;
          if (full) throw new Problem('conflict', 'neighbor_full');
          await conn.query(`INSERT INTO family_neighbor (family_low, family_high) VALUES (?, ?)`, pair(me, other));
        }
        await conn.query(`UPDATE neighbor_invite SET accepted_at = UTC_TIMESTAMP(), accepted_family = ? WHERE invite_id = ?`, [me, inv.invite_id]);
      });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // --- 방문(F): 그림 · 별칭 · 제목 · 캐릭터만. 이웃이 아니면 404 ---
  r.get('/v1/visit/children/:childId/gallery', auth, async (req, res, next) => {
    try {
      const me = req.guardian!.familyId!;
      const [child] = await childrenOf(db, await neighborIds(db, me)).then((cs) => cs.filter((c) => Number(c.child_id) === Number(req.params.childId)));
      if (!child) throw new Problem('not_found');
      const owner = Number(child.family_id);
      const rows = await rowsOf<Record<string, unknown>>(db,
        `SELECT g.artwork_id, g.age_group, g.title, g.display_kind, g.result_object_id, g.making, j.cutout_object_id, ao.object_id original_id, aw.display_object_id
           FROM v_gallery g
           JOIN artwork aw ON aw.artwork_id = g.artwork_id
           LEFT JOIN judgment j ON j.artwork_id = g.artwork_id
           LEFT JOIN artwork_original ao ON ao.artwork_id = g.artwork_id
          WHERE g.family_id = ? AND g.child_id = ?
          ORDER BY g.age_group IS NULL, g.age_group, g.made_on, g.artwork_id`, [owner, child.child_id]);
      const url = (id: unknown) => (id ? `/v1/visit/files/${signVisitToken(cfg.sessionSecret, Number(id), owner, me)}` : null);
      const rooms = new Map<number | null, unknown[]>();
      for (const g of rows) {
        const kind = g.display_kind as string;
        const photo = g.display_object_id ?? g.original_id;        // 그림(고친 사진이 있으면 그것) — 원본 파일 받기는 없다
        const item = {
          id: String(g.artwork_id), kind, title: (g.title as string | null) ?? null,
          primaryUrl: url(kind === 'frame' ? photo : g.result_object_id),
          auxUrl: kind === 'relief' ? url(g.cutout_object_id) : kind === 'animated' ? url(photo) : null,
          making: Boolean(g.making), // D46 만들기 → 받침대(D45)
        };
        const age = g.age_group === null ? null : Number(g.age_group);
        if (!rooms.has(age)) rooms.set(age, []);
        rooms.get(age)!.push(item);
      }
      res.json({
        child: { id: String(child.child_id), alias: child.alias, ...lookOf(child) },
        rooms: [...rooms.values()].map((items, i) => ({ room: i + 1, items })), // 나이는 싣지 않는다 — 전시실 1·2…
      });
    } catch (e) { next(e); }
  });

  r.get('/v1/visit/files/:token', auth, async (req, res, next) => {
    try {
      const me = req.guardian!.familyId!;
      const t = verifyVisitToken(cfg.sessionSecret, req.params.token);
      if (!t || t.viewerFamilyId !== me || !(await areNeighbors(db, me, t.ownerFamilyId))) throw new Problem('not_found');
      const [o] = await rowsOf<{ object_key: string }>(db,
        `SELECT object_key FROM stored_object WHERE object_id = ? AND family_id = ? AND owner_kind = 'family'`, [t.objectId, t.ownerFamilyId]);
      if (!o) throw new Problem('not_found');
      res.setHeader('Cache-Control', 'private, max-age=60');
      if (accel) { res.setHeader('X-Accel-Redirect', `/_files/${o.object_key}`); res.end(); return; }
      res.sendFile(storage.absolutePath(o.object_key));
    } catch (e) { next(e); }
  });

  return r;
}
