// gate_event 기록(data-model §5): 차단이 일어난 게이트만, 사유는 분류 코드만(BR-PRV-01).
import type { Pool, PoolConnection } from 'mysql2/promise';

export type SubjectKind =
  | 'session' | 'child' | 'artwork' | 'caption' | 'stage_job' | 'deletion' | 'model_version'
  | 'evaluation' | 'eval_item' | 'external_call' | 'family_invite' | 'guardian_account';
export type ActorRole = 'guardian' | 'operator' | 'evaluator' | 'integrator' | 'external_client' | 'system' | 'anonymous';

export async function recordGate(
  db: Pool | PoolConnection,
  gate: string,
  subjectKind: SubjectKind,
  subjectId: number | null,
  actorRole: ActorRole,
  reasonCode: string,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO gate_event (gate_id, subject_kind, subject_id, actor_role, reason_code)
       VALUES (?, ?, ?, ?, ?)`,
      [gate, subjectKind, subjectId, actorRole, reasonCode.slice(0, 40)],
    );
  } catch {
    // 기록 실패가 요청 결과를 바꾸지 않는다
  }
}
