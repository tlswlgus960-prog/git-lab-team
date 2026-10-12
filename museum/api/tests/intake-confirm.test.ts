// US2 시험(T056 접수·T057 확정): FR-2·3·21, UC2, G5·G6·G8·G17, BR-INT-01~05, BR-SUG-02·03·05, stage-job §2·§6, D14.
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { familyWithChild, jpg, png, seedModels, upload } from './helpers/fixtures.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => { await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']); });

const q = async <T>(sql: string, p: unknown[] = []) => (await t.db.query(sql, p))[0] as T[];
const filesIn = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];

describe('접수(G5·G6)', () => {
  it('202 바로 전시(D34 원본 액자·자동 제목), 판정은 권유용으로 돈다, 원본 0440, split 등록·judge 잠금, 같은 요청 번호는 1건(BR-INT-03)', async () => {
    const { a, childId } = await familyWithChild(t, 'i1@test.local');
    const key = '11111111-1111-4111-8111-111111111111';
    const r = await upload(a, childId, await png(), key).expect(202);
    expect(r.body).toMatchObject({ state: 'exhibited', exhibited: true, hungResultKind: 'frame' }); // D34
    expect(r.body.story).toMatchObject({ title: '제목 없는 그림 1', titleAuto: true, ageAtMaking: null, madeOnAuto: true, ageAuto: true }); // D46 ⑩ 비운 칸은 자동 표시
    expect(r.body.story.madeOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await q<{ status: string }>('SELECT status FROM artwork'))[0].status).toBe('judging'); // 처리 상태는 판정 중(권유)
    expect(r.body.originalUrl).toMatch(/^\/v1\/files\//);
    const again = await upload(a, childId, await png(), key).expect(202);
    expect(again.body.id).toBe(r.body.id);
    expect((await q('SELECT * FROM artwork')).length).toBe(1);
    const jobs = await q<{ stage_kind: string; locked: number; model_version_id: number }>(
      `SELECT stage_kind, available_at > UTC_TIMESTAMP() + INTERVAL 1 DAY locked, model_version_id FROM stage_job ORDER BY job_id`);
    expect(jobs.map((j) => [j.stage_kind, Number(j.locked)])).toEqual([['split', 0], ['judge', 1]]);
    expect(jobs.every((j) => j.model_version_id)).toBe(true);
    const [o] = await q<{ object_key: string }>(`SELECT object_key FROM stored_object WHERE object_kind = 'original'`);
    expect(o.object_key).toMatch(/^family\/[0-9a-f]{32}\/original\/[0-9a-f]{32}\.png$/);
    expect(fs.statSync(path.join(t.store, o.object_key)).mode & 0o777).toBe(0o440);
    await a.get(r.body.originalUrl).expect(200);
  });
  it('JPEG도 받는다, 형식 밖 400 format·판독 불가 400 unreadable·20MB 초과 413·요청 번호 없음 400', async () => {
    const { a, childId } = await familyWithChild(t, 'i2@test.local');
    await upload(a, childId, await jpg(), undefined, 'x.jpg').expect(202);
    expect((await upload(a, childId, Buffer.from('hello'), undefined, 'x.png')).body.reason).toBe('format');
    const broken = Buffer.concat([(await png()).subarray(0, 16), Buffer.alloc(50, 7)]);
    expect((await upload(a, childId, broken)).body.reason).toBe('unreadable');
    expect((await upload(a, childId, Buffer.concat([await png(), Buffer.alloc(20 * 1024 * 1024)]))).status).toBe(413);
    expect((await a.post('/v1/artworks').field('childId', childId).attach('photo', await png(), 'p.png')).status).toBe(400);
    expect((await q(`SELECT * FROM gate_event WHERE gate_id = 'G5'`)).length).toBeGreaterThanOrEqual(3);
  });
  it('DB 저장 실패면 503 not_saved, 기록·원본 파일 흔적 0(G6, Scenario 9)', async () => {
    const { a, childId } = await familyWithChild(t, 'i3@test.local');
    const before = filesIn(path.join(t.store, 'family')).length;
    await t.db.query(`CREATE TRIGGER t_fail BEFORE INSERT ON artwork_original FOR EACH ROW SIGNAL SQLSTATE '45001' SET MESSAGE_TEXT = 'injected'`);
    try {
      const r = await upload(a, childId, await png());
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('not_saved');
    } finally { await t.db.query('DROP TRIGGER t_fail'); }
    expect((await q('SELECT * FROM artwork')).length).toBe(0);
    expect(filesIn(path.join(t.store, 'family')).length).toBe(before);
  });
  it('다른 가족의 아이로는 접수 404, 다른 가족 작품 상세 404(G0)', async () => {
    const A = await familyWithChild(t, 'i4@test.local');
    const B = await familyWithChild(t, 'i5@test.local');
    expect((await upload(B.a, A.childId, await png())).status).toBe(404);
    const r = await upload(A.a, A.childId, await png()).expect(202);
    expect((await B.a.get(`/v1/artworks/${r.body.id}`)).status).toBe(404);
    expect((await B.a.get(r.body.originalUrl)).status).toBe(404);
  });
  it('판정 모델이 비활성이면 제안 없이 확정 대기 — 그래도 원본 액자로 전시(clarify, G7 · D34)', async () => {
    await seedModels(t.db, ['M5']);
    const { a, childId } = await familyWithChild(t, 'i6@test.local');
    const r = await upload(a, childId, await png()).expect(202);
    expect(r.body).toMatchObject({ state: 'exhibited', exhibited: true, suggestion: 'none' });
    expect((await q<{ status: string }>('SELECT status FROM artwork'))[0].status).toBe('awaiting_confirm');
    expect((await q('SELECT * FROM stage_job')).length).toBe(0);
    expect(r.body.unavailableChoices).toContainEqual({ choice: 'animated', reason: 'model_disabled' });
  });
});

describe('확정(G8·G17, stage-job §2·§6)', () => {
  const judged = async (email: string, suggestion: string, splitOk: number) => {
    const f = await familyWithChild(t, email);
    const r = await upload(f.a, f.childId, await png()).expect(202);
    await t.db.query(`UPDATE stage_job SET status = 'done', finished_at = started_at WHERE artwork_id = ?`, [r.body.id]);
    await t.db.query(`INSERT INTO judgment (artwork_id, split_ok, suggestion, suggestion_state, person_score) VALUES (?, ?, ?, 'presented', 0.9460)`, [r.body.id, splitOk, suggestion]);
    await t.db.query(`UPDATE artwork SET status = 'awaiting_confirm' WHERE artwork_id = ?`, [r.body.id]);
    return { ...f, id: r.body.id as string };
  };
  it('제안과 다르게 확정 허용, 수정 여부 기록, 액자는 이미 걸려 있어 작업 없음(D34), 점수는 응답에 없음', async () => {
    const f = await judged('c1@test.local', 'animated', 1);
    const d = await f.a.get(`/v1/artworks/${f.id}`).expect(200);
    expect(d.body.suggestion).toBe('animated');
    expect(JSON.stringify(d.body)).not.toMatch(/score|0\.946/);
    const r = await f.a.post(`/v1/artworks/${f.id}/confirm`).send({ kind: 'frame' }).expect(200);
    expect(r.body).toMatchObject({ state: 'exhibited', exhibited: true, confirmedKind: 'frame', hungResultKind: 'frame' });
    const [o] = await q<{ suggestion_at_confirm: string; is_modified: number }>(`SELECT suggestion_at_confirm, is_modified FROM artwork_outcome`);
    expect(o).toMatchObject({ suggestion_at_confirm: 'animated', is_modified: 1 });
    expect(await q(`SELECT * FROM stage_job WHERE origin = 'confirm'`)).toEqual([]); // D34: frame_compose 작업 없음
  });
  it('같은 값 재확정은 200(첫 값 유지), 다른 값은 409 already_processing(G8)', async () => {
    const f = await judged('c2@test.local', 'relief', 1);
    await f.a.post(`/v1/artworks/${f.id}/confirm`).send({ kind: 'relief' }).expect(200);
    await f.a.post(`/v1/artworks/${f.id}/confirm`).send({ kind: 'relief' }).expect(200);
    expect((await f.a.post(`/v1/artworks/${f.id}/confirm`).send({ kind: 'frame' })).body.reason).toBe('already_processing');
    expect((await q(`SELECT * FROM stage_job WHERE origin = 'confirm'`)).length).toBe(1);
  });
  it('relief 확정인데 분리 실패면 depth_relief 대신 원본 액자 — 이미 걸려 있어 작업 없음(stage-job §6 · D34)', async () => {
    const f = await judged('c3@test.local', 'frame', 0);
    const r = await f.a.post(`/v1/artworks/${f.id}/confirm`).send({ kind: 'relief' }).expect(200);
    expect(r.body).toMatchObject({ state: 'exhibited', hungResultKind: 'frame' });
    expect(await q(`SELECT * FROM stage_job WHERE origin = 'confirm'`)).toEqual([]);
  });
  it('판정 중 확정: 결과 작업은 잠그고, 액자는 작업 없이 그대로 전시(stage-job §2 · D34), 제안값은 before(D14)', async () => {
    const f = await familyWithChild(t, 'c4@test.local');
    const r1 = await upload(f.a, f.childId, await png()).expect(202);
    await f.a.post(`/v1/artworks/${r1.body.id}/confirm`).send({ kind: 'animated' }).expect(200);
    const [lk] = await q<{ locked: number }>(`SELECT available_at > UTC_TIMESTAMP() + INTERVAL 1 DAY locked FROM stage_job WHERE origin = 'confirm'`);
    expect(Number(lk.locked)).toBe(1);
    expect((await q<{ suggestion_at_confirm: string }>(`SELECT suggestion_at_confirm FROM artwork_outcome`))[0].suggestion_at_confirm).toBe('before');
    const r2 = await upload(f.a, f.childId, await png()).expect(202);
    await f.a.post(`/v1/artworks/${r2.body.id}/confirm`).send({ kind: 'frame' }).expect(200);
    expect(await q(`SELECT * FROM stage_job WHERE origin = 'confirm' AND artwork_id = ?`, [r2.body.id])).toEqual([]);
  });
  it('비활성 모델 선택지는 409 model_disabled, 노출 꺼진 3D는 422(G17)', async () => {
    const f = await judged('c5@test.local', 'animated', 1);
    await t.db.query(`UPDATE model_version SET release_state = 'retired' WHERE model_id = 'M3'`);
    const d = await f.a.get(`/v1/artworks/${f.id}`).expect(200);
    expect(d.body.unavailableChoices).toEqual([{ choice: 'animated', reason: 'model_disabled' }]);
    expect(d.body.choices).not.toContain('sculpture');
    expect((await f.a.post(`/v1/artworks/${f.id}/confirm`).send({ kind: 'animated' })).body.reason).toBe('model_disabled');
    expect((await f.a.post(`/v1/artworks/${f.id}/confirm`).send({ kind: 'sculpture' })).status).toBe(422);
  });
});

describe('목록(T078)', () => {
  it('가족 작품만, 삭제 중 제외, 현재 단계', async () => {
    const f = await familyWithChild(t, 'l1@test.local');
    const r = await upload(f.a, f.childId, await png()).expect(202);
    const r2 = await upload(f.a, f.childId, await png()).expect(202);
    await t.db.query(`UPDATE artwork SET status = 'deleting', deleting_since = CURRENT_TIMESTAMP WHERE artwork_id = ?`, [r2.body.id]);
    const l = await f.a.get('/v1/artworks').expect(200);
    expect(l.body.map((x: { id: string }) => x.id)).toEqual([r.body.id]);
    expect(l.body[0].currentStage).toBe('split');
    expect((await request(t.app).get('/v1/artworks')).status).toBe(401);
  });
});
