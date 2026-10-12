// 세션 상태(T040). 보호자는 GET /v1/me, 팀원은 GET /v1/ops/me(D21)로 새로고침 뒤에도 복원한다. 가족 ID는 받지 않는다.
import { defineStore } from 'pinia';
import { api } from '@/api/client';
import type { components } from '@/api/types.gen';

export type StaffRole = components['schemas']['StaffRole'];
export interface GuardianMe { emailMasked?: string | null; loginMethod?: 'kakao' | 'email'; hasFamily: boolean; role?: 'owner' | 'co' | null }
export interface StaffMe { emailMasked: string; roles: StaffRole[] }

export const useSession = defineStore('session', {
  state: () => ({ guardian: null as GuardianMe | null, staff: null as StaffMe | null }),
  actions: {
    async loadGuardian(force = false) {
      if (!this.guardian || force) this.guardian = await api.get<GuardianMe>('/v1/me', { noRedirect: true });
      return this.guardian;
    },
    async loadStaff(force = false) {
      if (!this.staff || force) this.staff = await api.get<StaffMe>('/v1/ops/me', { noRedirect: true });
      return this.staff;
    },
    async logoutGuardian() { await api.post('/v1/auth/logout', { noRedirect: true }).catch(() => undefined); this.guardian = null; },
    async logoutStaff() { await api.post('/v1/ops/auth/logout', { noRedirect: true }).catch(() => undefined); this.staff = null; },
    reset() { this.guardian = null; this.staff = null; },
  },
});
