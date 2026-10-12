<script setup lang="ts">
// S0b 로그인 정보 찾기(T053, SD_02 §4-5, UC14 BF2~3, BR-ACC-08). 이메일 하나만 받고, 응답(항상 202)과 관계없이 같은 안내를 보인다.
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import PublicHeader from '../components/PublicHeader.vue';
import NoticeBlock from '../components/NoticeBlock.vue';
import { emailProblem } from '../authForm';

const email = ref('');
const touched = ref(false);
const busy = ref(false);
const sent = ref(false);
const err = computed(() => emailProblem(email.value));

async function send() {
  touched.value = true;
  if (err.value || busy.value) return;
  busy.value = true;
  // 가입 여부를 드러내지 않도록 결과와 관계없이 같은 안내(무응답도 같은 화면 — 메일이 없으면 다시 받게 안내한다)
  await api.post('/v1/auth/recovery', { body: { email: email.value.trim() }, noRedirect: true }).catch(() => undefined);
  busy.value = false;
  sent.value = false;
  queueMicrotask(() => { sent.value = true; });
}
</script>

<template>
  <PublicHeader link="login" />
  <main class="container page stack">
    <form class="card stack auth-form" novalidate @submit.prevent="send">
      <h1 class="t-headline">{{ ko.auth.recoveryTitle }}</h1>
      <div class="field">
        <label for="rc-email">{{ ko.auth.recoveryEmail }}</label>
        <input id="rc-email" v-model="email" class="input" :class="{ 'is-error': touched && err }" type="email" autocomplete="email"
          :aria-invalid="touched && err ? 'true' : undefined" aria-describedby="rc-email-h" @blur="touched = true">
        <p id="rc-email-h" class="hint">{{ (touched && err) || ko.auth.recoveryIdHint }}</p>
      </div>
      <div><ReasonButton :label="ko.auth.recoverySend" :disabled="!!err || busy" :reason="err" type="submit" @blocked="touched = true" /></div>
    </form>
    <NoticeBlock v-if="sent" :title="ko.auth.recoverySent">
      <p>{{ ko.auth.recoverySentBody }}</p>
      <p>{{ ko.auth.recoveryOnce }}</p>
      <p>{{ ko.auth.mailboxHint }}</p>
      <template #actions>
        <button class="btn btn-secondary" type="button" @click="send">{{ ko.auth.recoveryAgain }}</button>
        <RouterLink class="btn btn-secondary" to="/app/login">{{ ko.auth.toLogin }}</RouterLink>
      </template>
    </NoticeBlock>
  </main>
</template>

<style scoped>
.auth-form{max-width:560px}
</style>
