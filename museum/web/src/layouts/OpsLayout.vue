<script setup lang="ts">
// 운영 셸(T040, C9). 메뉴는 역할별 메뉴 표대로, 보호자 앱 링크 없음(UX8).
import { computed } from 'vue';
import { RouterView, useRouter } from 'vue-router';
import RoleHeader from '@/components/RoleHeader.vue';
import { opsMenu } from '@/router/menu';
import { useSession } from '@/stores/session';

const s = useSession();
const router = useRouter();
const menu = computed(() => opsMenu(s.staff?.roles ?? []));
async function logout() { await s.logoutStaff(); await router.push('/ops/login'); }
</script>

<template>
  <RoleHeader shell="ops" :account="s.staff?.emailMasked" :roles="s.staff?.roles" :menu="menu" @logout="logout" />
  <RouterView />
</template>
