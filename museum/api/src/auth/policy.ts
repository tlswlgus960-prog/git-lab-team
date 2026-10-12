// RBAC 정본(D24) — 팀원 권한 이름 → 허용 역할. 라우트는 역할 목록 대신 권한 이름으로만 검사한다(requirePerm).
// 표의 원본은 SD_02 §2-1 역할별 메뉴 표(D21)이고, 계약은 팀원 경로마다 역할을 보안 범위(staffSession: [역할…])로, 권한 이름을 x-permission으로 적는다.
// tests/rbac.test.ts가 표(이 파일)·계약·실제 응답(역할별 허용·거부)을 대조한다.
//
// 보호자 쪽 권한은 역할표가 아니라 범위로 정한다: 보호자 세션은 자기 가족 데이터만(G0, BR-ACC-01~04),
// 가족 안에서 초대·해제는 만든 보호자(owner)만(G29, family/routes.ts). 외부 클라이언트는 API 키 종류로(model-api, D17).
import type { Pool } from 'mysql2/promise';
import { staffAuth, type StaffRole } from './guards.js';

const ALL: StaffRole[] = ['operator', 'evaluator', 'integrator'];
// 규칙: 서비스 운영자(operator)는 모든 권한을 가진다(SD_02 §2-1, 2026-09-30 이제민) — 아래 표의 모든 줄에 operator가 있어야 한다(tests/rbac.test.ts).

export const STAFF_POLICY = {
  /** 로그인한 팀원 상태(/v1/ops/me) */
  'staff.me': ALL,
  /** S10 상태·지표 읽기 — 세 역할(UC9 A1 롤백 판단, UC11 A5 상태 보기) */
  'metrics.read': ALL,
  /** S10 결과 미도달 추적 — 운영자의 조치 목록 */
  'unreached.read': ['operator'],
  /** S11 매니페스트·모델 상태·평가 항목 읽기 */
  'models.read': ALL,
  /** S11 지금 불러오기 */
  'models.warmup': ['operator', 'evaluator'],
  /** S11 모델 점검 실행(D20) */
  'models.check': ['operator', 'evaluator'],
  /** S11 마지막 점검 읽기(D20) */
  'models.check.read': ALL,
  /** S11 후보 등록·평가·판단·승격·롤백·비활성화·평가 항목 등록(UC9) — 운영자도(2026-09-30 이제민: 운영자는 모든 권한) */
  'models.manage': ['operator', 'evaluator'],
  /** S12 API활용(명세·시험 호출) */
  'apiGuide.use': ['operator', 'integrator'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type StaffPermission = keyof typeof STAFF_POLICY;

/** 권한 이름으로 팀원 세션·역할을 검사한다(G1). 역할은 요청마다 DB에서 읽어 회수·정지가 바로 반영된다. */
export function requirePerm(db: Pool, perm: StaffPermission) {
  return staffAuth(db, [...STAFF_POLICY[perm]]);
}

/** 그 역할들로 할 수 있는 권한 목록(화면 메뉴·시험용). */
export function permissionsOf(roles: readonly StaffRole[]): StaffPermission[] {
  return (Object.keys(STAFF_POLICY) as StaffPermission[]).filter((p) => STAFF_POLICY[p].some((r) => roles.includes(r)));
}
