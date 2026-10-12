import mysql, { type Pool } from 'mysql2/promise';
import { inject } from 'vitest';

export function testPool(): Pool {
  return mysql.createPool({ socketPath: inject('DB_SOCKET'), user: 'root', database: 'uam_test', timezone: 'Z', connectionLimit: 5 });
}

/** 가족·운영 데이터 테이블을 비운다(상수 시드는 그대로). */
export async function resetData(db: Pool) {
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['gate_event', 'caption_check_failure', 'caption_selected_tag', 'caption', 'story', 'decision', 'result',
    'tag_candidate', 'judgment', 'artwork_outcome', 'deletion_request', 'stage_job', 'model_check', 'artwork_original', 'stored_object',
    'artwork', 'child', 'family_neighbor', 'neighbor_invite', 'family_invite', 'auth_email_token', 'app_session', 'auth_rate_event', 'guardian_account', 'family',
    'external_call_log', 'external_job', 'api_key', 'release_event', 'eval_item_result', 'evaluation', 'eval_item',
    'model_version', 'team_member_role', 'team_member']) {
    await db.query(`DELETE FROM ${t}`);
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
}
