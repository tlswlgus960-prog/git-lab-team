// 삭제 요청 API(T098, UC7, FR-10, G18, BR-ACC-04·BR-DEL-01·05): 보호자만, 202, 목록·전시에서 즉시 빠짐.
// 삭제 진행 조회(T147, D21, S9): 없는 번호·다른 가족·끝난 삭제(미완료 포함)는 모두 done — 존재를 드러내지 않는다.
import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { withTx } from '../../db/pool.js';
import { guardianAuth } from '../../auth/guards.js';
import { Problem } from '../../lib/problem.js';
import { recordGate } from '../../lib/gateEvent.js';
import { requestArtworkDeletion } from './request.js';

export function deletionRouter(db: Pool): Router {
  const r = Router();
  const auth = guardianAuth(db, { requireFamily: true });
  const fail = async (id: number, kind: 'artwork' | 'child', e: unknown) => {
    if (e instanceof Problem) throw e;
    await recordGate(db, 'G18', kind, id, 'guardian', 'db');
    throw new Problem('not_saved', 'deletion_not_saved', 'G18'); // "삭제되지 않았어요 - 아무것도 바뀌지 않았어요"
  };

  r.delete('/v1/artworks/:id', auth, async (req, res, next) => {
    const id = Number(req.params.id);
    try {
      await withTx(db, async (conn) => {
        const [rows] = await conn.query(`SELECT status FROM artwork WHERE artwork_id = ? AND family_id = ? FOR UPDATE`, [id, req.guardian!.familyId]);
        const a = (rows as { status: string }[])[0];
        if (!a) throw new Problem('not_found');
        if (a.status === 'deleting') return; // 이미 삭제 중 — 같은 202
        await requestArtworkDeletion(conn, id, 'guardian', req.guardian!.accountId);
      }).catch((e) => fail(id, 'artwork', e));
      res.status(202).end();
    } catch (e) { next(e); }
  });

  r.delete('/v1/children/:id', auth, async (req, res, next) => {
    const id = Number(req.params.id);
    try {
      await withTx(db, async (conn) => {
        const [c] = await conn.query(`SELECT child_id FROM child WHERE child_id = ? AND family_id = ? FOR UPDATE`, [id, req.guardian!.familyId]);
        if (!(c as unknown[]).length) throw new Problem('not_found');
        const [open] = await conn.query(`SELECT deletion_id FROM deletion_request WHERE target_kind = 'child' AND child_id = ? AND status NOT IN ('completed','incomplete')`, [id]);
        if ((open as unknown[]).length) return;
        const [arts] = await conn.query(`SELECT artwork_id FROM artwork WHERE child_id = ? AND status <> 'deleting' FOR UPDATE`, [id]);
        for (const a of arts as { artwork_id: number }[]) await requestArtworkDeletion(conn, a.artwork_id, 'guardian', req.guardian!.accountId);
        await conn.query(`INSERT INTO deletion_request (target_kind, origin, child_id, requested_by, status) VALUES ('child', 'guardian', ?, ?, 'waiting_stop')`, [id, req.guardian!.accountId]);
      }).catch((e) => fail(id, 'child', e));
      res.status(202).end();
    } catch (e) { next(e); }
  });
  type Progress = { state: 'accepted' | 'waiting_stop' | 'deleting_files' | 'done'; gate: 'G19' | null };
  const progressOf = async (deletionIds: number[], statuses: string[]): Promise<Progress> => {
    if (!deletionIds.length) return { state: 'done', gate: null };
    const [held] = await db.query(
      `SELECT 1 FROM gate_event WHERE gate_id = 'G19' AND subject_kind = 'deletion' AND released_at IS NULL AND subject_id IN (?) LIMIT 1`, [deletionIds]);
    if ((held as unknown[]).length) return { state: 'waiting_stop', gate: 'G19' };
    if (statuses.includes('deleting_files')) return { state: 'deleting_files', gate: null };
    return { state: 'accepted', gate: null }; // 멈춤 확인 전(sweeper가 아직 보지 않음)
  };
  const OPEN = `('accepted','waiting_stop','deleting_files')`;

  r.get('/v1/artworks/:id/deletion', auth, async (req, res, next) => {
    try {
      const [rows] = await db.query(
        `SELECT d.deletion_id, d.status FROM deletion_request d JOIN artwork a ON a.artwork_id = d.artwork_id
          WHERE d.target_kind = 'artwork' AND d.artwork_id = ? AND a.family_id = ? AND d.status IN ${OPEN}`,
        [Number(req.params.id) || 0, req.guardian!.familyId]);
      const rs = rows as { deletion_id: number; status: string }[];
      res.json(await progressOf(rs.map((x) => x.deletion_id), rs.map((x) => x.status)));
    } catch (e) { next(e); }
  });

  r.get('/v1/children/:id/deletion', auth, async (req, res, next) => {
    try {
      const id = Number(req.params.id) || 0;
      const [own] = await db.query(
        `SELECT d.deletion_id FROM deletion_request d JOIN child c ON c.child_id = d.child_id
          WHERE d.target_kind = 'child' AND d.child_id = ? AND c.family_id = ? AND d.status IN ${OPEN}`, [id, req.guardian!.familyId]);
      if (!(own as unknown[]).length) { res.json({ state: 'done', gate: null }); return; }
      // 아이 삭제는 그 아이 작품들의 삭제가 끝나야 끝난다 — 작품 쪽 진행을 모아 보인다
      const [arts] = await db.query(
        `SELECT d.deletion_id, d.status FROM deletion_request d JOIN artwork a ON a.artwork_id = d.artwork_id
          WHERE d.target_kind = 'artwork' AND a.child_id = ? AND d.status IN ${OPEN}`, [id]);
      const rs = arts as { deletion_id: number; status: string }[];
      const p = await progressOf(rs.map((x) => x.deletion_id), rs.map((x) => x.status));
      res.json(p.state === 'done' ? { state: 'deleting_files', gate: null } : p); // 작품은 끝났고 아이 기록 정리만 남음
    } catch (e) { next(e); }
  });
  return r;
}
