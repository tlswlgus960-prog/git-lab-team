// 셸 메뉴(T040). 운영 메뉴는 SD_02 §2-1 역할별 메뉴 표(D21·D22 ⑤)가 정본이다 — API 역할 검사와 같은 값.
import { ko } from '@/copy/ko';
import type { MenuItem } from '@/components/RoleHeader.vue';

export const APP_MENU: MenuItem[] = [
  { to: '/app', label: ko.shell.appMenu.gallery }, // 미술관(전시실 홈)
  { to: '/app/upload', label: ko.shell.appMenu.upload },
  { to: '/app/works', label: ko.shell.appMenu.artworks }, // 작품 관리(S4 목록)
  { to: '/app/children', label: ko.shell.appMenu.children },
  { to: '/app/family', label: ko.shell.appMenu.family },
  { to: '/app/town', label: ko.shell.appMenu.town }, // D52: 미술관 마을(외관 · 친구 미술관)
  { to: '/app/family#neighbors', label: ko.shell.appMenu.friends }, // D52: 친구 초대(가족 화면 친구 칸)
];

/** 화면별 접근 역할(읽기 포함). */
export const OPS_ROLES = {
  status: ['operator', 'evaluator', 'integrator'],
  models: ['operator', 'evaluator', 'integrator'],
  apiGuide: ['operator', 'integrator'],
} as const;

export function opsMenu(roles: readonly string[]): MenuItem[] {
  const has = (need: readonly string[]) => roles.some((r) => need.includes(r));
  const m: MenuItem[] = [];
  if (has(OPS_ROLES.status)) m.push({ to: '/ops/status', label: ko.shell.menu.status });
  if (has(OPS_ROLES.models)) m.push({ to: '/ops/models', label: has(['operator', 'evaluator']) ? ko.shell.menu.models : ko.shell.menu.modelsRead });
  if (has(OPS_ROLES.apiGuide)) m.push({ to: '/ops/api-guide', label: ko.shell.menu.apiGuide });
  return m;
}

/** next 복귀 주소는 같은 셸의 상대 경로만 받는다(열린 이동 방지). */
export function safeNext(next: unknown, shell: 'app' | 'ops'): string {
  const home = shell === 'app' ? '/app' : '/ops';
  return typeof next === 'string' && next.startsWith(home) && !next.startsWith('//') && !next.includes('://') ? next : home;
}
