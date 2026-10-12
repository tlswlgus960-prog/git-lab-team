<script setup lang="ts">
// 가족 없이 여는 보호자 화면(S1c 초대 수락 · S1d 가족 없음)의 머리. 로그인한 계정(가림)과 로그아웃만 — 가족 메뉴가 없다(SD_02 §4-5).
// 초대받은 이메일로 로그인했는지 스스로 확인하게 계정을 보인다(UC15 E2).
import { useRouter } from 'vue-router';
import { ko } from '@/copy/ko';
import { useSession } from '@/stores/session';

const s = useSession();
const router = useRouter();
async function logout() { await s.logoutGuardian(); await router.push('/app/login'); }
</script>

<template>
  <header class="topnav" data-shell="app">
    <div class="container">
      <span class="wordmark">{{ ko.shell.appName }}</span>
      <div class="nav-cta">
        <span v-if="s.guardian?.emailMasked" class="t-body-sm">{{ s.guardian.emailMasked }}</span>
        <button class="btn btn-secondary" type="button" @click="logout">{{ ko.auth.logout }}</button>
      </div>
    </div>
  </header>
</template>
