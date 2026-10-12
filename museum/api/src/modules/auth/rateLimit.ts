// 인증·초대 요청 한도(T049, R-24, SD_03 보완 S7 auth_rate_event). 이메일·IP 원문 대신 HMAC만 저장한다.
// 예시값 [추론, U19]: 가입·재발송·찾기 — 같은 이메일 10분 3회, 같은 IP 1시간 20회 / 로그인 실패 같은 이메일 15분 10회 /
// 초대 — 같은 가족 하루 20건, 같은 이메일 하루 3건.
import { createHmac } from 'node:crypto';
import type { Pool, PoolConnection } from 'mysql2/promise';

export type RateAction = 'signup' | 'resend' | 'recovery' | 'login' | 'invite';
type SubjectType = 'email' | 'ip' | 'family';

interface Rule { type: SubjectType; limit: number; minutes: number }
export const RULES: Record<RateAction, Rule[]> = {
  signup: [{ type: 'email', limit: 3, minutes: 10 }, { type: 'ip', limit: 20, minutes: 60 }],
  resend: [{ type: 'email', limit: 3, minutes: 10 }, { type: 'ip', limit: 20, minutes: 60 }],
  recovery: [{ type: 'email', limit: 3, minutes: 10 }, { type: 'ip', limit: 20, minutes: 60 }],
  login: [{ type: 'email', limit: 10, minutes: 15 }],
  invite: [{ type: 'family', limit: 20, minutes: 1440 }, { type: 'email', limit: 3, minutes: 1440 }],
};

export const normEmail = (e: string) => e.trim().toLowerCase();

export class RateLimiter {
  constructor(private db: Pool | PoolConnection, private secret: string) {}
  private h(v: string) { return createHmac('sha256', this.secret).update(v).digest('hex'); }

  /** 한도를 넘었는가(기록하지 않음). 로그인 실패처럼 결과를 본 뒤 기록할 때 쓴다. */
  async exceeded(action: RateAction, subjects: Partial<Record<SubjectType, string>>): Promise<boolean> {
    for (const r of RULES[action]) {
      const v = subjects[r.type];
      if (!v) continue;
      const [rows] = await this.db.query(
        `SELECT COUNT(*) n FROM auth_rate_event
          WHERE subject_type = ? AND subject_hash = ? AND action = ? AND occurred_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE`,
        [r.type, this.h(v), action, r.minutes],
      );
      if (Number((rows as { n: number }[])[0].n) >= r.limit) return true;
    }
    return false;
  }

  async record(action: RateAction, subjects: Partial<Record<SubjectType, string>>): Promise<void> {
    for (const r of RULES[action]) {
      const v = subjects[r.type];
      if (v) await this.db.query(`INSERT INTO auth_rate_event (subject_hash, subject_type, action) VALUES (?, ?, ?)`, [this.h(v), r.type, action]);
    }
  }

  /** 한도 안이면 true(그리고 기록), 넘으면 false(기록 안 함). subjects는 규칙의 type별 값. */
  async take(action: RateAction, subjects: Partial<Record<SubjectType, string>>): Promise<boolean> {
    for (const r of RULES[action]) {
      const v = subjects[r.type];
      if (!v) continue;
      const [rows] = await this.db.query(
        `SELECT COUNT(*) n FROM auth_rate_event
          WHERE subject_type = ? AND subject_hash = ? AND action = ? AND occurred_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE`,
        [r.type, this.h(v), action, r.minutes],
      );
      if (Number((rows as { n: number }[])[0].n) >= r.limit) return false;
    }
    for (const r of RULES[action]) {
      const v = subjects[r.type];
      if (v) await this.db.query(`INSERT INTO auth_rate_event (subject_hash, subject_type, action) VALUES (?, ?, ?)`, [this.h(v), r.type, action]);
    }
    return true;
  }
}
