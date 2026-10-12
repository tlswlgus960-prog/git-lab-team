<script setup lang="ts">
// C9 셸 헤더(T039, SD_02 §3-4·§2-1). 보호자 앱(가족 표시)과 운영 화면(역할·계정 가림)을 나눈다.
// 운영 헤더에는 보호자 앱 링크가 없고, 역할에 없는 메뉴는 그리지 않는다(역할별 메뉴 표, UX8).
import { RouterLink, useRoute } from 'vue-router';
import { ko } from '@/copy/ko';

export interface MenuItem { to: string; label: string }
defineProps<{ shell: 'app' | 'ops'; account?: string; roles?: string[]; menu: MenuItem[] }>();
const emit = defineEmits<{ logout: [] }>();
const route = useRoute();
// 셸 첫 메뉴(/app·/ops)는 하위 경로 전체에 켜지면 다른 메뉴와 겹쳐 보인다 — /app(미술관)은 그 화면만, 작품 화면(/app/artworks/*)은 "작품 관리"에 둔다
const active = (to: string) => (to === '/app' ? route.path === '/app' || route.path === '/app/hall' // 전시실(/app/hall)도 미술관 아래(SD_02 §17-4)
  : to === '/app/works' ? route.path === '/app/works' || route.path.startsWith('/app/artworks') // 작품 화면은 작품 관리 아래
  : route.path === to || route.path.startsWith(`${to}/`));
</script>

<template>
  <header class="topnav" :data-shell="shell">
    <div class="container">
      <span class="wordmark">{{ shell === 'app' ? ko.shell.appName : ko.shell.opsName }}</span>
      <nav class="navlinks shell-menu" :aria-label="shell === 'app' ? '보호자 메뉴' : '운영 메뉴'">
        <RouterLink v-for="m in menu" :key="m.to" :to="m.to" :class="{ 'is-active': active(m.to) }" :aria-current="active(m.to) ? 'page' : undefined" active-class="" exact-active-class="">{{ m.label }}</RouterLink>
      </nav>
      <div class="nav-cta">
        <span v-if="shell === 'ops' && roles?.length" class="t-body-sm">역할: {{ roles.map((r) => ko.shell.role[r] ?? r).join(' · ') }}</span>
        <!-- 보호자 셸: 계정 표시를 누르면 S0c 계정(비밀번호 변경, T161). 운영 셸은 표시만 -->
        <RouterLink v-if="account && shell === 'app'" class="t-body-sm account-link" to="/app/account" :title="ko.auth.myAccount"
          :aria-label="`${ko.auth.myAccount} - ${account}`">{{ account }}</RouterLink>
        <span v-else-if="account" class="t-body-sm">{{ account }}</span>
        <button class="btn btn-secondary" type="button" @click="emit('logout')">{{ ko.auth.logout }}</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.account-link{text-decoration:underline;text-underline-offset:4px}
</style>
