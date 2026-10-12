// S0·S0b 입력 검사(T052·T053). UC13 E2·E3 · UC14 E3 — 화면이 먼저 막고 API도 같은 검사를 한다.
// 문구는 docs/C/C_화면문구.md §4 S0(ko.auth). 비밀번호 규칙은 계약 예시값 8자 이상(U19).
import { ko } from '@/copy/ko';
import type { ApiError } from '@/api/client';

// 계약 format: email 과 같은 수준의 느슨한 검사 — 화면은 명백한 형식 오류만 막는다
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailProblem(email: string): string {
  const v = email.trim();
  if (!v) return ko.auth.needEmail;
  if (v.length > 254 || !EMAIL.test(v)) return ko.auth.badEmail;
  return '';
}

export function passwordProblems(password: string, confirm: string): { password: string; confirm: string } {
  return {
    password: password.length < 8 ? ko.auth.shortPassword : '',
    confirm: password.length >= 8 && password !== confirm ? ko.auth.mismatch : '',
  };
}

/** 422 invalid_fields 의 fields → 칸별 안내(서버가 화면보다 엄하면 여기로 온다). */
export function fieldHints(e: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of e.problem?.fields ?? []) {
    const name = f.name ?? '';
    if (name === 'email') out.email = ko.auth.badEmail;
    else if (name === 'password') out.password = ko.auth.shortPassword;
    else if (name === 'passwordConfirm') out.confirm = ko.auth.mismatch;
  }
  return out;
}

/** 보호자 여정 레일 단계(SD_02 S0 와이어프레임). S1·S2는 child부터 쓴다. */
export const JOURNEY = (['signup', 'verify', 'child', 'upload', 'confirm', 'review', 'story', 'exhibit'] as const)
  .map((key) => ({ key, label: ko.journey[key] }));
export const JOURNEY_FROM_CHILD = JOURNEY.slice(2);
