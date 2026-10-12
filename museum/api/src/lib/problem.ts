// RFC 9457 Problem Details + code (research R-10, contracts/openapi.yaml Problem).
// 트리거 SIGNAL MESSAGE_TEXT("G11 BR-STY-02 made_on_in_future" 형식)를 게이트·사유 코드로 바꾼다(data-model §5).
export type ProblemCode =
  | 'unauthorized' | 'forbidden_role' | 'not_found' | 'conflict' | 'invalid_input'
  | 'payload_too_large' | 'validation_failed' | 'not_saved' | 'llm_unavailable'
  | 'token_invalid' | 'email_unverified' | 'rate_limited';

const STATUS: Record<ProblemCode, number> = {
  unauthorized: 401, forbidden_role: 403, not_found: 404, conflict: 409, invalid_input: 400,
  payload_too_large: 413, validation_failed: 422, not_saved: 503, llm_unavailable: 503,
  token_invalid: 400, email_unverified: 403, rate_limited: 429,
};

export interface Field { name: string; reason: string; message?: string }

// 오류 안내(계약 머리말 "오류 안내", 2026-09-30 점검표 W5·E4·E7) — API를 부르는 사람을 위한 문장. 화면 문구는 web copy/ko.ts가 reason·gate로 정한다.
const DETAIL: Record<ProblemCode, string> = {
  unauthorized: '로그인이 필요합니다. 로그인한 뒤 다시 요청해 주세요.',
  forbidden_role: '이 기능을 쓸 권한이 없습니다. 권한이 있는 계정으로 요청해 주세요.',
  not_found: '요청한 대상을 찾을 수 없습니다. 주소와 id를 확인해 주세요.',
  conflict: '지금 상태에서는 이 요청을 처리할 수 없습니다. reason의 상태를 확인한 뒤 다시 요청해 주세요.',
  invalid_input: '요청 본문이 올바른 JSON이 아닙니다. JSON 형식으로 고쳐 다시 보내 주세요.',
  payload_too_large: '보낸 내용이 너무 큽니다. 크기 상한(이미지 20MB, JSON 64KB) 이하로 줄여 다시 보내 주세요.',
  validation_failed: '입력 값이 올바르지 않습니다. 계약 문서(/openapi.json)의 규칙에 맞게 고쳐 다시 보내 주세요.',
  not_saved: '서버 쪽 문제로 처리하지 못했습니다. 요청을 고칠 필요는 없고, 잠시 뒤 다시 시도해 주세요.',
  llm_unavailable: '설명 생성 서버를 지금 쓸 수 없습니다. 요청을 고칠 필요는 없고, 잠시 뒤 다시 시도해 주세요.',
  token_invalid: '링크(토큰)가 올바르지 않거나 만료되었습니다. 새 링크를 받아 다시 시도해 주세요.',
  email_unverified: '이메일 확인이 필요합니다. 받은 메일의 확인 링크를 누른 뒤 다시 요청해 주세요.',
  rate_limited: '요청이 너무 많습니다. 잠시 기다린 뒤 다시 요청해 주세요.',
};
const FIELD_MESSAGE: Record<string, string> = {
  required: '필수 값입니다. 값을 넣어 주세요.',
  unrecognized: '계약에 없는 칸입니다. 이 칸을 빼고 보내 주세요(칸 이름 오타인지 확인).',
  not_positive_integer: '1 이상의 정수여야 합니다(예: 12).',
  not_in_enum: '허용된 값 중 하나여야 합니다.',
  not_date: 'YYYY-MM-DD 형식의 실제 날짜여야 합니다(예: 2026-09-30).',
  blank: '공백만으로는 안 됩니다. 글자를 넣어 주세요.',
  too_long: '너무 깁니다. 허용 길이 이하로 줄여 주세요.',
  future: '오늘이나 지난 날짜여야 합니다. 미래 날짜는 받지 않습니다.',
  password_mismatch: '비밀번호 확인이 비밀번호와 같아야 합니다.',
};
function detailOf(code: ProblemCode, reason: string | undefined, fields?: Field[]): string {
  if (code === 'validation_failed' && fields?.length) {
    return `입력 값이 올바르지 않습니다 — ${fields.map((f) => `${f.name || '본문'}: ${f.message}`).join(' / ')} 고쳐서 다시 보내 주세요.`;
  }
  if (reason === 'made_on_in_future') return '만든 날(madeOn)은 오늘이나 지난 날짜여야 합니다. 고쳐서 다시 보내 주세요.';
  return DETAIL[code];
}

/** zod 검사 정보로 칸 안내 문장을 만든다(허용 값·길이·범위·기대 타입). */
function zodMessage(i: { code: string; message: string; expected?: string; received?: string; type?: string; minimum?: unknown; maximum?: unknown; options?: unknown[]; validation?: unknown }): string {
  const TYPE: Record<string, string> = { string: '문자열', number: '숫자', integer: '정수', boolean: '참/거짓(true·false)', array: '목록(배열)', object: '객체' };
  const unit = i.type === 'string' ? '자' : i.type === 'array' ? '개' : '';
  switch (i.code) {
    case 'invalid_type': return i.received === 'undefined' ? FIELD_MESSAGE.required : `${TYPE[i.expected ?? ''] ?? i.expected}이어야 합니다(받은 값: ${TYPE[i.received ?? ''] ?? i.received}).`;
    case 'too_small': return i.type === 'string' && i.minimum === 1 ? FIELD_MESSAGE.blank : `${i.minimum}${unit} 이상이어야 합니다.`;
    case 'too_big': return `${i.maximum}${unit} 이하여야 합니다.`;
    case 'invalid_enum_value': return `허용 값 중 하나여야 합니다: ${(i.options ?? []).join(', ')}.`;
    case 'invalid_string': return i.validation === 'email' ? '이메일 형식이어야 합니다(예: name@example.com).' : '형식이 맞지 않습니다. 계약 문서의 형식(pattern)을 확인해 주세요.';
    case 'custom': return FIELD_MESSAGE[i.message] ?? '올바른 값을 넣어 주세요.';
    default: return '올바른 값을 넣어 주세요.';
  }
}

export class Problem extends Error {
  readonly status: number;
  constructor(
    readonly code: ProblemCode,
    readonly reason?: string,
    readonly gate?: string,
    readonly fields?: Field[],
    status?: number,
  ) {
    super(reason ?? code);
    this.status = status ?? STATUS[code];
  }
  body(requestId?: string) {
    const fields = this.fields?.map((f) => ({ ...f, message: f.message ?? FIELD_MESSAGE[f.reason] ?? '올바른 값을 넣어 주세요' }));
    return {
      type: `about:blank#${this.code}`,
      title: this.code,
      status: this.status,
      code: this.code,
      ...(this.reason ? { reason: this.reason } : {}),
      ...(this.gate ? { gate: this.gate } : {}),
      detail: detailOf(this.code, this.reason, fields),
      ...(fields ? { fields } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}

/** zod 검사 실패 → 계약 fields(JSON 본문 공통 오류, 계약 머리말). 모르는 칸은 칸마다 reason 'unrecognized'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodFields(err: { issues: any[] }): Field[] {
  return err.issues.flatMap((i) => (i.code === 'unrecognized_keys'
    ? (i.keys as string[] ?? []).map((k) => ({ name: k, reason: 'unrecognized', message: FIELD_MESSAGE.unrecognized }))
    : [{ name: String(i.path[0] ?? ''), reason: i.code === 'custom' ? i.message : i.code, message: zodMessage(i) }]));
}

/** 트리거가 SIGNAL SQLSTATE '45000'으로 거절한 경우 {gate, reason}을 뽑는다. 아니면 null. */
export function parseSignal(err: unknown): { gate?: string; reason: string } | null {
  const e = err as { sqlState?: string; sqlMessage?: string };
  if (e?.sqlState !== '45000' || !e.sqlMessage) return null;
  const parts = e.sqlMessage.trim().split(/\s+/);
  const gate = parts.find((p) => /^G\d{1,2}$/.test(p));
  const reason = parts[parts.length - 1];
  return { gate, reason };
}

/** 유일 제약 위반(ER_DUP_ENTRY)인가 — 제약 이름으로 가린다. */
export function isDup(err: unknown, key?: string): boolean {
  const e = err as { code?: string; sqlMessage?: string };
  return e?.code === 'ER_DUP_ENTRY' && (!key || (e.sqlMessage ?? '').includes(key));
}
