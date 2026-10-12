-- =====================================================================
-- 우리 아이 미술관 (P0 · P0.5 · P1) — SD_03 데이터베이스 DDL
-- 설계서: design/SD_03_데이터베이스설계서_우리아이미술관.md
-- 입력: SD_02 UI/UX 설계서 · SD_01 프로세스 설계서(개정 3, D18) · UC_01~UC_14 · 공통 기준 D1~D18
-- 개정 (2026-09-28, D18): 보호자 이메일 로그인(guardian_account 이메일·비밀번호 해시·확인 시각,
--   auth_email_token 신설), 별칭 중복 검사 제거(uq_child_family_alias 삭제)
-- 개정 (2026-09-28, 구현 보완 S1~S9 — B 이제민, plan v1.1 data-model §6):
--   S1 stage_job.available_at(재시도 간격·판정 열기) · S2 stage_job.priority + ix_sj_claim
--   S3 평가 작업(origin 'eval', evaluation_id·eval_item_id, 트리거·운영 뷰에서 평가 작업 분리)
--   S4 external_job 점유 컬럼 · S5 team_member.password_hash·disabled_at
--   S6 app_session · S7 auth_rate_event(이메일·IP는 HMAC만) · S9 release_event.kind 'deactivate'
--   (S8 장치 표기는 스키마 변경 없음: MPS는 exec_device='gpu' + runtime에 mps)
-- 개정 (2026-09-28, B 구현 중 발견): artwork_outcome.confirmed_at·first_decided_at — FR-13 기간별 지표(작품 삭제 뒤에도 남는 집계 시각)
-- 개정 (2026-09-28, B 구현 중 발견): 결정 frame(액자로 걸기)이면 v_gallery가 원본 액자로 보인다(결과 행을 만들지 않음, UC4 A2·A5)
-- 개정 (2026-09-28, 1c460b0 사용자 결정 후속 — B): 가족당 공동 보호자 1명(uq_guardian_co_family), 대기 초대 1건
--   (uq_invite_one_pending), 초대는 만든 보호자만·자리 차면 거부(trg_family_invite_bi), G29 이름 "보호자 관리 권한"
-- 개정 (2026-09-29, 통합 결정 D20 — 모델 점검): model_check 신설(테이블 36), stage_job.origin 'check'·model_check_id,
--   trg_model_check_bi(G30 점검 입력, 트리거 16), 점검 작업을 운영 뷰에서 뺌(BR-OPS-05), 게이트 G30 시드(31개)
-- 개정 (2026-09-29, D25 — B 이제민): story.guardian_note(보호자 감상평, BR-STY-04) + 기존 DB용 ADD COLUMN IF NOT EXISTS, v_gallery에 싣는다
-- 개정 (2026-09-30, D46 — B 이제민): 올린 작품 고정 · artwork.making(만들기, 올릴 때만) · artwork_comment(부모 댓글, 가족 안에서만) · v_gallery.making. D39 사진 고치기 폐기(display 칸은 남김)
-- 개정 (2026-09-30, D39 — B 이제민): 사진 고치기 — stored_object.object_kind 'display'(고친 사진), artwork.display_object_id(FK, 지우면 NULL). 원본(artwork_original)은 그대로
-- 개정 (2026-09-30, D34 — B 이제민): artwork.hung_result_id·hung_at(걸린 결과, 트리거 17번째 trg_artwork_hung_bu), result.job_id frame만 NULL(chk_rs_job),
--   story.title_auto, G12 = 걸림 + 제목·그린 날(v_exhibit_gate), v_gallery는 걸린 결과, trg_story_bu 개정, 파일 끝 옮기기(멱등)
-- 개정 (2026-09-30, 이제민 결정 — 카카오 로그인, research R-26): guardian_account.kakao_id(카카오 회원번호, UNIQUE) 추가,
--   email·password_hash를 NULL 허용(카카오 계정은 둘 다 없음), chk_guardian_login(카카오 회원번호 또는 이메일+비밀번호 중 하나는 있어야),
--   family_invite.email NULL 허용(초대 링크 복사 — 이메일 없는 초대). 기존 DB용 멱등 ALTER는 family_invite 정의 뒤에 둔다
--
-- 표준 SQL을 기준으로 썼다. 검증 DBMS는 MariaDB 12.0.2다. 아래는 MariaDB 때문에
-- 표준에서 벗어난 곳이다(이탈 사유).
--   1) CREATE TABLE IF NOT EXISTS · CREATE OR REPLACE VIEW · CREATE OR REPLACE TRIGGER
--      : 멱등 실행을 위해 썼다. 표준 SQL에는 IF NOT EXISTS / OR REPLACE가 없다.
--   2) AUTO_INCREMENT : 표준의 GENERATED ALWAYS AS IDENTITY를 MariaDB가 지원하지 않는다.
--   3) 트리거 본문의 SIGNAL SQLSTATE '45000' 과 DELIMITER : 표준 SQL/PSM의 SIGNAL과 같으나
--      클라이언트 구분자 지정은 MariaDB 클라이언트 문법이다.
--   4) BOOLEAN : MariaDB는 TINYINT(1)로 저장한다. 의미는 같다.
--   5) 생성 컬럼 STORED : 표준 GENERATED ALWAYS AS (…)와 같으나 UNIQUE를 걸려고 STORED로 둔다.
--   6) INSERT IGNORE : 상수 시드를 재실행해도 실패하지 않게 썼다(표준은 MERGE).
--   7) CHECK에 CURRENT_DATE를 쓸 수 없어(비결정적) BR-STY-02의 "제작일 ≤ 오늘"은 트리거로 옮겼다.
--   8) 부분 UNIQUE 인덱스(WHERE 절)가 없어, "작품당 승인 설명 1건"·"모델당 활성 버전 1건"은
--      조건부 생성 컬럼 + UNIQUE로 구현했다(NULL은 여러 개 허용된다).
--   9) ON DELETE SET NULL FK 컬럼은 CHECK에 쓸 수 없어(ERROR 1901, 실측) deletion_request의
--      "끝난 삭제에 식별 연결 없음" 규칙을 트리거 trg_deletion_bu로 옮겼다.
-- 생성 순서는 FK 의존 위상 정렬이다. 참조되는 테이블이 먼저다.
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 영역 H(상수) · 영역 F(모델 카탈로그) — 다른 테이블이 참조하므로 먼저 만든다
-- ---------------------------------------------------------------------

-- 게이트 카탈로그 (SD_01 §15 G0~G25) — 상수
CREATE TABLE IF NOT EXISTS gate_catalog (
  gate_id        VARCHAR(3)   NOT NULL,
  gate_name      VARCHAR(60)  NOT NULL,
  nature         VARCHAR(20)  NOT NULL,
  release_role   VARCHAR(20)  NOT NULL,
  CONSTRAINT pk_gate_catalog PRIMARY KEY (gate_id),
  CONSTRAINT chk_gate_nature CHECK (nature IN
    ('access','input','atomic','business_state','infra_exhausted','quality','hold','safety')),
  CONSTRAINT chk_gate_release_role CHECK (release_role IN
    ('guardian','operator','evaluator','integrator','external_client','system','unresolved'))
);

-- 모델 카탈로그 M1~M7 (UC_00 §2.1 · D16) — 상수
CREATE TABLE IF NOT EXISTS model (
  model_id       VARCHAR(2)   NOT NULL,
  role_name      VARCHAR(40)  NOT NULL,
  serving_group  VARCHAR(12)  NOT NULL,
  phase          VARCHAR(4)   NOT NULL,
  is_rule        BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT pk_model PRIMARY KEY (model_id),
  -- BR-SRV-01: 서빙 3종 분리
  CONSTRAINT chk_model_serving CHECK (serving_group IN ('cpu_vision','gpu','llm')),
  CONSTRAINT chk_model_phase CHECK (phase IN ('P0','P0.5','P1'))
);

-- ---------------------------------------------------------------------
-- 영역 A 가족·계정
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS family (
  family_id      BIGINT       NOT NULL AUTO_INCREMENT,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_family PRIMARY KEY (family_id)
);

CREATE TABLE IF NOT EXISTS guardian_account (
  account_id           BIGINT    NOT NULL AUTO_INCREMENT,
  -- U1 확정(공동 보호자): 나가거나 해제되면 NULL(가족 없음). 만든 보호자는 NULL일 수 없다
  family_id            BIGINT    NULL,
  -- U1 확정 · BR-ACC-09: owner = 가족 공간을 만든 보호자(가족당 1명), co = 공동 보호자(같은 권한, 해제만 불가)
  role                 VARCHAR(8) NOT NULL DEFAULT 'owner',
  -- 가족당 만든 보호자 1명. 이탈 사유 8) 부분 UNIQUE 대신 조건부 생성 컬럼 + UNIQUE
  owner_family_id      BIGINT    GENERATED ALWAYS AS (CASE WHEN role = 'owner' THEN family_id END) STORED,
  -- 1c460b0 사용자 결정(부모 두 명까지): 가족당 공동 보호자 1명. 같은 방식(조건부 생성 컬럼 + UNIQUE)
  co_family_id         BIGINT    GENERATED ALWAYS AS (CASE WHEN role = 'co' THEN family_id END) STORED,
  -- D18 · BR-ACC-06: 로그인 아이디는 이메일. 따로 아이디 컬럼을 두지 않는다
  -- 2026-09-30 카카오 로그인(R-26): 카카오 계정은 이메일이 없다(NULL). 이메일 계정(기존·팀원 시험)은 그대로
  email                VARCHAR(254) NULL,
  -- 대소문자 무시 유일(BR-ACC-06, G26). 이탈 사유 5) 생성 컬럼 STORED + UNIQUE
  email_norm           VARCHAR(254) GENERATED ALWAYS AS (LOWER(email)) STORED,
  -- BR-ACC-07: 비밀번호는 해시로만 저장한다
  password_hash        VARCHAR(255) NULL,
  -- 2026-09-30 카카오 회원번호(카카오에서 받는 유일한 값, 동의 항목 없음). 탈퇴 시 계정과 함께 지운다
  kakao_id             VARCHAR(32)  NULL,
  -- 인증 시각 규칙(D18): email_verified_at · password_changed_at · auth_email_token의 시각은 모두
  --   DATETIME에 UTC로 저장하고, 만료 비교도 UTC_TIMESTAMP()로 한다(서버 시간대와 무관)
  -- UC13 BF5: 확인 메일 링크를 누르기 전에는 NULL
  email_verified_at    DATETIME  NULL DEFAULT NULL,
  -- 이제민 결정 ⑥: 비밀번호 재설정 시각. 이보다 먼저 만든 세션은 현재 세션 포함 모두 무효
  password_changed_at  DATETIME  NULL DEFAULT NULL,
  legal_rep_confirmed  BOOLEAN   NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_guardian_account PRIMARY KEY (account_id),
  CONSTRAINT uq_guardian_email UNIQUE (email_norm),
  CONSTRAINT uq_guardian_kakao UNIQUE (kakao_id),
  -- 로그인 수단이 하나는 있어야 한다: 카카오 회원번호, 또는 이메일 + 비밀번호
  CONSTRAINT chk_guardian_login CHECK (kakao_id IS NOT NULL OR (email IS NOT NULL AND password_hash IS NOT NULL)),
  CONSTRAINT chk_guardian_email_format CHECK (email LIKE '%_@_%._%'),
  CONSTRAINT fk_guardian_family FOREIGN KEY (family_id) REFERENCES family (family_id),
  -- U1 확정: 한 가족에 여러 보호자. uq_guardian_family를 풀고 만든 보호자만 가족당 1명으로 제한한다
  CONSTRAINT uq_guardian_owner_family UNIQUE (owner_family_id),
  -- BR-ACC-09 · UC15 E9: 보호자는 만든 보호자 1명 + 공동 보호자 1명까지
  CONSTRAINT uq_guardian_co_family UNIQUE (co_family_id),
  CONSTRAINT chk_guardian_role CHECK (role IN ('owner', 'co')),
  -- 만든 보호자는 반드시 가족 공간이 있다(나가기는 공동 보호자만, G29)
  CONSTRAINT chk_guardian_owner_family CHECK (role <> 'owner' OR family_id IS NOT NULL),
  -- BR-PRV-03: 보호자 계정만으로 법정대리인 확인 완료로 보지 않는다(U13 전까지 항상 FALSE)
  CONSTRAINT chk_guardian_legal_rep CHECK (legal_rep_confirmed = FALSE)
);

-- U1 확정 · UC15 · BR-ACC-09: 공동 보호자 초대. 초대받은 사람은 아직 계정이 없을 수 있어 계정이 아니라 이메일에 건다.
-- 토큰은 해시만(BR-ACC-08). 인증 시각 규칙(DATETIME·UTC)을 따른다
CREATE TABLE IF NOT EXISTS family_invite (
  invite_id           BIGINT       NOT NULL AUTO_INCREMENT,
  family_id           BIGINT       NOT NULL,
  invited_by          BIGINT       NULL,
  -- 2026-09-30 초대 링크 복사(UC15 §0): 이메일 없는 초대는 NULL
  email               VARCHAR(254) NULL,
  email_norm          VARCHAR(254) GENERATED ALWAYS AS (LOWER(email)) STORED,
  token_hash          CHAR(64)     NOT NULL,
  expires_at          DATETIME     NOT NULL,
  accepted_at         DATETIME     NULL DEFAULT NULL,
  accepted_account    BIGINT       NULL,
  revoked_at          DATETIME     NULL DEFAULT NULL,
  created_at          DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  -- UC15 E9 [추론]: 대기 중(수락·취소 전) 초대는 가족당 1건. 새로 초대하면 앱이 이전 초대를 먼저 revoked 처리한다.
  --   만료된 초대도 revoked 처리 전까지는 대기로 본다(sweeper가 만료 시 revoked_at을 채운다)
  pending_family_key  BIGINT       GENERATED ALWAYS AS
                        (CASE WHEN accepted_at IS NULL AND revoked_at IS NULL THEN family_id END) STORED,
  CONSTRAINT pk_family_invite PRIMARY KEY (invite_id),
  CONSTRAINT fk_invite_family FOREIGN KEY (family_id) REFERENCES family (family_id) ON DELETE CASCADE,
  CONSTRAINT fk_invite_by FOREIGN KEY (invited_by) REFERENCES guardian_account (account_id) ON DELETE SET NULL,
  CONSTRAINT fk_invite_accepted FOREIGN KEY (accepted_account) REFERENCES guardian_account (account_id) ON DELETE SET NULL,
  CONSTRAINT uq_invite_token_hash UNIQUE (token_hash),
  CONSTRAINT chk_invite_email_format CHECK (email LIKE '%_@_%._%'),
  -- 수락한 초대와 취소한 초대를 겹치지 않게 한다
  CONSTRAINT chk_invite_accepted_or_revoked CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT uq_invite_one_pending UNIQUE (pending_family_key)
);
-- 같은 가족·같은 이메일의 이전 초대를 찾아 무효로 만든다(재초대 시)
CREATE INDEX IF NOT EXISTS ix_invite_family_email ON family_invite (family_id, email_norm);
-- 2026-09-30 카카오 로그인(R-26) — 기존 DB용 멱등 변경. 새 DB는 위 CREATE TABLE이 이미 이 모양이다
ALTER TABLE guardian_account MODIFY COLUMN email VARCHAR(254) NULL;
ALTER TABLE guardian_account MODIFY COLUMN password_hash VARCHAR(255) NULL;
ALTER TABLE guardian_account ADD COLUMN IF NOT EXISTS kakao_id VARCHAR(32) NULL AFTER password_hash;
ALTER TABLE guardian_account ADD UNIQUE KEY IF NOT EXISTS uq_guardian_kakao (kakao_id);
ALTER TABLE guardian_account DROP CONSTRAINT IF EXISTS chk_guardian_login;
ALTER TABLE guardian_account ADD CONSTRAINT chk_guardian_login CHECK (kakao_id IS NOT NULL OR (email IS NOT NULL AND password_hash IS NOT NULL));
ALTER TABLE family_invite MODIFY COLUMN email VARCHAR(254) NULL;

-- D18 · BR-ACC-08: 가입 확인(verify)·비밀번호 재설정(reset) 메일 링크 토큰.
-- 토큰 원문은 저장하지 않고 해시만 둔다. 1회용(used_at)·유효 시간(expires_at)·재발급 시 무효(revoked_at)
CREATE TABLE IF NOT EXISTS auth_email_token (
  token_id       BIGINT       NOT NULL AUTO_INCREMENT,
  account_id     BIGINT       NOT NULL,
  purpose        VARCHAR(16)  NOT NULL,
  token_hash     CHAR(64)     NOT NULL,
  expires_at     DATETIME     NOT NULL,
  used_at        DATETIME     NULL DEFAULT NULL,
  revoked_at     DATETIME     NULL DEFAULT NULL,
  created_at     DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  CONSTRAINT pk_auth_email_token PRIMARY KEY (token_id),
  CONSTRAINT fk_token_account FOREIGN KEY (account_id) REFERENCES guardian_account (account_id) ON DELETE CASCADE,
  CONSTRAINT uq_token_hash UNIQUE (token_hash),
  CONSTRAINT chk_token_purpose CHECK (purpose IN ('verify', 'reset')),
  -- 쓴 토큰과 무효로 만든 토큰을 겹치지 않게 한다
  CONSTRAINT chk_token_used_or_revoked CHECK (used_at IS NULL OR revoked_at IS NULL)
);
-- 보완 2: 재발급 때 같은 계정·같은 목적의 이전 토큰을 찾아 무효로 만든다
CREATE INDEX IF NOT EXISTS ix_token_account_purpose ON auth_email_token (account_id, purpose);

-- S6: 로그인 세션(express-session 저장소). 세션 ID는 해시로만, 가족 ID는 저장하지 않는다
--     (가족 소속은 요청마다 guardian_account.family_id로 확인 — 해제·나가기 즉시 반영, U1).
--     보호자는 created_at < guardian_account.password_changed_at 이면 무효(이제민 결정 ⑥)
CREATE TABLE IF NOT EXISTS app_session (
  sid_hash       CHAR(64)     NOT NULL,
  subject_kind   VARCHAR(8)   NOT NULL,
  subject_id     BIGINT       NOT NULL,
  data           TEXT         NULL,       -- 세션 부가값(JSON). 자유 입력·이메일·토큰을 넣지 않는다(BR-PRV-01)
  created_at     DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  expires_at     DATETIME     NOT NULL,
  CONSTRAINT pk_app_session PRIMARY KEY (sid_hash),
  CONSTRAINT chk_session_subject CHECK (subject_kind IN ('guardian','staff')),
  CONSTRAINT chk_session_expiry CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS ix_session_subject ON app_session (subject_kind, subject_id);

-- S7: 가입·확인 재발송·찾기·로그인·초대 요청 한도(FR-31 · FR-32 · UC15). 이메일·IP 원문 없이 HMAC만
CREATE TABLE IF NOT EXISTS auth_rate_event (
  event_id       BIGINT       NOT NULL AUTO_INCREMENT,
  subject_hash   CHAR(64)     NOT NULL,
  subject_type   VARCHAR(8)   NOT NULL,
  action         VARCHAR(10)  NOT NULL,
  occurred_at    DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  CONSTRAINT pk_auth_rate_event PRIMARY KEY (event_id),
  CONSTRAINT chk_rate_subject CHECK (subject_type IN ('email','ip','family')),
  CONSTRAINT chk_rate_action CHECK (action IN ('signup','resend','recovery','login','invite'))
);
CREATE INDEX IF NOT EXISTS ix_rate_window ON auth_rate_event (subject_type, subject_hash, action, occurred_at);

CREATE TABLE IF NOT EXISTS child (
  child_id       BIGINT       NOT NULL AUTO_INCREMENT,
  family_id      BIGINT       NOT NULL,
  alias          VARCHAR(100) NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_child PRIMARY KEY (child_id),
  CONSTRAINT fk_child_family FOREIGN KEY (family_id) REFERENCES family (family_id),
  -- BR-CHD-02 (v2.2 개정, D18): 별칭 중복을 검사하지 않는다. 아이는 child_id로 구분한다.
  -- 이용자 중복은 guardian_account.email_norm UNIQUE로 막는다
  -- BR-CHD-01 · UC1 E2: 빈 별칭 금지. 길이·허용 문자 규칙은 미정(§미해결)
  CONSTRAINT chk_child_alias_nonblank CHECK (TRIM(alias) <> '')
);

CREATE TABLE IF NOT EXISTS team_member (
  member_id      BIGINT       NOT NULL AUTO_INCREMENT,
  email          VARCHAR(254) NOT NULL,
  -- S5 · INC2 · G1: 팀원 로그인 수단. 해시로만 저장(BR-ACC-07과 같은 규칙)
  password_hash  VARCHAR(255) NOT NULL,
  disabled_at    DATETIME     NULL DEFAULT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_team_member PRIMARY KEY (member_id),
  CONSTRAINT uq_team_member_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS team_member_role (
  member_id      BIGINT       NOT NULL,
  role           VARCHAR(12)  NOT NULL,
  CONSTRAINT pk_team_member_role PRIMARY KEY (member_id, role),
  CONSTRAINT fk_tmr_member FOREIGN KEY (member_id) REFERENCES team_member (member_id),
  -- BR-ACC-05: 팀원 역할 분리 (G1)
  CONSTRAINT chk_tmr_role CHECK (role IN ('operator','evaluator','integrator'))
);

-- ---------------------------------------------------------------------
-- 영역 F 모델·평가 (평가 담당 쓰기) — 단계 작업이 모델 버전을 참조하므로 먼저 만든다
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS model_version (
  version_id         BIGINT       NOT NULL AUTO_INCREMENT,
  model_id           VARCHAR(2)   NOT NULL,
  version_label      VARCHAR(40)  NOT NULL,
  weights_sha256     CHAR(64)     NULL,
  runtime            VARCHAR(80)  NULL,
  image_digest       VARCHAR(100) NULL,
  config_hash        CHAR(64)     NULL,
  model_path         VARCHAR(400) NULL,   -- R1·U14: 모델 파일 경로. 값은 미정이라 NULL 허용
  license_confirmed  BOOLEAN      NOT NULL DEFAULT FALSE,
  release_state      VARCHAR(20)  NOT NULL DEFAULT 'candidate',
  exec_device        VARCHAR(3)   NULL,
  registered_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 모델당 활성 버전 1건: 활성일 때만 model_id가 들어가는 생성 컬럼에 UNIQUE
  active_model_key   VARCHAR(2)   GENERATED ALWAYS AS
                       (CASE WHEN release_state = 'active' THEN model_id END) STORED,
  CONSTRAINT pk_model_version PRIMARY KEY (version_id),
  CONSTRAINT fk_mv_model FOREIGN KEY (model_id) REFERENCES model (model_id),
  CONSTRAINT uq_mv_label UNIQUE (model_id, version_label),
  CONSTRAINT uq_mv_one_active UNIQUE (active_model_key),
  CONSTRAINT chk_mv_state CHECK (release_state IN ('candidate','active','rollback_candidate','retired')),
  -- BR-MDL-07: 라이선스 미확인 모델은 활성화하지 않는다 (G13 · G22 · G25)
  CONSTRAINT chk_mv_license_active CHECK (release_state <> 'active' OR license_confirmed = TRUE),
  -- BR-MDL-01: 활성 버전은 매니페스트 해시를 갖춘다
  CONSTRAINT chk_mv_manifest_active CHECK (release_state <> 'active'
    OR (weights_sha256 IS NOT NULL AND config_hash IS NOT NULL)),
  -- BR-SRV-02: 실행 장치 GPU/CPU 표시(S11 · S12)
  CONSTRAINT chk_mv_device CHECK (exec_device IS NULL OR exec_device IN ('gpu','cpu'))
);

-- 기능 설정 — D10: 3D 노출 설정(기본 꺼짐). 켜는 주체는 미정(§미해결)
CREATE TABLE IF NOT EXISTS feature_setting (
  setting_key    VARCHAR(30)  NOT NULL,
  enabled        BOOLEAN      NOT NULL DEFAULT FALSE,
  changed_by     BIGINT       NULL,
  changed_at     TIMESTAMP    NULL,
  CONSTRAINT pk_feature_setting PRIMARY KEY (setting_key),
  CONSTRAINT fk_fs_member FOREIGN KEY (changed_by) REFERENCES team_member (member_id),
  CONSTRAINT chk_fs_key CHECK (setting_key IN ('sculpture_exposure'))
);

-- ---------------------------------------------------------------------
-- 영역 B 작품·판정
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artwork (
  artwork_id         BIGINT       NOT NULL AUTO_INCREMENT,
  family_id          BIGINT       NOT NULL,
  child_id           BIGINT       NOT NULL,
  request_no         VARCHAR(64)  NOT NULL,
  status             VARCHAR(20)  NOT NULL DEFAULT 'received',
  received_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at       TIMESTAMP    NULL,
  approved_at        TIMESTAMP    NULL,
  deleting_since     TIMESTAMP    NULL,
  CONSTRAINT pk_artwork PRIMARY KEY (artwork_id),
  CONSTRAINT fk_artwork_family FOREIGN KEY (family_id) REFERENCES family (family_id),
  -- UC7 A1: 아이는 그 아이의 작품이 모두 지워진 뒤에만 지워진다(RESTRICT)
  CONSTRAINT fk_artwork_child FOREIGN KEY (child_id) REFERENCES child (child_id),
  -- BR-INT-03: 같은 요청 번호의 중복 전송은 작품 1건
  CONSTRAINT uq_artwork_request UNIQUE (family_id, request_no),
  -- 공통 기준 §5 상태. '전시 중'은 저장하지 않는다(유도: v_artwork_display, G12)
  CONSTRAINT chk_artwork_status CHECK (status IN ('received','judging','awaiting_confirm',
    'processing','awaiting_review','approved','failed','deleting')),
  -- BR-APR-01: 승인 시각은 승인된 상태에서만
  CONSTRAINT chk_artwork_approved_at CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  -- BR-DEL-05 · D4: 삭제 중이면 시작 시각이 있다
  CONSTRAINT chk_artwork_deleting CHECK (status <> 'deleting' OR deleting_since IS NOT NULL)
);

-- 저장소 객체 참조 — 원본·마스크·컷아웃·관절·깊이·결과·GLB·임시 (BR-DEL-01 삭제 대상 목록)
CREATE TABLE IF NOT EXISTS stored_object (
  object_id      BIGINT       NOT NULL AUTO_INCREMENT,
  owner_kind     VARCHAR(10)  NOT NULL,
  family_id      BIGINT       NULL,
  artwork_id     BIGINT       NULL,
  object_kind    VARCHAR(20)  NOT NULL,
  object_key     VARCHAR(512) NOT NULL,   -- 저장 위치. 로그·운영 뷰에 내보내지 않는다(BR-PRV-01)
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_stored_object PRIMARY KEY (object_id),
  CONSTRAINT fk_so_family FOREIGN KEY (family_id) REFERENCES family (family_id),
  -- BR-DEL-01 순서: 객체(파일)가 먼저 지워져야 작품 기록을 지울 수 있다(RESTRICT)
  CONSTRAINT fk_so_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id),
  CONSTRAINT uq_so_key UNIQUE (object_key),
  CONSTRAINT chk_so_kind CHECK (object_kind IN ('original','mask','cutout','joints','depth',
    'result_animated','result_relief','result_frame','result_glb','temp','eval_input','display')), -- D39 display = 보호자가 고친 사진(원본은 그대로)
  -- BR-MDL-04 · BR-API-09: 평가 묶음 객체는 가족 데이터와 섞이지 않는다
  CONSTRAINT chk_so_owner CHECK (
       (owner_kind = 'family'   AND family_id IS NOT NULL AND artwork_id IS NOT NULL AND object_kind <> 'eval_input')
    OR (owner_kind = 'eval_set' AND family_id IS NULL AND artwork_id IS NULL AND object_kind = 'eval_input'))
);

-- 원본 참조는 객체 테이블 생성 뒤에 붙인다(순환 회피)
CREATE TABLE IF NOT EXISTS artwork_original (
  artwork_id     BIGINT       NOT NULL,
  object_id      BIGINT       NOT NULL,
  CONSTRAINT pk_artwork_original PRIMARY KEY (artwork_id),
  CONSTRAINT fk_ao_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE CASCADE,
  -- BR-INT-04: 원본은 한 번 저장되면 바뀌지 않는다(교체 UPDATE 금지는 트리거)
  CONSTRAINT fk_ao_object FOREIGN KEY (object_id) REFERENCES stored_object (object_id) ON DELETE CASCADE,
  CONSTRAINT uq_ao_object UNIQUE (object_id)
);

-- ---------------------------------------------------------------------
-- 영역 C 처리 (단계 작업) — 워커 쓰기
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stage_job (
  job_id             BIGINT       NOT NULL AUTO_INCREMENT,
  artwork_id         BIGINT       NULL,     -- BR-DEL-02: 삭제 뒤 작품 연결 제거(SET NULL)
  stage_kind         VARCHAR(20)  NOT NULL,
  origin             VARCHAR(12)  NOT NULL,
  serving_group      VARCHAR(12)  NOT NULL,
  model_version_id   BIGINT       NULL,     -- 액자 합성은 모델 없음(BR-PRC-01)
  status             VARCHAR(16)  NOT NULL DEFAULT 'queued',
  attempt_count      SMALLINT     NOT NULL DEFAULT 0,
  downgrade_cause    VARCHAR(24)  NULL,
  error_class        VARCHAR(16)  NULL,
  claimed_by         VARCHAR(60)  NULL,
  claim_expires_at   TIMESTAMP    NULL,
  -- S1: 이 시각 전에는 점유하지 않는다(인프라 재시도 간격, split 뒤 judge 열기)
  available_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- S2: 작은 값이 먼저. 보호자 10 · 점검 30(D20) · 평가 50 (외부 호출은 external_job, D17)
  priority           SMALLINT     NOT NULL DEFAULT 10,
  -- S3: 평가 실행 작업(UC9 8.4)의 평가·항목 연결. FK는 evaluation 생성 뒤 ALTER로 붙인다(위상 순서)
  evaluation_id      BIGINT       NULL,
  eval_item_id       BIGINT       NULL,     -- 평가 작업·점검 작업의 입력 항목
  -- D20: 모델 점검 작업(SD_01 7.9 · H17)의 점검 연결. FK는 model_check 생성 뒤 ALTER로 붙인다
  model_check_id     BIGINT       NULL,
  queued_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at         TIMESTAMP    NULL,
  finished_at        TIMESTAMP    NULL,
  cancel_requested_at TIMESTAMP   NULL,     -- G19 · H12 취소 신호
  stopped_at         TIMESTAMP    NULL,     -- G19 멈춤 확인
  CONSTRAINT pk_stage_job PRIMARY KEY (job_id),
  CONSTRAINT fk_sj_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE SET NULL,
  CONSTRAINT fk_sj_version FOREIGN KEY (model_version_id) REFERENCES model_version (version_id),
  CONSTRAINT chk_sj_stage CHECK (stage_kind IN ('split','judge','animate_render','depth_relief',
    'frame_compose','caption','sculpture')),
  CONSTRAINT chk_sj_origin CHECK (origin IN ('intake','confirm','use_lower','downgrade','caption','eval','check')),
  -- S3: 평가 작업은 가족 작품이 아니라 평가 묶음 항목을 다룬다(BR-MDL-04 · BR-API-09).
  --     "평가 작업에 작품 연결 없음"은 artwork_id가 SET NULL FK라 CHECK에 쓸 수 없어(이탈 사유 9) trg_stage_job_bi로 옮겼다
  CONSTRAINT chk_sj_eval_owner CHECK ((origin = 'eval') = (evaluation_id IS NOT NULL AND eval_item_id IS NOT NULL)),
  -- D20 · BR-OPS-05: 점검 작업은 점검 기록 하나와 평가 묶음 항목 하나를 다룬다(가족 작품 연결 없음은 trg_stage_job_bi)
  CONSTRAINT chk_sj_check_owner CHECK ((origin = 'check') = (model_check_id IS NOT NULL)
    AND (origin <> 'check' OR (eval_item_id IS NOT NULL AND evaluation_id IS NULL))),
  CONSTRAINT chk_sj_serving CHECK (serving_group IN ('cpu_vision','gpu','llm')),
  CONSTRAINT chk_sj_status CHECK (status IN ('queued','running','done','done_downgraded',
    'retry_wait','failed','cancelled')),
  -- BR-PRC-03 · D1: 첫 시도 포함 최대 3회
  CONSTRAINT chk_sj_attempts CHECK (attempt_count BETWEEN 0 AND 3),
  -- BR-FBK-01 낮춤 체인 구간
  CONSTRAINT chk_sj_downgrade CHECK (downgrade_cause IS NULL OR downgrade_cause IN
    ('animated_to_relief','relief_to_frame','sculpture_to_relief','split_fail','animated_to_frame','llm_to_template')),
  -- Intent [핵심 데이터] 오류 분류 5종
  CONSTRAINT chk_sj_error CHECK (error_class IS NULL OR error_class IN
    ('engine_down','timeout','storage','db','model_not_ready')),
  -- BR-FBK-04 · BR-API-02: 낮춤 원인과 오류 분류는 동시에 기입하지 않는다
  CONSTRAINT chk_sj_cause_exclusive CHECK (downgrade_cause IS NULL OR error_class IS NULL),
  -- BR-PRC-02: 품질 미달(낮춤)은 재시도하지 않는다 → trg_stage_job_bu(낮춤으로 닫힌 작업은 다시 열지 않음).
  --   옛 chk_sj_downgrade_no_retry(attempt_count <= 1)는 "인프라 재시도 뒤 두 번째 시도에서 낮춤"까지 막아 없앴다(§19 #19)
  -- BR-PRC-01: 액자 합성만 모델이 없다
  CONSTRAINT chk_sj_model_required CHECK (stage_kind = 'frame_compose' OR model_version_id IS NOT NULL),
  CONSTRAINT chk_sj_frame_no_model CHECK (stage_kind <> 'frame_compose' OR model_version_id IS NULL),
  -- G19: 멈춤은 취소 요청 뒤에만
  CONSTRAINT chk_sj_stop_after_cancel CHECK (stopped_at IS NULL OR cancel_requested_at IS NOT NULL),
  CONSTRAINT chk_sj_times CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

-- 판정 결과 (H3) — 작품 1:1
CREATE TABLE IF NOT EXISTS judgment (
  artwork_id         BIGINT       NOT NULL,
  judge_job_id       BIGINT       NULL,
  split_ok           BOOLEAN      NULL,
  mask_object_id     BIGINT       NULL,
  cutout_object_id   BIGINT       NULL,
  joints_object_id   BIGINT       NULL,
  kind_candidate     VARCHAR(10)  NULL,
  geometry_pass      BOOLEAN      NULL,
  person_score       DECIMAL(5,4) NULL,   -- BR-PRC-04 · BR-SUG-02: 기록만, 화면 뷰에 내보내지 않는다
  suggestion         VARCHAR(10)  NULL,
  suggestion_state   VARCHAR(12)  NOT NULL DEFAULT 'pending',
  CONSTRAINT pk_judgment PRIMARY KEY (artwork_id),
  CONSTRAINT fk_jd_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE CASCADE,
  CONSTRAINT fk_jd_job FOREIGN KEY (judge_job_id) REFERENCES stage_job (job_id),
  CONSTRAINT fk_jd_mask FOREIGN KEY (mask_object_id) REFERENCES stored_object (object_id) ON DELETE SET NULL,
  CONSTRAINT fk_jd_cutout FOREIGN KEY (cutout_object_id) REFERENCES stored_object (object_id) ON DELETE SET NULL,
  CONSTRAINT fk_jd_joints FOREIGN KEY (joints_object_id) REFERENCES stored_object (object_id) ON DELETE SET NULL,
  CONSTRAINT chk_jd_kind CHECK (kind_candidate IS NULL OR kind_candidate IN ('person','animal','house','object')),
  CONSTRAINT chk_jd_suggestion CHECK (suggestion IS NULL OR suggestion IN ('animated','relief','frame')),
  -- G7: 판정 소진이면 제안 없음
  CONSTRAINT chk_jd_state CHECK (suggestion_state IN ('pending','presented','exhausted')),
  CONSTRAINT chk_jd_state_suggestion CHECK ((suggestion_state = 'presented') = (suggestion IS NOT NULL)),
  -- BR-FBK-02 · UC2 E7: 분리 실패면 제안은 액자
  CONSTRAINT chk_jd_split_fail_frame CHECK (split_ok IS NULL OR split_ok = TRUE OR suggestion IS NULL OR suggestion = 'frame')
);

-- M2 태그 후보 (H3 → P4) — BR-CAP-06 후보로만
CREATE TABLE IF NOT EXISTS tag_candidate (
  tag_id         BIGINT       NOT NULL AUTO_INCREMENT,
  artwork_id     BIGINT       NOT NULL,
  label          VARCHAR(40)  NOT NULL,
  CONSTRAINT pk_tag_candidate PRIMARY KEY (tag_id),
  CONSTRAINT fk_tc_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE CASCADE,
  CONSTRAINT uq_tc_label UNIQUE (artwork_id, label)
);

-- 결과 (H5) — 결과 종류별 처음 만든 것 1건
CREATE TABLE IF NOT EXISTS result (
  result_id      BIGINT       NOT NULL AUTO_INCREMENT,
  artwork_id     BIGINT       NOT NULL,
  job_id         BIGINT       NOT NULL,
  result_kind    VARCHAR(10)  NOT NULL,
  object_id      BIGINT       NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_result PRIMARY KEY (result_id),
  CONSTRAINT fk_rs_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE CASCADE,
  CONSTRAINT fk_rs_job FOREIGN KEY (job_id) REFERENCES stage_job (job_id),
  CONSTRAINT fk_rs_object FOREIGN KEY (object_id) REFERENCES stored_object (object_id) ON DELETE SET NULL,
  CONSTRAINT chk_rs_kind CHECK (result_kind IN ('animated','relief','frame','sculpture')),
  -- BR-APR-03 · D11: 결과 종류마다 처음 만든 결과만 보관(재생성 금지). 낮춘 결과는 다른 종류라 허용
  CONSTRAINT uq_rs_first UNIQUE (artwork_id, result_kind)
);

-- ---------------------------------------------------------------------
-- 영역 D 결정·이야기·설명 — 보호자 쓰기
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS decision (
  decision_id    BIGINT       NOT NULL AUTO_INCREMENT,
  artwork_id     BIGINT       NOT NULL,
  review_round   SMALLINT     NOT NULL DEFAULT 1,
  decision_code  VARCHAR(10)  NOT NULL,
  decided_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_first       BOOLEAN      GENERATED ALWAYS AS (review_round = 1) STORED,
  CONSTRAINT pk_decision PRIMARY KEY (decision_id),
  CONSTRAINT fk_dc_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE CASCADE,
  -- BR-APR-06 · D11: 확인 회차당 결정 1회(중복 요청은 첫 결정 유지)
  CONSTRAINT uq_dc_round UNIQUE (artwork_id, review_round),
  -- BR-APR-02: 선택지 4종
  CONSTRAINT chk_dc_code CHECK (decision_code IN ('like','use_lower','frame','retake')),
  -- UC4 A1: 낮춘 결과로 걸기 뒤 두 번째 확인이 마지막(2회차에는 use_lower 없음)
  CONSTRAINT chk_dc_round CHECK (review_round IN (1,2) AND (review_round = 1 OR decision_code <> 'use_lower'))
);

CREATE TABLE IF NOT EXISTS story (
  artwork_id       BIGINT       NOT NULL,
  title            VARCHAR(200) NULL,
  made_on          DATE         NULL,
  age_at_creation  SMALLINT     NULL,
  utterance        TEXT         NULL,   -- BR-STY-03: 입력 그대로. AI 설명과 다른 테이블
  guardian_note    TEXT         NULL,   -- BR-STY-04(D25): 보호자 감상평. 입력 그대로, 전시 조건 아님, AI 설명 입력·로그에 넣지 않음
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_story PRIMARY KEY (artwork_id),
  CONSTRAINT fk_st_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE CASCADE,
  -- BR-STY-02: 제작 당시 연령 0~18 정수 (G11). 제작일 ≤ 오늘은 트리거(비결정적 함수)
  CONSTRAINT chk_st_age CHECK (age_at_creation IS NULL OR age_at_creation BETWEEN 0 AND 18),
  CONSTRAINT chk_st_title_nonblank CHECK (title IS NULL OR TRIM(title) <> '')
);
-- (D25, 2026-09-29) 이미 만든 DB에 감상평 칸을 더한다 — 이 파일을 다시 실행해도 안전(멱등). 뒤의 v_gallery가 이 칸을 읽는다
ALTER TABLE story ADD COLUMN IF NOT EXISTS guardian_note TEXT NULL AFTER utterance;
-- (D34, 2026-09-30) 올리면 원본 액자로 바로 전시 — 걸린 결과를 처리 상태와 떼어 둔다. 다시 실행해도 안전(멱등)
-- · artwork.hung_result_id: 지금 전시에 걸린 결과(NULL = 안 걸림). 같은 작품의 결과만(trg_artwork_hung_bu)
-- · result.job_id: 원본 액자는 올리기 트랜잭션이 작업 없이 만든다 → frame만 NULL 허용(chk_rs_job)
-- · story.title_auto: "제목 없는 그림 N" 자동 제목
ALTER TABLE artwork ADD COLUMN IF NOT EXISTS hung_result_id BIGINT NULL AFTER approved_at;
ALTER TABLE artwork ADD COLUMN IF NOT EXISTS hung_at TIMESTAMP NULL AFTER hung_result_id;
ALTER TABLE artwork ADD CONSTRAINT fk_artwork_hung FOREIGN KEY IF NOT EXISTS (hung_result_id) REFERENCES result (result_id) ON DELETE SET NULL;
ALTER TABLE result MODIFY job_id BIGINT NULL;
ALTER TABLE result ADD CONSTRAINT IF NOT EXISTS chk_rs_job CHECK (job_id IS NOT NULL OR result_kind = 'frame');
ALTER TABLE story ADD COLUMN IF NOT EXISTS title_auto BOOLEAN NOT NULL DEFAULT FALSE AFTER title;
-- (D46 ⑩, 2026-09-30) 비워서 자동으로 채운 그린 날 · 나이 — 해설이 보호자가 적지 않은 사실을 단정하지 않게. 다시 실행해도 안전(멱등)
ALTER TABLE story ADD COLUMN IF NOT EXISTS made_on_auto BOOLEAN NOT NULL DEFAULT FALSE AFTER made_on;
ALTER TABLE story ADD COLUMN IF NOT EXISTS age_auto BOOLEAN NOT NULL DEFAULT FALSE AFTER age_at_creation;
-- (D39, 2026-09-30) 사진 고치기 — 원본은 그대로 두고 고친 사진(object_kind 'display')을 따로 건다(멱등). 원본 액자 · 전시 · 저장하기는 고친 사진을 쓴다
ALTER TABLE stored_object DROP CONSTRAINT IF EXISTS chk_so_kind;
ALTER TABLE stored_object ADD CONSTRAINT chk_so_kind CHECK (object_kind IN ('original','mask','cutout','joints','depth',
    'result_animated','result_relief','result_frame','result_glb','temp','eval_input','display'));
ALTER TABLE artwork ADD COLUMN IF NOT EXISTS display_object_id BIGINT NULL AFTER hung_at;
ALTER TABLE artwork ADD CONSTRAINT fk_artwork_display FOREIGN KEY IF NOT EXISTS (display_object_id) REFERENCES stored_object (object_id) ON DELETE SET NULL;
-- (D46, 2026-09-30) 올린 작품은 고정 · 만들기는 올릴 때만 고른다(making) · 부모(가족 보호자) 댓글. D39 사진 고치기는 폐기(칸은 남긴다 — 비어 있음)
ALTER TABLE artwork ADD COLUMN IF NOT EXISTS making BOOLEAN NOT NULL DEFAULT FALSE AFTER request_no;
CREATE TABLE IF NOT EXISTS artwork_comment (
  comment_id   BIGINT       NOT NULL AUTO_INCREMENT,
  artwork_id   BIGINT       NOT NULL,
  account_id   BIGINT       NULL,      -- 쓴 보호자(계정을 지우면 NULL — 글은 가족 기록으로 남는다 [추론])
  body         VARCHAR(500) NOT NULL,  -- 입력 그대로(트림·교정 없음). 가족 밖에는 보이지 않는다(D46 ④)
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_artwork_comment PRIMARY KEY (comment_id),
  CONSTRAINT fk_ac_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE CASCADE,
  CONSTRAINT fk_ac_account FOREIGN KEY (account_id) REFERENCES guardian_account (account_id) ON DELETE SET NULL,
  CONSTRAINT chk_ac_body CHECK (TRIM(body) <> '')
);
CREATE INDEX IF NOT EXISTS ix_ac_artwork ON artwork_comment (artwork_id, created_at);

-- 작품 설명 (P0.5, H10) — 한마디와 다른 테이블(BR-STY-03)
CREATE TABLE IF NOT EXISTS caption (
  caption_id       BIGINT       NOT NULL AUTO_INCREMENT,
  artwork_id       BIGINT       NOT NULL,
  job_id           BIGINT       NULL,      -- 설명(M6) 단계 작업. 직접 입력이면 NULL
  keywords         VARCHAR(400) NULL,
  source           VARCHAR(10)  NOT NULL,
  body             TEXT         NOT NULL,  -- 규칙 검사를 통과했거나 템플릿·직접 입력인 문장만(BR-CAP-07)
  generation_count SMALLINT     NOT NULL DEFAULT 0,
  is_edited        BOOLEAN      NOT NULL DEFAULT FALSE,
  status           VARCHAR(10)  NOT NULL DEFAULT 'pending',
  approved_at      TIMESTAMP    NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- D6 · BR-CAP-03: "AI 작성" 표시는 출처로만 정한다(단일 산출 지점)
  ai_badge         BOOLEAN      GENERATED ALWAYS AS (source IN ('llm','template')) STORED,
  -- BR-CAP-04: 작품당 승인 설명 1건
  approved_key     BIGINT       GENERATED ALWAYS AS
                     (CASE WHEN status = 'approved' THEN artwork_id END) STORED,
  CONSTRAINT pk_caption PRIMARY KEY (caption_id),
  CONSTRAINT fk_cp_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_job FOREIGN KEY (job_id) REFERENCES stage_job (job_id),
  CONSTRAINT uq_cp_one_approved UNIQUE (approved_key),
  CONSTRAINT chk_cp_source CHECK (source IN ('llm','template','direct')),
  CONSTRAINT chk_cp_status CHECK (status IN ('pending','approved','discarded')),
  CONSTRAINT chk_cp_approved_at CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  -- BR-CAP-02 · U11: 자동 재생성 상한 2회([추론]) + 첫 생성 = 최대 3. 보호자 요청 재생성 상한은 미정이라 막지 않는다
  CONSTRAINT chk_cp_gen CHECK (generation_count >= 0),
  CONSTRAINT chk_cp_direct_no_job CHECK (source <> 'direct' OR job_id IS NULL)
);

-- BR-CAP-06: 보호자가 고른 태그만 입력
CREATE TABLE IF NOT EXISTS caption_selected_tag (
  caption_id     BIGINT       NOT NULL,
  tag_id         BIGINT       NOT NULL,
  CONSTRAINT pk_caption_selected_tag PRIMARY KEY (caption_id, tag_id),
  CONSTRAINT fk_cst_caption FOREIGN KEY (caption_id) REFERENCES caption (caption_id) ON DELETE CASCADE,
  CONSTRAINT fk_cst_tag FOREIGN KEY (tag_id) REFERENCES tag_candidate (tag_id) ON DELETE CASCADE
);

-- BR-CAP-07 · UC10 A2: 규칙 검사에 걸린 초안은 저장하지 않고 실패 분류만 — 단계 작업에 붙여 삭제 뒤에도 집계
CREATE TABLE IF NOT EXISTS caption_check_failure (
  failure_id     BIGINT       NOT NULL AUTO_INCREMENT,
  job_id         BIGINT       NOT NULL,
  failure_class  VARCHAR(12)  NOT NULL,
  occurred_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_caption_check_failure PRIMARY KEY (failure_id),
  CONSTRAINT fk_ccf_job FOREIGN KEY (job_id) REFERENCES stage_job (job_id),
  CONSTRAINT chk_ccf_class CHECK (failure_class IN ('event','emotion','development'))
);

-- ---------------------------------------------------------------------
-- 영역 E 삭제·집계
-- ---------------------------------------------------------------------

-- 작품 집계 기록 — BR-DEL-02: 작품이 지워져도 남는 집계 필드(H13). 작품 연결은 SET NULL
CREATE TABLE IF NOT EXISTS artwork_outcome (
  outcome_id           BIGINT      NOT NULL AUTO_INCREMENT,
  artwork_id           BIGINT      NULL,
  suggestion_at_confirm VARCHAR(10) NULL,
  confirmed_path       VARCHAR(10) NULL,
  -- BR-SUG-03 · BR-OPS-02: 수정 여부 = 제안이 있었고 확정값이 다르다
  is_modified          BOOLEAN     GENERATED ALWAYS AS (CASE
                         WHEN suggestion_at_confirm IN ('animated','relief','frame') AND confirmed_path IS NOT NULL
                         THEN confirmed_path <> suggestion_at_confirm END) STORED,
  result_kind          VARCHAR(10) NULL,
  result_cause         VARCHAR(16) NULL,
  first_decision       VARCHAR(10) NULL,
  in_approval_base     BOOLEAN     NULL,   -- D2 · D14: 첫 결과 승인율 분모 포함 여부(판정 시점 고정)
  -- FR-13 기간별 지표(2026-09-28 B 구현 중 추가): 작품이 지워져도 남는 집계 시각. 앱이 확정·첫 결정 때 적는다(UTC)
  confirmed_at         DATETIME    NULL,
  first_decided_at     DATETIME    NULL,
  CONSTRAINT pk_artwork_outcome PRIMARY KEY (outcome_id),
  CONSTRAINT fk_oc_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE SET NULL,
  CONSTRAINT uq_oc_artwork UNIQUE (artwork_id),
  -- 제안값: 3종 · 제안 전 확정(D14) · 판정 소진(G7)
  CONSTRAINT chk_oc_suggestion CHECK (suggestion_at_confirm IS NULL OR suggestion_at_confirm IN
    ('animated','relief','frame','before','none')),
  -- BR-INT-05: 처리 경로 = 보호자 확정값
  CONSTRAINT chk_oc_path CHECK (confirmed_path IS NULL OR confirmed_path IN ('animated','relief','frame','sculpture')),
  CONSTRAINT chk_oc_kind CHECK (result_kind IS NULL OR result_kind IN ('animated','relief','frame','sculpture')),
  -- BR-FBK-04: 결과 원인 5분류(한 곳에서만 기록)
  CONSTRAINT chk_oc_cause CHECK (result_cause IS NULL OR result_cause IN
    ('guardian_choice','model_downgrade','guardian_switch','infra_failure','not_delivered')),
  CONSTRAINT chk_oc_decision CHECK (first_decision IS NULL OR first_decision IN ('like','use_lower','frame','retake')),
  -- D2: 결과 미도달 뒤의 결정은 승인율 분모에서 뺀다
  CONSTRAINT chk_oc_base CHECK (result_cause <> 'not_delivered' OR in_approval_base IS NULL OR in_approval_base = FALSE)
);

CREATE TABLE IF NOT EXISTS deletion_request (
  deletion_id      BIGINT       NOT NULL AUTO_INCREMENT,
  target_kind      VARCHAR(8)   NOT NULL,
  origin           VARCHAR(10)  NOT NULL,
  artwork_id       BIGINT       NULL,
  child_id         BIGINT       NULL,
  requested_by     BIGINT       NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'accepted',
  file_retry_count SMALLINT     NOT NULL DEFAULT 0,
  requested_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at     TIMESTAMP    NULL,
  CONSTRAINT pk_deletion_request PRIMARY KEY (deletion_id),
  CONSTRAINT fk_dr_artwork FOREIGN KEY (artwork_id) REFERENCES artwork (artwork_id) ON DELETE SET NULL,
  CONSTRAINT fk_dr_child FOREIGN KEY (child_id) REFERENCES child (child_id) ON DELETE SET NULL,
  -- BR-ACC-04: 삭제는 보호자만
  CONSTRAINT fk_dr_account FOREIGN KEY (requested_by) REFERENCES guardian_account (account_id) ON DELETE SET NULL,
  CONSTRAINT chk_dr_target CHECK (target_kind IN ('artwork','child')),
  -- UC4 A6 · BR-APR-05: 다시 찍기로 닫힌 작품도 같은 절차
  CONSTRAINT chk_dr_origin CHECK (origin IN ('guardian','retake')),
  -- G18 · G19 · BR-DEL-03: 삭제 절차 상태, 끝내 실패는 incomplete
  CONSTRAINT chk_dr_status CHECK (status IN ('accepted','waiting_stop','deleting_files','completed','incomplete')),
  CONSTRAINT chk_dr_done CHECK ((status IN ('completed','incomplete')) = (completed_at IS NOT NULL))
  -- BR-DEL-02 · BR-OPS-04 "끝난 삭제에는 식별 연결이 남지 않는다"는 트리거 trg_deletion_bu로 옮겼다.
  -- 이탈 사유: MariaDB는 ON DELETE SET NULL FK 컬럼을 CHECK에 쓸 수 없다(ERROR 1901, 실측).
);

-- ---------------------------------------------------------------------
-- 영역 F(계속) 평가
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS eval_item (
  item_id          BIGINT       NOT NULL AUTO_INCREMENT,
  category         VARCHAR(20)  NOT NULL,
  expected_path    VARCHAR(10)  NOT NULL,
  object_id        BIGINT       NULL,
  input_text       TEXT         NULL,     -- 설명 입력 세트(팀원 작성 문장)
  created_by       BIGINT       NOT NULL,
  maker_attested   BOOLEAN      NOT NULL,
  registered_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_eval_item PRIMARY KEY (item_id),
  CONSTRAINT fk_ei_object FOREIGN KEY (object_id) REFERENCES stored_object (object_id),
  CONSTRAINT fk_ei_member FOREIGN KEY (created_by) REFERENCES team_member (member_id),
  CONSTRAINT chk_ei_category CHECK (category IN ('person','non_person','capture_condition','sculpture','caption_input')),
  CONSTRAINT chk_ei_expected CHECK (expected_path IN ('animated','relief','frame','sculpture','caption')),
  -- BR-MDL-04 · G20: 팀원이 직접 만든 작품만(제작 확인 방식은 미정, 확인 표시는 필수)
  CONSTRAINT chk_ei_attested CHECK (maker_attested = TRUE),
  CONSTRAINT chk_ei_input CHECK ((category = 'caption_input') = (input_text IS NOT NULL AND object_id IS NULL))
);

CREATE TABLE IF NOT EXISTS evaluation (
  evaluation_id    BIGINT       NOT NULL AUTO_INCREMENT,
  version_id       BIGINT       NOT NULL,
  requested_by     BIGINT       NOT NULL,
  requested_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  item_total       INT          NOT NULL,  -- 요청 시점 평가 묶음 크기 고정(A6: 이후 항목 추가와 무관)
  verdict          VARCHAR(6)   NULL,
  rationale        TEXT         NULL,
  judged_by        BIGINT       NULL,
  judged_at        TIMESTAMP    NULL,
  CONSTRAINT pk_evaluation PRIMARY KEY (evaluation_id),
  CONSTRAINT fk_ev_version FOREIGN KEY (version_id) REFERENCES model_version (version_id),
  CONSTRAINT fk_ev_req FOREIGN KEY (requested_by) REFERENCES team_member (member_id),
  CONSTRAINT fk_ev_judge FOREIGN KEY (judged_by) REFERENCES team_member (member_id),
  CONSTRAINT chk_ev_total CHECK (item_total > 0),
  CONSTRAINT chk_ev_verdict CHECK (verdict IS NULL OR verdict IN ('pass','hold')),
  CONSTRAINT chk_ev_judged CHECK ((verdict IS NULL) = (judged_at IS NULL) AND (verdict IS NULL OR rationale IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS eval_item_result (
  evaluation_id    BIGINT       NOT NULL,
  item_id          BIGINT       NOT NULL,
  status           VARCHAR(12)  NOT NULL,
  result_path      VARCHAR(10)  NULL,
  misclass_label   VARCHAR(40)  NULL,     -- 팀원이 확정한 오인 분류
  score            DECIMAL(5,4) NULL,     -- BR-PRC-04: 기록만. 어댑터 점수 0~1(D50, M5 = 깊이 표준편차÷255)
  processing_ms    INT          NULL,
  memory_mb        INT          NULL,
  rule_check_failed BOOLEAN     NULL,     -- M6 평가(UC9 A3)
  CONSTRAINT pk_eval_item_result PRIMARY KEY (evaluation_id, item_id),
  CONSTRAINT fk_eir_eval FOREIGN KEY (evaluation_id) REFERENCES evaluation (evaluation_id),
  CONSTRAINT fk_eir_item FOREIGN KEY (item_id) REFERENCES eval_item (item_id),
  -- UC9 E4: 인프라 소진은 평가 미완료, 시간 상한 초과는 시간 초과
  CONSTRAINT chk_eir_status CHECK (status IN ('done','incomplete','timeout')),
  CONSTRAINT chk_eir_done_path CHECK (status <> 'done' OR result_path IS NOT NULL)
);

-- 모델 점검 (D20, SD_01 §10-4 · H17 · H18) — 평가 묶음 항목 한 장으로 모델 하나를 샘플 추론한 기록.
-- 가족 데이터 없음, 출력 파일 참조 없음(BR-OPS-05). 동작만 판정하고 점수는 두지 않는다(BR-OPS-06)
CREATE TABLE IF NOT EXISTS model_check (
  check_id         BIGINT       NOT NULL AUTO_INCREMENT,
  model_id         VARCHAR(2)   NOT NULL,
  version_id       BIGINT       NOT NULL,
  eval_item_id     BIGINT       NOT NULL,
  requested_by     BIGINT       NOT NULL,
  status           VARCHAR(8)   NOT NULL DEFAULT 'queued',
  outcome          VARCHAR(16)  NULL,     -- ok · quality_below — 모델이 돈 결과 분류(기록만)
  fail_reason      VARCHAR(16)  NULL,     -- 오류 분류 5종 · bad_output(출력 형식 불량)
  processing_ms    INT          NULL,     -- 어댑터 실행 시간(적재 시간 제외)
  memory_mb        INT          NULL,
  requested_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at       TIMESTAMP    NULL,
  finished_at      TIMESTAMP    NULL,
  -- 모델당 진행 중 점검 1건: 진행 중일 때만 model_id가 들어가는 생성 컬럼에 UNIQUE(이탈 사유 8)
  inflight_model_key VARCHAR(2) GENERATED ALWAYS AS
                     (CASE WHEN status IN ('queued','running') THEN model_id END) STORED,
  CONSTRAINT pk_model_check PRIMARY KEY (check_id),
  CONSTRAINT fk_mc_model FOREIGN KEY (model_id) REFERENCES model (model_id),
  CONSTRAINT fk_mc_version FOREIGN KEY (version_id) REFERENCES model_version (version_id),
  CONSTRAINT fk_mc_item FOREIGN KEY (eval_item_id) REFERENCES eval_item (item_id),
  CONSTRAINT fk_mc_member FOREIGN KEY (requested_by) REFERENCES team_member (member_id),
  CONSTRAINT uq_mc_one_inflight UNIQUE (inflight_model_key),
  CONSTRAINT chk_mc_status CHECK (status IN ('queued','running','passed','failed')),
  CONSTRAINT chk_mc_outcome CHECK (outcome IS NULL OR outcome IN ('ok','quality_below')),
  CONSTRAINT chk_mc_fail CHECK (fail_reason IS NULL OR fail_reason IN
    ('engine_down','timeout','storage','db','model_not_ready','bad_output')),
  -- 통과 = 결과 분류 있고 실패 사유 없음 · 실패 = 실패 사유 있음 · 진행 중 = 둘 다 없음
  CONSTRAINT chk_mc_result CHECK (
       (status IN ('queued','running') AND outcome IS NULL AND fail_reason IS NULL)
    OR (status = 'passed' AND outcome IS NOT NULL AND fail_reason IS NULL)
    OR (status = 'failed' AND fail_reason IS NOT NULL)),
  CONSTRAINT chk_mc_finished CHECK ((status IN ('passed','failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT chk_mc_times CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

-- 승격·롤백 이력 (H14) — BR-MDL-03 · D5
CREATE TABLE IF NOT EXISTS release_event (
  event_id         BIGINT       NOT NULL AUTO_INCREMENT,
  model_id         VARCHAR(2)   NOT NULL,
  kind             VARCHAR(10)  NOT NULL,
  from_version_id  BIGINT       NULL,
  to_version_id    BIGINT       NOT NULL,
  evaluation_id    BIGINT       NULL,
  reason           TEXT         NULL,
  actor            BIGINT       NOT NULL,
  occurred_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_release_event PRIMARY KEY (event_id),
  CONSTRAINT fk_re_model FOREIGN KEY (model_id) REFERENCES model (model_id),
  CONSTRAINT fk_re_from FOREIGN KEY (from_version_id) REFERENCES model_version (version_id),
  CONSTRAINT fk_re_to FOREIGN KEY (to_version_id) REFERENCES model_version (version_id),
  CONSTRAINT fk_re_eval FOREIGN KEY (evaluation_id) REFERENCES evaluation (evaluation_id),
  CONSTRAINT fk_re_actor FOREIGN KEY (actor) REFERENCES team_member (member_id),
  -- S9: deactivate = 롤백 후보가 없는 첫 버전 문제 시 평가 담당이 활성 버전을 내림(2026-09-28 clarify).
  --     to_version_id = 내린 버전(retired), 사유 필수
  CONSTRAINT chk_re_kind CHECK (kind IN ('promote','rollback','deactivate')),
  CONSTRAINT chk_re_deactivate CHECK (kind <> 'deactivate' OR (reason IS NOT NULL AND evaluation_id IS NULL)),
  -- BR-MDL-03: 승격에는 평가 근거, 롤백에는 사유
  CONSTRAINT chk_re_promote_eval CHECK (kind <> 'promote' OR evaluation_id IS NOT NULL),
  CONSTRAINT chk_re_rollback CHECK (kind <> 'rollback' OR (reason IS NOT NULL AND from_version_id IS NOT NULL))
);

-- S3: 평가 작업 FK — evaluation·eval_item이 stage_job보다 뒤에 만들어져 여기서 붙인다(멱등: IF NOT EXISTS)
-- 이탈 사유(추가): ADD FOREIGN KEY IF NOT EXISTS는 MariaDB 구문이다(표준에는 IF NOT EXISTS가 없음, 멱등 실행용)
-- §19 #19: 이미 만든 DB에서 옛 제약을 걷어 낸다(멱등)
ALTER TABLE stage_job DROP CONSTRAINT IF EXISTS chk_sj_downgrade_no_retry;
ALTER TABLE stage_job ADD FOREIGN KEY IF NOT EXISTS fk_sj_evaluation (evaluation_id)
  REFERENCES evaluation (evaluation_id);
ALTER TABLE stage_job ADD FOREIGN KEY IF NOT EXISTS fk_sj_eval_item (eval_item_id)
  REFERENCES eval_item (item_id);
-- D20: 이미 만든 DB에 점검 작업을 들인다(멱등 — 제약은 지웠다가 다시 건다)
ALTER TABLE stage_job ADD COLUMN IF NOT EXISTS model_check_id BIGINT NULL AFTER eval_item_id;
ALTER TABLE stage_job DROP CONSTRAINT IF EXISTS chk_sj_origin;
ALTER TABLE stage_job ADD CONSTRAINT chk_sj_origin CHECK (origin IN
  ('intake','confirm','use_lower','downgrade','caption','eval','check'));
ALTER TABLE stage_job DROP CONSTRAINT IF EXISTS chk_sj_check_owner;
ALTER TABLE stage_job ADD CONSTRAINT chk_sj_check_owner CHECK ((origin = 'check') = (model_check_id IS NOT NULL)
  AND (origin <> 'check' OR (eval_item_id IS NOT NULL AND evaluation_id IS NULL)));
ALTER TABLE stage_job ADD FOREIGN KEY IF NOT EXISTS fk_sj_model_check (model_check_id)
  REFERENCES model_check (check_id);

-- ---------------------------------------------------------------------
-- 영역 G 외부 호출·API
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_key (
  key_id         BIGINT       NOT NULL AUTO_INCREMENT,
  key_kind       VARCHAR(16)  NOT NULL,
  key_hash       CHAR(64)     NOT NULL,   -- 키 원문은 저장하지 않는다
  status         VARCHAR(8)   NOT NULL DEFAULT 'active',
  issued_by      BIGINT       NULL,       -- 발급 주체는 U12(예시값: 서비스 운영자)
  issued_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at     TIMESTAMP    NULL,
  CONSTRAINT pk_api_key PRIMARY KEY (key_id),
  CONSTRAINT fk_ak_member FOREIGN KEY (issued_by) REFERENCES team_member (member_id),
  CONSTRAINT uq_ak_hash UNIQUE (key_hash),
  -- D17: 팀 내부 · 과정 내부 · 팀 밖 · 시험 키
  CONSTRAINT chk_ak_kind CHECK (key_kind IN ('team_internal','course_internal','external','test')),
  CONSTRAINT chk_ak_status CHECK (status IN ('active','revoked')),
  CONSTRAINT chk_ak_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- 외부 작업 (H16) — 입력은 워커 임시 영역에만(D8), 여기에는 메타만
CREATE TABLE IF NOT EXISTS external_job (
  ext_job_id       BIGINT       NOT NULL AUTO_INCREMENT,
  key_id           BIGINT       NOT NULL,
  func             VARCHAR(10)  NOT NULL,
  model_version_id BIGINT       NOT NULL,
  status           VARCHAR(8)   NOT NULL DEFAULT 'queued',
  result_class     VARCHAR(14)  NULL,
  error_class      VARCHAR(16)  NULL,
  attempt_count    SMALLINT     NOT NULL DEFAULT 0,
  -- S4: 외부 작업도 점유·이어받기·재시도(BR-PRC-05)
  claimed_by       VARCHAR(60)  NULL,
  claim_expires_at TIMESTAMP    NULL,
  available_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result_temp_ref  VARCHAR(200) NULL,     -- 워커 임시 영역 참조. 내려받으면 지운다
  queued_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at       TIMESTAMP    NULL,
  finished_at      TIMESTAMP    NULL,
  delivered_at     TIMESTAMP    NULL,
  CONSTRAINT pk_external_job PRIMARY KEY (ext_job_id),
  CONSTRAINT fk_ej_key FOREIGN KEY (key_id) REFERENCES api_key (key_id),
  CONSTRAINT fk_ej_version FOREIGN KEY (model_version_id) REFERENCES model_version (version_id),
  -- D9 · D17: 3D는 외부 기능이 아니다. caption은 P0.5(구간 개시는 애플리케이션 설정)
  CONSTRAINT chk_ej_func CHECK (func IN ('segment','classify','pose','relief','caption')),
  CONSTRAINT chk_ej_status CHECK (status IN ('queued','running','done','failed')),
  CONSTRAINT chk_ej_result CHECK (result_class IS NULL OR result_class IN ('ok','quality_below')),
  CONSTRAINT chk_ej_error CHECK (error_class IS NULL OR error_class IN
    ('engine_down','timeout','storage','db','model_not_ready')),
  CONSTRAINT chk_ej_exclusive CHECK (result_class IS NULL OR error_class IS NULL),
  CONSTRAINT chk_ej_attempts CHECK (attempt_count BETWEEN 0 AND 3),
  -- BR-API-05 · D8: 결과를 내려준 뒤에는 임시 참조가 남지 않는다
  CONSTRAINT chk_ej_delivered CHECK (delivered_at IS NULL OR result_temp_ref IS NULL)
);

-- 외부 호출 기록 — S10 호출량·거부 수(UC8 A5). 입력·키 원문 없음(BR-API-05 · BR-PRV-01)
CREATE TABLE IF NOT EXISTS external_call_log (
  call_id        BIGINT       NOT NULL AUTO_INCREMENT,
  key_id         BIGINT       NULL,      -- 무효 키는 NULL
  endpoint       VARCHAR(12)  NOT NULL,
  http_status    SMALLINT     NOT NULL,
  called_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_external_call_log PRIMARY KEY (call_id),
  CONSTRAINT fk_ecl_key FOREIGN KEY (key_id) REFERENCES api_key (key_id),
  CONSTRAINT chk_ecl_endpoint CHECK (endpoint IN ('segment','classify','pose','relief','caption','jobs','result','other')),
  -- G2 · G24 · G25 응답 코드
  CONSTRAINT chk_ecl_status CHECK (http_status IN (200,202,401,403,404,413,422,429,503,504))
);

-- ---------------------------------------------------------------------
-- 영역 H 게이트·추적
-- ---------------------------------------------------------------------

-- 게이트 이벤트 — 1급 엔티티. 다형 참조(subject_kind, subject_id)는 FK를 걸 수 없어 점검 뷰를 둔다
CREATE TABLE IF NOT EXISTS gate_event (
  event_id         BIGINT       NOT NULL AUTO_INCREMENT,
  gate_id          VARCHAR(3)   NOT NULL,
  subject_kind     VARCHAR(16)  NOT NULL,
  subject_id       BIGINT       NULL,     -- 작품 삭제 뒤에는 NULL(BR-DEL-02)
  actor_role       VARCHAR(16)  NOT NULL,
  reason_code      VARCHAR(40)  NOT NULL, -- 분류 코드만. 자유 입력·오류 원문 금지(BR-PRV-01)
  occurred_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at      TIMESTAMP    NULL,
  release_action   VARCHAR(40)  NULL,
  released_by_role VARCHAR(16)  NULL,
  CONSTRAINT pk_gate_event PRIMARY KEY (event_id),
  CONSTRAINT fk_ge_gate FOREIGN KEY (gate_id) REFERENCES gate_catalog (gate_id),
  CONSTRAINT chk_ge_subject CHECK (subject_kind IN ('session','child','artwork','caption','stage_job',
    'deletion','model_version','evaluation','eval_item','external_call',
    -- U1 확정 · G28 · G29 (이제민 보완 1)
    'family_invite','guardian_account')),
  CONSTRAINT chk_ge_actor CHECK (actor_role IN ('guardian','operator','evaluator','integrator','external_client','system','anonymous')),
  CONSTRAINT chk_ge_release CHECK ((released_at IS NULL) = (release_action IS NULL)
    AND (released_at IS NULL) = (released_by_role IS NULL)),
  CONSTRAINT chk_ge_release_role CHECK (released_by_role IS NULL OR released_by_role IN
    ('guardian','operator','evaluator','integrator','external_client','system'))
);

-- ---------------------------------------------------------------------
-- 인덱스
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_artwork_family_status ON artwork (family_id, status);
CREATE INDEX IF NOT EXISTS ix_artwork_child ON artwork (child_id);
CREATE INDEX IF NOT EXISTS ix_sj_queue ON stage_job (serving_group, status, queued_at);
CREATE INDEX IF NOT EXISTS ix_sj_artwork ON stage_job (artwork_id, stage_kind);
CREATE INDEX IF NOT EXISTS ix_sj_version ON stage_job (model_version_id, status);
CREATE INDEX IF NOT EXISTS ix_so_artwork ON stored_object (artwork_id);
CREATE INDEX IF NOT EXISTS ix_story_age ON story (age_at_creation, made_on);
CREATE INDEX IF NOT EXISTS ix_ge_subject ON gate_event (subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS ix_ge_open ON gate_event (gate_id, released_at);
CREATE INDEX IF NOT EXISTS ix_ecl_key_time ON external_call_log (key_id, called_at);
CREATE INDEX IF NOT EXISTS ix_ej_queue ON external_job (status, queued_at);
-- S2: 점유 쿼리(SELECT … FOR UPDATE SKIP LOCKED)용
CREATE INDEX IF NOT EXISTS ix_sj_claim ON stage_job (serving_group, status, available_at, priority, queued_at);
CREATE INDEX IF NOT EXISTS ix_ej_claim ON external_job (status, available_at, queued_at);
-- D20: 모델별 최근 점검(S11 · /ready lastCheck)과 보관 20건 정리
CREATE INDEX IF NOT EXISTS ix_mc_model ON model_check (model_id, check_id);

-- ---------------------------------------------------------------------
-- 트리거 — CHECK로 표현할 수 없는 규칙(시점 의존 · 다중 행)
-- ---------------------------------------------------------------------
DELIMITER //

-- BR-STY-02 (G11): 제작일 ≤ 오늘 / BR-DEL-05 (D4): 삭제 중 작품에는 이야기를 받지 않는다
-- UC5 E7: 전시 중(승인 + 필수 이야기) 작품의 필수 항목을 비울 수 없다
CREATE OR REPLACE TRIGGER trg_story_bi BEFORE INSERT ON story FOR EACH ROW
BEGIN
  IF NEW.made_on IS NOT NULL AND NEW.made_on > CURRENT_DATE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G11 BR-STY-02 made_on_in_future';
  END IF;
  IF (SELECT status FROM artwork WHERE artwork_id = NEW.artwork_id) = 'deleting' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-DEL-05 artwork_deleting';
  END IF;
END//

CREATE OR REPLACE TRIGGER trg_story_bu BEFORE UPDATE ON story FOR EACH ROW
BEGIN
  IF NEW.made_on IS NOT NULL AND NEW.made_on > CURRENT_DATE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G11 BR-STY-02 made_on_in_future';
  END IF;
  IF (SELECT status FROM artwork WHERE artwork_id = NEW.artwork_id) = 'deleting' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-DEL-05 artwork_deleting';
  END IF;
  -- D34: 걸린 작품의 제목 · 그린 날만 비울 수 없다(나이는 비워도 "나이 미정"으로 전시)
  IF (SELECT hung_result_id FROM artwork WHERE artwork_id = NEW.artwork_id) IS NOT NULL
     AND OLD.title IS NOT NULL AND OLD.made_on IS NOT NULL
     AND (NEW.title IS NULL OR NEW.made_on IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G11 UC5-E7 exhibited_required_cleared';
  END IF;
END//

-- BR-APR-06 · UC4 사전조건: 결정은 확인 대기·처리하지 못함 작품에만 / BR-DEL-05
CREATE OR REPLACE TRIGGER trg_decision_bi BEFORE INSERT ON decision FOR EACH ROW
BEGIN
  DECLARE s VARCHAR(20);
  SELECT status INTO s FROM artwork WHERE artwork_id = NEW.artwork_id;
  IF s NOT IN ('awaiting_review','failed') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G8 BR-APR-06 decision_not_allowed_in_state';
  END IF;
  -- G9: 처리하지 못함에서는 액자·다시 찍기만
  IF s = 'failed' AND NEW.decision_code NOT IN ('frame','retake') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G9 decision_needs_result';
  END IF;
END//

-- BR-CAP-04: 승인된 설명이 있으면 새 초안을 만들지 않는다 / 승인본은 바꾸지 않는다 / BR-DEL-05
CREATE OR REPLACE TRIGGER trg_caption_bi BEFORE INSERT ON caption FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM caption WHERE artwork_id = NEW.artwork_id AND status = 'approved') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-CAP-04 approved_caption_fixed';
  END IF;
  IF (SELECT status FROM artwork WHERE artwork_id = NEW.artwork_id) = 'deleting' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-DEL-05 artwork_deleting';
  END IF;
END//

CREATE OR REPLACE TRIGGER trg_caption_bu BEFORE UPDATE ON caption FOR EACH ROW
BEGIN
  IF OLD.status = 'approved' AND (NEW.body <> OLD.body OR NEW.status <> OLD.status
     OR NEW.source <> OLD.source) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-CAP-04 approved_caption_fixed';
  END IF;
END//

-- BR-INT-04: 원본 참조는 바꾸지 않는다
CREATE OR REPLACE TRIGGER trg_artwork_original_bu BEFORE UPDATE ON artwork_original FOR EACH ROW
BEGIN
  IF NEW.object_id <> OLD.object_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-INT-04 original_immutable';
  END IF;
END//

-- G17 · D10 · BR-SRV-02: 3D 확정은 노출 설정이 켜졌을 때만
-- D34: 걸린 결과는 같은 작품의 결과여야 한다
CREATE OR REPLACE TRIGGER trg_artwork_hung_bu BEFORE UPDATE ON artwork FOR EACH ROW
BEGIN
  IF NEW.hung_result_id IS NOT NULL AND NOT (NEW.hung_result_id <=> OLD.hung_result_id)
     AND (SELECT artwork_id FROM result WHERE result_id = NEW.hung_result_id) <> NEW.artwork_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'D34 hung_result_other_artwork';
  END IF;
END//

CREATE OR REPLACE TRIGGER trg_outcome_bi BEFORE INSERT ON artwork_outcome FOR EACH ROW
BEGIN
  IF NEW.confirmed_path = 'sculpture'
     AND COALESCE((SELECT enabled FROM feature_setting WHERE setting_key = 'sculpture_exposure'), FALSE) = FALSE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G17 sculpture_not_exposed';
  END IF;
END//

CREATE OR REPLACE TRIGGER trg_outcome_bu BEFORE UPDATE ON artwork_outcome FOR EACH ROW
BEGIN
  IF NEW.confirmed_path = 'sculpture' AND (OLD.confirmed_path IS NULL OR OLD.confirmed_path <> 'sculpture')
     AND COALESCE((SELECT enabled FROM feature_setting WHERE setting_key = 'sculpture_exposure'), FALSE) = FALSE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G17 sculpture_not_exposed';
  END IF;
  -- G8: 확정값은 한 번만(처리 뒤 변경은 결정으로)
  IF OLD.confirmed_path IS NOT NULL AND NEW.confirmed_path <> OLD.confirmed_path THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G8 confirmed_path_fixed';
  END IF;
END//

-- BR-PRC-02 (§19 #19): 낮춤으로 닫힌 작업은 다시 열지 않는다(재시도·상태 되돌림 금지)
CREATE OR REPLACE TRIGGER trg_stage_job_bu BEFORE UPDATE ON stage_job FOR EACH ROW
BEGIN
  IF OLD.status = 'done_downgraded' AND (NEW.status <> 'done_downgraded' OR NEW.attempt_count <> OLD.attempt_count) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-PRC-02 no_retry_after_downgrade';
  END IF;
END//

-- BR-MDL-07 · D17: 단계 작업·외부 작업은 활성 버전만 쓴다 / BR-DEL-05: 삭제 중 작품에 새 단계 작업 금지
CREATE OR REPLACE TRIGGER trg_stage_job_bi BEFORE INSERT ON stage_job FOR EACH ROW
BEGIN
  -- S3: 평가 작업(origin='eval')은 평가 대상인 후보 버전을 돌린다. D20: 점검 작업(origin='check')도 같다(점검은 활성화가 아님)
  IF NEW.model_version_id IS NOT NULL AND NEW.origin NOT IN ('eval','check') AND
     (SELECT release_state FROM model_version WHERE version_id = NEW.model_version_id) <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-MDL-07 version_not_active';
  END IF;
  IF NEW.origin = 'eval' AND NEW.artwork_id IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G21 BR-MDL-04 eval_job_with_family_artwork';
  END IF;
  IF NEW.model_version_id IS NOT NULL AND NEW.origin IN ('eval','check') AND
     (SELECT release_state FROM model_version WHERE version_id = NEW.model_version_id) = 'retired' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G21 eval_on_retired_version';
  END IF;
  -- D20 · BR-OPS-05: 점검 작업은 가족 작품을 다루지 않는다
  IF NEW.origin = 'check' AND NEW.artwork_id IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G30 BR-OPS-05 check_job_with_family_artwork';
  END IF;
  IF NEW.artwork_id IS NOT NULL AND (SELECT status FROM artwork WHERE artwork_id = NEW.artwork_id) = 'deleting' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-DEL-01 new_job_blocked';
  END IF;
END//

-- D17 · G2: pose는 팀 내부 키(와 팀 시험 키)만 / G25: 활성 버전만 / 폐기 키 금지
CREATE OR REPLACE TRIGGER trg_external_job_bi BEFORE INSERT ON external_job FOR EACH ROW
BEGIN
  DECLARE k VARCHAR(16); DECLARE ks VARCHAR(8);
  SELECT key_kind, status INTO k, ks FROM api_key WHERE key_id = NEW.key_id;
  IF ks <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G2 key_revoked';
  END IF;
  IF NEW.func = 'pose' AND k NOT IN ('team_internal','test') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G2 D17 pose_team_internal_only';
  END IF;
  IF (SELECT release_state FROM model_version WHERE version_id = NEW.model_version_id) <> 'active' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G25 version_not_active';
  END IF;
END//

-- G22 · BR-MDL-03 · D5: 승격은 해시 일치 전체 재평가 통과 뒤에만 (판정은 v_promotion_eligibility 한 곳)
CREATE OR REPLACE TRIGGER trg_release_event_bi BEFORE INSERT ON release_event FOR EACH ROW
BEGIN
  IF NEW.kind = 'promote' AND NOT EXISTS (
       SELECT 1 FROM v_promotion_eligibility e
        WHERE e.evaluation_id = NEW.evaluation_id AND e.version_id = NEW.to_version_id AND e.eligible = 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G22 promotion_not_eligible';
  END IF;
  -- UC9 E8: 롤백 대상은 롤백 후보여야 한다
  IF NEW.kind = 'rollback' AND
     (SELECT release_state FROM model_version WHERE version_id = NEW.to_version_id) <> 'rollback_candidate' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UC9-E8 no_rollback_candidate';
  END IF;
END//

-- BR-DEL-02 · BR-OPS-04: 끝난 삭제에는 식별 연결이 남지 않는다(CHECK에서 옮김, 파일 머리 주석 9)
CREATE OR REPLACE TRIGGER trg_deletion_bu BEFORE UPDATE ON deletion_request FOR EACH ROW
BEGIN
  IF NEW.status IN ('completed','incomplete') AND (NEW.artwork_id IS NOT NULL OR NEW.child_id IS NOT NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BR-DEL-02 link_remains_after_deletion';
  END IF;
END//

-- G20 · BR-MDL-04: 평가 항목 객체는 평가 묶음 소유여야 한다
CREATE OR REPLACE TRIGGER trg_eval_item_bi BEFORE INSERT ON eval_item FOR EACH ROW
BEGIN
  IF NEW.object_id IS NOT NULL AND
     (SELECT owner_kind FROM stored_object WHERE object_id = NEW.object_id) <> 'eval_set' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G20 BR-MDL-04 family_object_not_allowed';
  END IF;
END//

-- G30 · D20 · BR-OPS-05: 점검 입력은 그 모델의 폐기되지 않은 버전과, 모델에 맞는 종류의 평가 묶음 항목
--   (M7은 입체, M6은 설명 입력, 그 밖은 사진 항목). M4는 규칙이라 점검하지 않는다
CREATE OR REPLACE TRIGGER trg_model_check_bi BEFORE INSERT ON model_check FOR EACH ROW
BEGIN
  DECLARE vm VARCHAR(2); DECLARE vs VARCHAR(20); DECLARE ic VARCHAR(20);
  SELECT model_id, release_state INTO vm, vs FROM model_version WHERE version_id = NEW.version_id;
  IF vm <> NEW.model_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G30 version_model_mismatch';
  END IF;
  IF vs = 'retired' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G30 version_retired';
  END IF;
  IF NEW.model_id = 'M4' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'D20 rule_not_checked';
  END IF;
  SELECT category INTO ic FROM eval_item WHERE item_id = NEW.eval_item_id;
  IF (NEW.model_id = 'M6') <> (ic = 'caption_input') OR (NEW.model_id = 'M7' AND ic <> 'sculpture') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G30 BR-MDL-04 not_check_sample';
  END IF;
END//

-- G29 · BR-ACC-09 · UC15 A1·E9 (1c460b0 사용자 결정): 초대는 만든 보호자만, 공동 보호자가 이미 있으면 초대 불가
CREATE OR REPLACE TRIGGER trg_family_invite_bi BEFORE INSERT ON family_invite FOR EACH ROW
BEGIN
  IF NEW.invited_by IS NULL OR NOT EXISTS (
       SELECT 1 FROM guardian_account g
        WHERE g.account_id = NEW.invited_by AND g.family_id = NEW.family_id AND g.role = 'owner') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G29 invite_owner_only';
  END IF;
  IF EXISTS (SELECT 1 FROM guardian_account g WHERE g.family_id = NEW.family_id AND g.role = 'co') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'G29 co_guardian_full';
  END IF;
END//
DELIMITER ;

-- ---------------------------------------------------------------------
-- 뷰 — 유도 속성과 게이트의 단일 판정 지점
-- ---------------------------------------------------------------------

-- 전시에 필요한 이야기 (UC5 BF5 · C8 둘째 줄). D34: 제목 · 그린 날(나이는 없어도 "나이 미정"으로 전시)
CREATE OR REPLACE VIEW v_story_complete AS
SELECT s.artwork_id,
       (s.title IS NOT NULL AND s.made_on IS NOT NULL) AS story_complete
  FROM story s;

-- G12 전시 판정 — 단일 지점. D34: 걸림 AND 제목 · 그린 날 (BR-EXH-01 · BR-APR-01 개정)
-- cond_approved는 옛 이름을 두고(API 호환) 뜻은 "승인 상태"만. 전시는 cond_hung
CREATE OR REPLACE VIEW v_exhibit_gate AS
SELECT a.artwork_id,
       (a.status = 'approved') AS cond_approved,
       (a.hung_result_id IS NOT NULL) AS cond_hung,
       COALESCE(c.story_complete, FALSE) AS cond_story,
       (a.hung_result_id IS NOT NULL AND a.status <> 'deleting' AND COALESCE(c.story_complete, FALSE)) AS exhibitable
  FROM artwork a LEFT JOIN v_story_complete c ON c.artwork_id = a.artwork_id;

-- 현재 결과 = 가장 나중에 만든 결과 (UC4 A1 뒤에는 2.5D)
CREATE OR REPLACE VIEW v_current_result AS
SELECT r.artwork_id, r.result_id, r.result_kind, r.object_id, r.job_id
  FROM result r
 WHERE r.created_at = (SELECT MAX(r2.created_at) FROM result r2 WHERE r2.artwork_id = r.artwork_id)
   AND r.result_id = (SELECT MAX(r3.result_id) FROM result r3
                       WHERE r3.artwork_id = r.artwork_id AND r3.created_at = r.created_at);

-- 화면 상태 (C1 · C4): '전시 중'은 여기서만 유도
CREATE OR REPLACE VIEW v_artwork_display AS
SELECT a.artwork_id, a.family_id, a.child_id, a.status,
       -- D34: 걸린 채 다시 만드는 중 · 확인 대기 · 실패면 그 진행을 보이고(C1), 아니면 걸렸으면 '전시 중'. 걸림 여부는 exhibitable로 따로
       CASE WHEN g.exhibitable AND a.status NOT IN ('processing','awaiting_review','failed') THEN 'exhibited' ELSE a.status END AS display_status,
       g.exhibitable, g.cond_approved, g.cond_hung, g.cond_story
  FROM artwork a JOIN v_exhibit_gate g ON g.artwork_id = a.artwork_id;

-- S4 단계별 진행 — 점수·객체 키 없음 (BR-SUG-02 · BR-PRV-01)
CREATE OR REPLACE VIEW v_job_progress AS
SELECT j.artwork_id, j.job_id, j.stage_kind, j.status, j.attempt_count,
       j.downgrade_cause, j.error_class, j.queued_at, j.started_at, j.finished_at
  FROM stage_job j
 WHERE j.artwork_id IS NOT NULL;

-- S1 아이별 작품 수 (삭제 중 제외)
CREATE OR REPLACE VIEW v_child_artwork_count AS
SELECT c.child_id, c.family_id, c.alias, COUNT(a.artwork_id) AS artwork_count
  FROM child c LEFT JOIN artwork a ON a.child_id = c.child_id AND a.status <> 'deleting'
 GROUP BY c.child_id, c.family_id, c.alias;

-- S8 가족 전시 — 전시 중만, 연령 묶음 → 제작일 순. 3D는 노출 꺼지면 액자로(D10). 낮춤 원인 비노출(BR-EXH-07)
CREATE OR REPLACE VIEW v_gallery AS
SELECT a.family_id, a.child_id, a.artwork_id,
       s.age_at_creation AS age_group, s.made_on, s.title, s.title_auto, s.made_on_auto, s.age_auto, s.utterance, s.guardian_note, a.making,
       -- D34: 걸린 결과(hung_result_id)를 보인다 — 걸린 채 다시 만드는 중에도 전시는 그대로. 원본 액자 결과는 파일이 없다
       CASE WHEN hr.result_kind IS NULL OR hr.result_kind = 'frame' THEN 'frame'
            WHEN hr.result_kind = 'sculpture'
             AND COALESCE((SELECT f.enabled FROM feature_setting f WHERE f.setting_key = 'sculpture_exposure'), FALSE) = FALSE
            THEN 'frame' ELSE hr.result_kind END AS display_kind,
       CASE WHEN hr.result_kind = 'frame' THEN NULL ELSE hr.object_id END AS result_object_id,
       cp.body AS caption_body, cp.ai_badge
  FROM artwork a
  JOIN v_exhibit_gate g ON g.artwork_id = a.artwork_id AND g.exhibitable
  JOIN story s ON s.artwork_id = a.artwork_id
  LEFT JOIN result hr ON hr.result_id = a.hung_result_id
  LEFT JOIN caption cp ON cp.artwork_id = a.artwork_id AND cp.status = 'approved';

-- G19 보류 판정 — 단일 지점: 취소 요청됐고 아직 멈추지 않은 단계 작업이 있는 작품
CREATE OR REPLACE VIEW v_deletion_hold AS
SELECT j.artwork_id, COUNT(*) AS running_jobs
  FROM stage_job j
 WHERE j.artwork_id IS NOT NULL AND j.cancel_requested_at IS NOT NULL AND j.stopped_at IS NULL
   AND j.status IN ('queued','running','retry_wait')
 GROUP BY j.artwork_id;

-- G22 승격 판정 — 단일 지점 (BR-MDL-03 · BR-MDL-07 · D5)
CREATE OR REPLACE VIEW v_promotion_eligibility AS
SELECT e.evaluation_id, e.version_id, e.item_total,
       COALESCE(SUM(CASE WHEN r.status = 'done' THEN 1 ELSE 0 END), 0) AS done_count,
       COALESCE(SUM(CASE WHEN r.status <> 'done' THEN 1 ELSE 0 END), 0) AS incomplete_count,
       mv.license_confirmed, e.verdict,
       (COALESCE(SUM(CASE WHEN r.status = 'done' THEN 1 ELSE 0 END), 0) = e.item_total
        AND mv.license_confirmed = TRUE AND e.verdict = 'pass'
        AND mv.weights_sha256 IS NOT NULL AND mv.config_hash IS NOT NULL) AS eligible
  FROM evaluation e
  JOIN model_version mv ON mv.version_id = e.version_id
  LEFT JOIN eval_item_result r ON r.evaluation_id = e.evaluation_id
 GROUP BY e.evaluation_id, e.version_id, e.item_total, mv.license_confirmed, e.verdict,
          mv.weights_sha256, mv.config_hash;

-- S10 서비스 지표 (BR-OPS-02 · D2 · D14) — 정의와 검증 계획이며 실적이 아니다
CREATE OR REPLACE VIEW v_metrics_service AS
SELECT
  (SELECT SUM(CASE WHEN first_decision = 'like' THEN 1 ELSE 0 END) * 1.0
          / NULLIF(SUM(CASE WHEN in_approval_base THEN 1 ELSE 0 END), 0)
     FROM artwork_outcome) AS first_result_approval_rate,
  (SELECT SUM(CASE WHEN is_modified THEN 1 ELSE 0 END) * 1.0
          / NULLIF(SUM(CASE WHEN suggestion_at_confirm IN ('animated','relief','frame') THEN 1 ELSE 0 END), 0)
     FROM artwork_outcome) AS suggestion_modify_rate,
  (SELECT COUNT(*) FROM artwork_outcome WHERE result_cause = 'not_delivered') AS not_delivered_count,
  (SELECT COUNT(*) FROM deletion_request WHERE status = 'incomplete') AS deletion_incomplete_count,
  -- 설명 규칙 검사 실패율 = 걸린 LLM 초안 / 생성한 LLM 초안. 생성한 초안 = 걸린 초안 + 통과해 끝난 설명 단계
  (SELECT COUNT(*) * 1.0 / NULLIF(COUNT(*) + (SELECT COUNT(*) FROM stage_job
                                               WHERE stage_kind = 'caption' AND status = 'done'), 0)
     FROM caption_check_failure) AS caption_rule_fail_rate;

-- S10 모델별 지표 — 낮춤률·재시도율·큐 적체. p95는 애플리케이션(Prometheus)에서만 계산
CREATE OR REPLACE VIEW v_metrics_model AS
SELECT mv.model_id, mv.version_label, j.serving_group,
       COUNT(*) AS attempts,
       SUM(CASE WHEN j.downgrade_cause IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) AS downgrade_rate,
       SUM(CASE WHEN j.attempt_count > 1 THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) AS retry_rate,
       SUM(CASE WHEN j.status = 'queued' THEN 1 ELSE 0 END) AS queue_backlog
  FROM stage_job j JOIN model_version mv ON mv.version_id = j.model_version_id
 WHERE j.status <> 'cancelled' AND j.origin NOT IN ('eval','check')   -- S3 · D20: 평가·점검 작업은 운영 지표에서 뺀다
 GROUP BY mv.model_id, mv.version_label, j.serving_group;

-- S10 원인 5분류 (BR-OPS-03)
CREATE OR REPLACE VIEW v_cause_breakdown AS
SELECT result_cause, COUNT(*) AS n FROM artwork_outcome WHERE result_cause IS NOT NULL GROUP BY result_cause;

-- S10 결과 미도달 추적 — 단계 작업 번호 기준, 작품 번호·객체 키 없음 (BR-ACC-03 · BR-OPS-04)
CREATE OR REPLACE VIEW v_not_delivered_trace AS
SELECT j.job_id, mv.model_id, mv.version_label, j.error_class, j.attempt_count, j.finished_at
  FROM stage_job j JOIN model_version mv ON mv.version_id = j.model_version_id
 WHERE j.status = 'failed' AND j.stage_kind IN ('animate_render','depth_relief','sculpture')
   AND j.origin NOT IN ('eval','check');   -- S3 · D20: 평가·점검 작업의 실패는 결과 미도달이 아니다(UC9 E4 · BR-OPS-05)

-- S10 외부 호출량·거부 수 (UC8 A5)
CREATE OR REPLACE VIEW v_external_usage AS
SELECT endpoint,
       SUM(CASE WHEN http_status IN (200,202) THEN 1 ELSE 0 END) AS accepted,
       SUM(CASE WHEN http_status IN (401,403,413,422,429) THEN 1 ELSE 0 END) AS rejected
  FROM external_call_log GROUP BY endpoint;

-- 팀원 계정 마스킹 (S10~S12 헤더 · §보존·마스킹)
CREATE OR REPLACE VIEW v_team_member_masked AS
SELECT member_id,
       CONCAT(LEFT(email, 2), '*@', SUBSTRING(email, LOCATE('@', email) + 1, 2), '*.',
              SUBSTRING_INDEX(email, '.', -1)) AS email_masked
  FROM team_member;

-- 다형 참조 점검 — gate_event.subject_id가 가리키는 행이 없는 건
CREATE OR REPLACE VIEW v_gate_event_orphans AS
SELECT g.event_id, g.subject_kind, g.subject_id FROM gate_event g
 WHERE g.subject_id IS NOT NULL AND (
       (g.subject_kind = 'artwork'       AND NOT EXISTS (SELECT 1 FROM artwork x WHERE x.artwork_id = g.subject_id))
    OR (g.subject_kind = 'child'         AND NOT EXISTS (SELECT 1 FROM child x WHERE x.child_id = g.subject_id))
    OR (g.subject_kind = 'caption'       AND NOT EXISTS (SELECT 1 FROM caption x WHERE x.caption_id = g.subject_id))
    OR (g.subject_kind = 'stage_job'     AND NOT EXISTS (SELECT 1 FROM stage_job x WHERE x.job_id = g.subject_id))
    OR (g.subject_kind = 'deletion'      AND NOT EXISTS (SELECT 1 FROM deletion_request x WHERE x.deletion_id = g.subject_id))
    OR (g.subject_kind = 'model_version' AND NOT EXISTS (SELECT 1 FROM model_version x WHERE x.version_id = g.subject_id))
    OR (g.subject_kind = 'evaluation'    AND NOT EXISTS (SELECT 1 FROM evaluation x WHERE x.evaluation_id = g.subject_id))
    OR (g.subject_kind = 'eval_item'     AND NOT EXISTS (SELECT 1 FROM eval_item x WHERE x.item_id = g.subject_id))
    OR (g.subject_kind = 'external_call' AND NOT EXISTS (SELECT 1 FROM external_call_log x WHERE x.call_id = g.subject_id))
    OR (g.subject_kind = 'family_invite' AND NOT EXISTS (SELECT 1 FROM family_invite x WHERE x.invite_id = g.subject_id))
    OR (g.subject_kind = 'guardian_account' AND NOT EXISTS (SELECT 1 FROM guardian_account x WHERE x.account_id = g.subject_id)));

-- ---------------------------------------------------------------------
-- 상수 시드 (재실행 가능)
-- ---------------------------------------------------------------------
INSERT IGNORE INTO model (model_id, role_name, serving_group, phase, is_rule) VALUES
 ('M1','배경·작품 분리','cpu_vision','P0',FALSE),
 ('M2','종류 판정·태그','cpu_vision','P0',FALSE),
 ('M3','관절·리깅·렌더','cpu_vision','P0',FALSE),
 ('M4','판정 보조 규칙','cpu_vision','P0',TRUE),
 ('M5','2.5D 부조 깊이','gpu','P0',FALSE),
 ('M6','작품 설명','llm','P0.5',FALSE),
 ('M7','3D 조각','gpu','P1',FALSE);

INSERT IGNORE INTO feature_setting (setting_key, enabled) VALUES ('sculpture_exposure', FALSE);

INSERT IGNORE INTO gate_catalog (gate_id, gate_name, nature, release_role) VALUES
 ('G0','가족 접근','access','guardian'),
 ('G1','팀원 역할','access','unresolved'),
 ('G2','API 키·요청 한도','access','external_client'),
 ('G3','기록 반영 원자성','atomic','guardian'),
 ('G4','별칭 검사','input','guardian'),
 ('G5','사진 검사','input','guardian'),
 ('G6','내구 접수','atomic','guardian'),
 ('G7','판정 제안 도달','infra_exhausted','guardian'),
 ('G8','확정 가능 상태','business_state','guardian'),
 ('G9','결과 단계 재시도 소진','infra_exhausted','guardian'),
 ('G10','결과 열람','safety','guardian'),
 ('G11','이야기 값 검증','input','guardian'),
 ('G12','전시','business_state','guardian'),
 ('G13','설명 모델 사용 조건','safety','evaluator'),
 ('G14','설명 입력 최소','input','guardian'),
 ('G15','LLM 초안 도달','infra_exhausted','guardian'),
 ('G16','설명 규칙 검사','quality','system'),
 ('G17','3D 노출','business_state','operator'),
 ('G18','삭제 착수','atomic','guardian'),
 ('G19','처리 멈춤 확인','hold','system'),
 ('G20','평가 항목 등록','input','evaluator'),
 ('G21','평가 착수','safety','evaluator'),
 ('G22','승격','safety','evaluator'),
 ('G23','시험 호출 입력','input','integrator'),
 ('G24','요청 크기·형식','input','external_client'),
 ('G25','외부 기능 준비','safety','operator'),
 -- D18: 보호자 이메일 가입과 메일 링크
 ('G26','이메일 검사(가입)','input','guardian'),
 ('G27','메일 링크 토큰','input','guardian'),
 -- U1 확정: 공동 보호자
 ('G28','초대 수락','input','guardian'),
 ('G29','보호자 관리 권한','access','guardian'),
 -- D20: 모델 점검
 ('G30','점검 입력','input','evaluator');
-- 1c460b0: G29 이름 변경("보호자 해제 권한" → "보호자 관리 권한"). 이미 시드된 DB에도 적용(멱등)
UPDATE gate_catalog SET gate_name = '보호자 관리 권한' WHERE gate_id = 'G29';
-- T132: G17(3D 노출)의 해제 주체는 서비스 운영자(운영 CLI ops:feature, D22 ⑨). 이미 시드된 DB에도 적용(멱등)
UPDATE gate_catalog SET release_role = 'operator' WHERE gate_id = 'G17';

-- ---------------------------------------------------------------------
-- (D34, 2026-09-30) 옮기기 — 이미 승인된 작품을 그때 보이던 결과로 건다(다시 실행해도 안전)
-- 액자 결정(frame)이었거나 결과가 없던 승인 작품은 원본 액자 결과 행을 만든다(파일 없음, 작업 없음)
-- ---------------------------------------------------------------------
INSERT IGNORE INTO result (artwork_id, job_id, result_kind, object_id)
SELECT a.artwork_id, NULL, 'frame', NULL
  FROM artwork a
 WHERE a.status = 'approved' AND a.hung_result_id IS NULL
   AND (EXISTS (SELECT 1 FROM decision d WHERE d.artwork_id = a.artwork_id AND d.decision_code = 'frame')
        OR NOT EXISTS (SELECT 1 FROM result r WHERE r.artwork_id = a.artwork_id));
UPDATE artwork a
   SET a.hung_result_id = COALESCE(
         (SELECT r.result_id FROM result r WHERE r.artwork_id = a.artwork_id AND r.result_kind = 'frame'
             AND EXISTS (SELECT 1 FROM decision d WHERE d.artwork_id = a.artwork_id AND d.decision_code = 'frame')),
         (SELECT cr.result_id FROM v_current_result cr WHERE cr.artwork_id = a.artwork_id)),
       a.hung_at = COALESCE(a.hung_at, a.approved_at)
 WHERE a.status = 'approved' AND a.hung_result_id IS NULL;

-- ===================================================================================================
-- 개정 (2026-09-30, 이제민 결정 D40 — 미술관 마을, SD_02 §17-13 · UC_16): 아이 캐릭터 · 미술관 모양, 이웃(가족끼리) 관계와 초대.
--   child: character_kind · character_color · museum_style(목록 값만, 기존 아이는 NULL = 화면 기본값)
--   family_neighbor: 서로 이웃인 두 가족(작은 번호가 family_low — 한 쌍 1행). 이웃만 서로의 미술관을 볼 수 있다(BR-ACC-01 예외)
--   neighbor_invite: 이웃 초대 링크(한 번 · 7일 · 가족당 대기 1건 · 해시만 저장 — family_invite와 같은 규칙)
-- ===================================================================================================
ALTER TABLE child ADD COLUMN IF NOT EXISTS character_kind  VARCHAR(16) NULL AFTER alias;
ALTER TABLE child ADD COLUMN IF NOT EXISTS character_color VARCHAR(16) NULL AFTER character_kind;
ALTER TABLE child ADD COLUMN IF NOT EXISTS museum_style    VARCHAR(24) NULL AFTER character_color;
ALTER TABLE child DROP CONSTRAINT IF EXISTS chk_child_character;
ALTER TABLE child ADD CONSTRAINT chk_child_character CHECK (
  (character_kind IS NULL OR character_kind IN ('bear','rabbit','cat','dog','fox','penguin','dino','owl'))
  AND (character_color IS NULL OR character_color IN ('sunflower','peach','sky','leaf','lavender','cloud'))
  AND (museum_style IS NULL OR museum_style IN ('glass_pyramid','white_spiral','column_temple','clock_station','brick_chimney','golden_dome','hanok_roof','silver_wave')));

CREATE TABLE IF NOT EXISTS family_neighbor (
  family_low   BIGINT    NOT NULL,
  family_high  BIGINT    NOT NULL,
  created_at   DATETIME  NOT NULL DEFAULT (UTC_TIMESTAMP()),
  CONSTRAINT pk_family_neighbor PRIMARY KEY (family_low, family_high),
  CONSTRAINT chk_neighbor_order CHECK (family_low < family_high),
  CONSTRAINT fk_neighbor_low  FOREIGN KEY (family_low)  REFERENCES family (family_id) ON DELETE CASCADE,
  CONSTRAINT fk_neighbor_high FOREIGN KEY (family_high) REFERENCES family (family_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_neighbor_high ON family_neighbor (family_high);

CREATE TABLE IF NOT EXISTS neighbor_invite (
  invite_id           BIGINT    NOT NULL AUTO_INCREMENT,
  family_id           BIGINT    NOT NULL,
  invited_by          BIGINT    NULL,
  token_hash          CHAR(64)  NOT NULL,
  expires_at          DATETIME  NOT NULL,
  accepted_at         DATETIME  NULL DEFAULT NULL,
  accepted_family     BIGINT    NULL,
  revoked_at          DATETIME  NULL DEFAULT NULL,
  created_at          DATETIME  NOT NULL DEFAULT (UTC_TIMESTAMP()),
  pending_family_key  BIGINT    GENERATED ALWAYS AS (CASE WHEN accepted_at IS NULL AND revoked_at IS NULL THEN family_id END) STORED,
  CONSTRAINT pk_neighbor_invite PRIMARY KEY (invite_id),
  CONSTRAINT uq_neighbor_invite_token UNIQUE (token_hash),
  CONSTRAINT uq_neighbor_invite_pending UNIQUE (pending_family_key),
  CONSTRAINT chk_neighbor_invite_done CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT fk_ninv_family FOREIGN KEY (family_id) REFERENCES family (family_id) ON DELETE CASCADE,
  CONSTRAINT fk_ninv_by FOREIGN KEY (invited_by) REFERENCES guardian_account (account_id) ON DELETE SET NULL,
  CONSTRAINT fk_ninv_accepted FOREIGN KEY (accepted_family) REFERENCES family (family_id) ON DELETE SET NULL
);
