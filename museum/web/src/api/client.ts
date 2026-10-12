// API 클라이언트(T036, R-10, G0·G1, D21). 계약(contracts/openapi.yaml)에 있는 경로만 부른다.
// - 같은 출처로만 부른다(개발은 Vite 프록시, 운영은 nginx 9501) — 쿠키 세션, CORS 없음.
// - 오류는 Problem Details → ApiError. 화면 사상은 code가 아니라 reason+gate(ko.ts problemCopy).
// - 401 → 로그인(next), 409 no_family → S1d. 네트워크·5xx는 §17 전역 실패 규칙.
import type { components } from './types.gen';
import { problemCopy, type BlockVariant } from '@/copy/ko';

export type Problem = components['schemas']['Problem'];

export class ApiError extends Error {
  constructor(public status: number, public problem: Problem | null) {
    super(problem?.reason ?? problem?.code ?? `http_${status}`);
  }
  get reason() { return this.problem?.reason ?? null; }
  get gate() { return this.problem?.gate ?? null; }
  get code() { return this.problem?.code ?? (this.status === 0 ? 'network' : null); }
  /** §17 전역 실패 — 서버 무응답·장애(게이트 아님) */
  get unavailable() { return this.status === 0 || this.status >= 500 && this.problem?.code !== 'not_saved'; }
}

/** 화면 C2 차단 블록 모델(SD_02 §3-3). */
export interface BlockNotice {
  variant: BlockVariant;
  gate: string | null;
  summary: string;
  reason: string;
  releaser: string;
  self: boolean;
  actions: string[];
  fields: { name: string; reason: string }[];
}

export function toBlock(e: ApiError): BlockNotice {
  const c = problemCopy({ gate: e.gate, reason: e.reason, code: e.code });
  const fields = (e.problem?.fields ?? []).map((f) => ({ name: f.name ?? '', reason: f.reason ?? '' }));
  return { ...c, actions: [...c.actions], gate: e.gate, fields };
}

/** 라우터가 등록한다(순환 import 방지). */
export interface Navigator {
  toLogin(shell: 'app' | 'ops'): void;
  toNoFamily(): void;
}
let nav: Navigator | null = null;
export function setNavigator(n: Navigator | null) { nav = n; }

export interface RequestOptions {
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  /** 401·no_family 자동 이동을 끈다(로그인 화면·가드 자체의 호출) */
  noRedirect?: boolean;
}

export async function request<T>(method: string, path: string, opt: RequestOptions = {}): Promise<T> {
  const q = opt.query ? Object.entries(opt.query).filter(([, v]) => v !== undefined) : [];
  const url = q.length ? `${path}?${new URLSearchParams(q.map(([k, v]) => [k, String(v)]))}` : path;
  const headers: Record<string, string> = { Accept: 'application/json', ...opt.headers };
  let body: BodyInit | undefined;
  if (opt.form) body = opt.form;
  else if (opt.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opt.body); }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, null);
  }
  if (res.status === 204 || res.status === 202 && !res.headers.get('content-type')) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json().catch(() => null) : null;
  if (res.ok) return data as T;

  const err = new ApiError(res.status, data && typeof data === 'object' && 'code' in data ? (data as Problem) : null);
  if (!opt.noRedirect && nav) {
    const ops = path.startsWith('/v1/ops') || path.startsWith('/v1/admin');
    if (res.status === 401) nav.toLogin(ops ? 'ops' : 'app');
    else if (res.status === 409 && err.reason === 'no_family') nav.toNoFamily();
  }
  throw err;
}

export const api = {
  get: <T>(path: string, o?: RequestOptions) => request<T>('GET', path, o),
  post: <T>(path: string, o?: RequestOptions) => request<T>('POST', path, o),
  put: <T>(path: string, o?: RequestOptions) => request<T>('PUT', path, o),
  patch: <T>(path: string, o?: RequestOptions) => request<T>('PATCH', path, o),
  del: <T>(path: string, o?: RequestOptions) => request<T>('DELETE', path, o),
};
