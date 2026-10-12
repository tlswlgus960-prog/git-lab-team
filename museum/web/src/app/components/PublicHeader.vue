<script setup lang="ts">
// 로그인 전 화면(S0·S0a·S0b)의 머리(SD_02 S0 와이어프레임: 서비스 이름 + 로그인 또는 가입하기). 운영 화면 링크는 없다(UX8).
import { RouterLink } from 'vue-router';
import { ko } from '@/copy/ko';

defineProps<{ link: 'login' | 'signup' }>();
</script>

<template>
  <header class="topnav">
    <div class="container">
      <RouterLink class="wordmark" to="/app/login">{{ ko.shell.appName }}</RouterLink>
      <div class="nav-cta">
        <RouterLink v-if="link === 'login'" class="btn btn-secondary" to="/app/login">{{ ko.auth.login }}</RouterLink>
        <RouterLink v-else class="btn btn-secondary" to="/app/signup">{{ ko.auth.signup }}</RouterLink>
      </div>
    </div>
  </header>
</template>
