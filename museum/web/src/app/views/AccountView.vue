<script setup lang="ts">
// S0c 계정 - 비밀번호 변경(T161, UC14 A5, D24, SD_02 §4-5 S0c). 로그인한 보호자가 메일 없이 바꾼다.
// POST /v1/auth/password 204 → 이 기기는 로그인 유지(새 세션 쿠키), 다른 기기는 모두 끊긴다. 규칙은 재설정(S0b)과 같다.
// 현재 비밀번호가 틀리면 422 current_password_mismatch → C2 블록, 여러 번 틀리면 429 login_attempts 보류 블록.
// 배치·들어가는 자리는 디자인(신지현) 확인 대상 — 지금은 보호자 셸 헤더의 계정 표시에서 연다.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import NoticeBlock from '../components/NoticeBlock.vue';
import { fieldHints, passwordProblems } from '../authForm';

const router = useRouter();
const current = ref('');
const password = ref('');
const confirm = ref('');
const touched = ref({ password: false, confirm: false });
const server = ref<Record<string, string>>({});
const busy = ref(false);
const done = ref(false);
const block = ref<Notice | null>(null);
const currentEl = ref<HTMLInputElement | null>(null);

const errs = computed(() => passwordProblems(password.value, confirm.value));
const firstErr = computed(() => (!current.value ? ko.auth.needCurrent : errs.value.password || errs.value.confirm));
const hint = (k: 'password' | 'confirm') => server.value[k] || (touched.value[k] ? errs.value[k] : '');

async function save() {
  touched.value = { password: true, confirm: true };
  if (firstErr.value || busy.value) return;
  busy.value = true; block.value = null; server.value = {}; done.value = false;
  try {
    await api.post('/v1/auth/password', { body: { currentPassword: current.value, password: password.value, passwordConfirm: confirm.value } });
    current.value = ''; password.value = ''; confirm.value = ''; touched.value = { password: false, confirm: false };
    done.value = true;
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, null);
    if (err.status === 422 && err.reason !== 'current_password_mismatch') server.value = fieldHints(err);
    if (err.reason === 'current_password_mismatch') current.value = '';
    block.value = toBlock(err);
  } finally { busy.value = false; }
}

async function onAction(label: string) {
  if (label === ko.auth.forgot) await router.push('/app/recovery');
  else currentEl.value?.focus();
}
</script>

<template>
  <main class="container page stack">
    <NoticeBlock v-if="done" :title="ko.auth.pwChanged" />
    <form class="card stack auth-form" novalidate @submit.prevent="save">
      <h1 class="t-headline">{{ ko.auth.changePwTitle }}</h1>
      <div class="field">
        <label for="ac-cur">{{ ko.auth.currentPassword }}</label>
        <input id="ac-cur" ref="currentEl" v-model="current" class="input" type="password" autocomplete="current-password">
      </div>
      <div class="field">
        <label for="ac-pw">{{ ko.auth.newPassword }}</label>
        <input id="ac-pw" v-model="password" class="input" :class="{ 'is-error': hint('password') }" type="password" autocomplete="new-password"
          :aria-invalid="hint('password') ? 'true' : undefined" aria-describedby="ac-pw-h" @blur="touched.password = true">
        <p id="ac-pw-h" class="hint">{{ hint('password') }}</p>
      </div>
      <div class="field">
        <label for="ac-pw2">{{ ko.auth.newPasswordConfirm }}</label>
        <input id="ac-pw2" v-model="confirm" class="input" :class="{ 'is-error': hint('confirm') }" type="password" autocomplete="new-password"
          :aria-invalid="hint('confirm') ? 'true' : undefined" aria-describedby="ac-pw2-h" @blur="touched.confirm = true">
        <p id="ac-pw2-h" class="hint">{{ hint('confirm') }}</p>
      </div>
      <BlockNotice v-if="block" :notice="block" @action="onAction" />
      <div><ReasonButton :label="ko.auth.changePw" :disabled="!!firstErr || busy" :reason="firstErr || (busy ? ko.upload.sending : '')" type="submit"
        @blocked="touched = { password: true, confirm: true }" /></div>
    </form>
  </main>
</template>

<style scoped>
.auth-form{max-width:560px}
</style>
