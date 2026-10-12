<script setup lang="ts">
import { ko } from '@/copy/ko';
// 보호자 셸(T040, C9). 운영 화면으로 가는 링크가 없다(UX8).
import { computed } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import MuseumBar from '@/components/MuseumBar.vue';
import MuseumRoom from '@/components/MuseumRoom.vue';
import { APP_MENU } from '@/router/menu';
import { useSession } from '@/stores/session';

const s = useSession();
const router = useRouter();
const route = useRoute();
/** 미술관 화면에서는 메뉴를 한 버튼으로 접는다(D34 ④ · SD_02 §17-8) */
const inMuseum = computed(() => ['/app', '/app/list', '/app/hall'].includes(route.path) || ['/app/town', '/app/corridor'].includes(route.path) || route.path.startsWith('/app/museum/')); // D40·D43 미술관 · 마을은 방 틀 없이
/** 미술관 밖 보호자 화면은 방으로(D38, SD_02 §17-11) */
const room = computed(() => {
  const p = route.path;
  if (p === '/app/upload') return 'upload';
  if (p === '/app/works') return 'works';
  if (/\/story$/.test(p)) return 'desk';
  if (p.startsWith('/app/artworks/')) return 'bench';
  return 'info';
});
/** 계정 표시: 이메일, 카카오 로그인이면 "카카오 계정"(D36) */
const account = computed(() => s.guardian?.emailMasked ?? (s.guardian?.loginMethod === 'kakao' ? ko.kakao.account : undefined));
async function logout() { await s.logoutGuardian(); await router.push('/app/login'); }
</script>

<template>
  <!-- D38: 보호자 화면 전체에 미술관 셸, 미술관 밖은 방 안에서 -->
  <MuseumBar :account="account" :menu="APP_MENU" @logout="logout" />
  <RouterView v-if="inMuseum" />
  <MuseumRoom v-else :kind="room" class="in-room"><RouterView /></MuseumRoom>
</template>
