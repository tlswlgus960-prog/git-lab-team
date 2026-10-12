<script setup lang="ts">
// G1 — 역할 없는 운영 화면을 주소로 열었을 때(SD_02 §16 G1).
import { useRouter } from 'vue-router';
import BlockNotice from '@/components/BlockNotice.vue';
import { problemCopy } from '@/copy/ko';
import { useSession } from '@/stores/session';

const router = useRouter();
const s = useSession();
const notice = { ...problemCopy({ gate: 'G1', reason: 'role_missing' }), gate: 'G1', fields: [] };
async function onAction() { await s.logoutStaff(); await router.push('/ops/login'); }
</script>

<template>
  <main class="container page"><BlockNotice :notice="notice" @action="onAction" /></main>
</template>
