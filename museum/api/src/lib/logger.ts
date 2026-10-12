// 허용 목록 로거(BR-PRV-01, R-17): 이미지·객체 키·자유 입력·이메일·토큰·예외 원문은 남기지 않는다.
import pino from 'pino';
import { requestContext } from './requestContext.js';

const ALLOWED = new Set([
  'requestId', 'route', 'method', 'status', 'code', 'reason', 'gate', 'stage', 'modelId',
  'modelVersion', 'outcome', 'durationMs', 'event',
]);

const base = pino({ level: process.env.LOG_LEVEL ?? 'info', base: undefined });

/** 허용 목록만 남기고, 요청 맥락 안이면 requestId를 붙인다(요청 밖 — 기동·sweeper — 는 번호 없음). */
export function logFields(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const rid = requestContext.getStore()?.requestId;
  if (rid && fields.requestId === undefined) out.requestId = rid;
  for (const [k, v] of Object.entries(fields)) if (ALLOWED.has(k)) out[k] = v;
  return out;
}

export const log = {
  info: (fields: Record<string, unknown>, msg?: string) => base.info(logFields(fields), msg),
  warn: (fields: Record<string, unknown>, msg?: string) => base.warn(logFields(fields), msg),
  error: (fields: Record<string, unknown>, msg?: string) => base.error(logFields(fields), msg),
};
