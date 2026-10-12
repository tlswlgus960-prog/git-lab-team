// E2E 스택 포트 — p1(9501·9521·9541, Mailpit 1025/8025)과 겹치지 않게 한다.
export const WEB_PORT = Number(process.env.WEB_PORT ?? 9613);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 9621);
export const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 1125);
export const MAIL_PORT = Number(process.env.E2E_MAIL_PORT ?? 8125);
/** 가짜 카카오(D36, stack/kakao-fake.ts) */
export const KAKAO_PORT = Number(process.env.E2E_KAKAO_PORT ?? 8126);

/** E2E 임시 DB에만 있는 팀원(세 역할) */
export const STAFF = { email: 'staff@e2e.test', password: 'e2e-Staff-2026' };
