// DDL 검증 3종(T017, SD_03 §18): ① 무오류 실행 ② 재실행(멱등) ③ 위반 거부 — 보완 S1~S9·공동 보호자 포함(T014·T015, SD_03 §18-2),
// D20 모델 점검(model_check · origin 'check' · G30, SD_03 §18-3).
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { migrate, MIGRATIONS_DIR, splitSql } from '../../api/scripts/migrate.js';

let db: mysql.Connection;
const count = async (sql: string) => Number(((await db.query(sql))[0] as { n: number }[])[0].n);
const rejects = async (sql: string) => expect(db.query(sql)).rejects.toBeTruthy();
const accepts = async (sql: string) => expect(db.query(sql)).resolves.toBeTruthy();

beforeAll(async () => {
  db = await mysql.createConnection({ socketPath: inject('DB_SOCKET'), user: 'root', database: 'uam_test' });
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['stage_job', 'model_check', 'release_event', 'evaluation', 'eval_item', 'model_version', 'app_session', 'auth_rate_event',
    'family_invite', 'artwork', 'child', 'guardian_account', 'family', 'team_member_role', 'team_member']) await db.query(`DELETE FROM ${t}`);
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
});
afterAll(async () => db.end());

describe('기준 마이그레이션', () => {
  it('0001은 SD_03 정본 DDL과 같다(표류 방지)', () => {
    const repo = path.resolve(MIGRATIONS_DIR, '../..');
    expect(fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_sd03_baseline.sql'), 'utf8'))
      .toBe(fs.readFileSync(path.join(repo, 'design/uri_gallery_ddl.sql'), 'utf8'));
  });
  it('① 실행 결과: 테이블 39(D40 family_neighbor · neighbor_invite · D46 artwork_comment) · 뷰 16 · 트리거 17(D34 trg_artwork_hung_bu)', async () => {
    expect(await count(`SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema='uam_test' AND table_type='BASE TABLE' AND table_name <> 'schema_migration'`)).toBe(39);
    expect(await count(`SELECT COUNT(*) n FROM information_schema.views WHERE table_schema='uam_test'`)).toBe(16);
    expect(await count(`SELECT COUNT(*) n FROM information_schema.triggers WHERE trigger_schema='uam_test'`)).toBe(17);
  });
  it('② 재실행(멱등): 전문을 다시 실행해도 오류 없음', async () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_sd03_baseline.sql'), 'utf8');
    for (const s of splitSql(sql)) await db.query(s);
    expect(await migrate(db)).toEqual([]);
  });
});

describe('③ 위반 거부 — 보완 S1~S9와 공동 보호자(SD_03 §18-2)', () => {
  beforeAll(async () => {
    await db.query(`INSERT INTO family (family_id) VALUES (1)`);
    await db.query(`INSERT INTO guardian_account (account_id, family_id, email, password_hash, role) VALUES (1,1,'g@test.local','h','owner')`);
    await db.query(`INSERT INTO child (child_id, family_id, alias) VALUES (1,1,'하늘')`);
    await db.query(`INSERT INTO artwork (artwork_id, family_id, child_id, request_no) VALUES (1,1,1,'r1')`);
    await db.query(`INSERT INTO team_member (member_id, email, password_hash) VALUES (1,'e@test.local','h')`);
    await db.query(`INSERT INTO model_version (version_id, model_id, version_label, weights_sha256, config_hash, license_confirmed, release_state) VALUES
      (10,'M1','cand',REPEAT('a',64),REPEAT('b',64),FALSE,'candidate'),(11,'M2','act',REPEAT('a',64),REPEAT('b',64),TRUE,'active'),
      (12,'M5','old',REPEAT('a',64),REPEAT('b',64),TRUE,'retired')`);
    await db.query(`INSERT INTO eval_item (item_id, category, expected_path, input_text, created_by, maker_attested) VALUES (1,'caption_input','caption','입력',1,TRUE)`);
    await db.query(`INSERT INTO evaluation (evaluation_id, version_id, requested_by, item_total) VALUES (1,10,1,1)`);
  });
  it('§19 #19 인프라 재시도 뒤 낮춤은 허용, 낮춘 작업 재개는 거부(BR-PRC-02)', async () => {
    await accepts(`INSERT INTO stage_job (job_id, artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count, error_class) VALUES (900,1,'judge','intake','cpu_vision',11,'retry_wait',1,'timeout')`);
    await accepts(`UPDATE stage_job SET status='done_downgraded', attempt_count=2, error_class=NULL, downgrade_cause='split_fail' WHERE job_id=900`);
    await rejects(`UPDATE stage_job SET status='retry_wait' WHERE job_id=900`);
    await rejects(`UPDATE stage_job SET attempt_count=3 WHERE job_id=900`);
  });
  it('S5 팀원 비밀번호 해시 없음 거부', () => rejects(`INSERT INTO team_member (email) VALUES ('x@test.local')`));
  it('S3 평가 작업인데 평가 연결 없음 거부', () => rejects(`INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id) VALUES ('split','eval','cpu_vision',10)`));
  it('S3 평가 작업에 가족 작품 연결 거부', () => rejects(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, evaluation_id, eval_item_id) VALUES (1,'split','eval','cpu_vision',10,1,1)`));
  it('S3 평가 작업은 후보 버전 허용', () => accepts(`INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, evaluation_id, eval_item_id, priority) VALUES ('split','eval','cpu_vision',10,1,1,50)`));
  it('보호자 작업은 후보 버전 거부(BR-MDL-07)', () => rejects(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id) VALUES (1,'split','intake','cpu_vision',10)`));
  it('S3 평가 작업도 retired 버전 거부', () => rejects(`INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, evaluation_id, eval_item_id) VALUES ('depth_relief','eval','gpu',12,1,1)`));
  it('S9 비활성화는 사유 필수', async () => {
    await rejects(`INSERT INTO release_event (model_id, kind, to_version_id, actor) VALUES ('M2','deactivate',11,1)`);
    await accepts(`INSERT INTO release_event (model_id, kind, to_version_id, actor, reason) VALUES ('M2','deactivate',11,1,'first_version_defect')`);
  });
  it('S6 세션 제약', async () => {
    await rejects(`INSERT INTO app_session (sid_hash, subject_kind, subject_id, expires_at) VALUES (REPEAT('c',64),'external',1,UTC_TIMESTAMP()+INTERVAL 1 HOUR)`);
    await rejects(`INSERT INTO app_session (sid_hash, subject_kind, subject_id, expires_at) VALUES (REPEAT('d',64),'guardian',1,UTC_TIMESTAMP()-INTERVAL 1 HOUR)`);
  });
  it('S7 요청 한도 동작 값 제한', () => rejects(`INSERT INTO auth_rate_event (subject_hash, subject_type, action) VALUES (REPEAT('f',64),'email','spam')`));
  it('공동 보호자: 부모 두 명까지·초대는 만든 보호자만·대기 초대 1건(1c460b0)', async () => {
    await accepts(`INSERT INTO family_invite (family_id, invited_by, email, token_hash, expires_at) VALUES (1,1,'co@test.local',REPEAT('1',64),UTC_TIMESTAMP()+INTERVAL 7 DAY)`);
    await rejects(`INSERT INTO family_invite (family_id, invited_by, email, token_hash, expires_at) VALUES (1,1,'co2@test.local',REPEAT('2',64),UTC_TIMESTAMP()+INTERVAL 7 DAY)`);
    await db.query(`UPDATE family_invite SET revoked_at = UTC_TIMESTAMP() WHERE family_id = 1`);
    await accepts(`INSERT INTO guardian_account (account_id, family_id, email, password_hash, role) VALUES (2,1,'co3@test.local','h','co')`);
    await rejects(`INSERT INTO guardian_account (account_id, family_id, email, password_hash, role) VALUES (3,1,'co4@test.local','h','co')`);
    await rejects(`INSERT INTO family_invite (family_id, invited_by, email, token_hash, expires_at) VALUES (1,2,'x@test.local',REPEAT('4',64),UTC_TIMESTAMP()+INTERVAL 7 DAY)`);
    await rejects(`INSERT INTO family_invite (family_id, invited_by, email, token_hash, expires_at) VALUES (1,1,'y@test.local',REPEAT('5',64),UTC_TIMESTAMP()+INTERVAL 7 DAY)`);
  });
});

describe('③ 위반 거부 — D20 모델 점검(SD_03 §18-3)', () => {
  const mc = (id: number, model: string, ver: number, item: number, extra = '') =>
    `INSERT INTO model_check (check_id, model_id, version_id, eval_item_id, requested_by${extra ? ', status, outcome, fail_reason, finished_at' : ''}) VALUES (${id},'${model}',${ver},${item},1${extra})`;
  beforeAll(async () => {
    await db.query(`INSERT INTO stored_object (object_id, owner_kind, object_kind, object_key) VALUES (901,'eval_set','eval_input','evalset/d20-a.png'),(902,'eval_set','eval_input','evalset/d20-b.png')`);
    await db.query(`INSERT INTO eval_item (item_id, category, expected_path, object_id, created_by, maker_attested) VALUES (20,'person','animated',901,1,TRUE),(21,'sculpture','sculpture',902,1,TRUE)`);
    await db.query(`INSERT INTO model_version (version_id, model_id, version_label, release_state) VALUES (20,'M7','cand','candidate'),(21,'M4','rule','candidate')`);
  });
  it('후보 버전(라이선스 확인 전)·사진 항목 점검 허용 — 점검은 활성화가 아님', () => accepts(mc(1, 'M1', 10, 20)));
  it('G30 설명 입력 항목으로 M1 점검 거부 · M7은 입체 항목만', async () => {
    await rejects(mc(2, 'M1', 10, 1));
    await rejects(mc(2, 'M7', 20, 20));
    await accepts(mc(2, 'M7', 20, 21));
  });
  it('G30 폐기 버전 · 다른 모델 버전 거부, M4(규칙) 거부', async () => {
    await rejects(mc(3, 'M5', 12, 20));
    await rejects(mc(3, 'M2', 10, 20));
    await rejects(mc(3, 'M4', 21, 20));
  });
  it('모델당 진행 중 점검 1건(uq_mc_one_inflight) — 끝난 뒤에는 새 점검 허용', async () => {
    await rejects(mc(4, 'M1', 10, 20));
    await rejects(`UPDATE model_check SET status='passed', finished_at=UTC_TIMESTAMP() WHERE check_id=1`); // 결과 분류 없는 통과
    await accepts(`UPDATE model_check SET status='passed', outcome='quality_below', finished_at=UTC_TIMESTAMP() WHERE check_id=1`);
    await accepts(mc(4, 'M1', 10, 20));
    await rejects(`UPDATE model_check SET status='failed', finished_at=UTC_TIMESTAMP() WHERE check_id=4`); // 실패 사유 없음
    await accepts(`UPDATE model_check SET status='failed', fail_reason='bad_output', outcome='ok', finished_at=UTC_TIMESTAMP() WHERE check_id=4`);
  });
  it('점검 작업: 점검 연결 필수 · 평가 연결 금지 · 가족 작품 금지 · 후보 버전 허용', async () => {
    await rejects(`INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, eval_item_id, priority) VALUES ('split','check','cpu_vision',10,20,30)`);
    await rejects(`INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, eval_item_id, evaluation_id, model_check_id) VALUES ('split','check','cpu_vision',10,20,1,4)`);
    await rejects(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, eval_item_id, model_check_id) VALUES (1,'split','check','cpu_vision',10,20,4)`);
    await rejects(`INSERT INTO stage_job (stage_kind, origin, serving_group, model_version_id, eval_item_id, model_check_id) VALUES ('depth_relief','check','gpu',12,20,4)`);
    await rejects(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, model_check_id) VALUES (1,'split','intake','cpu_vision',11,4)`);
    await accepts(`INSERT INTO stage_job (job_id, stage_kind, origin, serving_group, model_version_id, eval_item_id, model_check_id, priority, status, error_class) VALUES (950,'split','check','cpu_vision',10,20,4,30,'failed','timeout')`);
  });
  it('점검 작업은 운영 지표·결과 미도달에서 빠진다(BR-OPS-05)', async () => {
    expect(await count(`SELECT COUNT(*) n FROM v_metrics_model WHERE model_id='M1'`)).toBe(0);
    await db.query(`UPDATE stage_job SET stage_kind='depth_relief' WHERE job_id=950`);
    expect(await count(`SELECT COUNT(*) n FROM v_not_delivered_trace WHERE job_id=950`)).toBe(0);
  });
});
