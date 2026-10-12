<script setup lang="ts">
// S0b 재설정(T053, UC14 BF4~6·E2·E3, G27). /app/reset?token= — 성공(204)이면 모든 세션이 끊기고 로그인 화면에 "이메일과 새 비밀번호로 로그인해 주세요".
// 링크 무효(400 token_invalid)는 G27 블록 → 찾기부터 다시. 규칙 위반(422)은 칸 안내(토큰은 아직 유효, UC14 E3).
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import { useSession } from '@/stores/session';
import PublicHeader from '../components/PublicHeader.vue';
import { fieldHints, passwordProblems } from '../authForm';

const route = useRoute();
const router = useRouter();
const session = useSession();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const password = ref('');
const confirm = ref('');
const touched = ref({ password: false, confirm: false });
const server = ref<Record<string, string>>({});
const busy = ref(false);
const block = ref<Notice | null>(null);

const errs = computed(() => passwordProblems(password.value, confirm.value));
const firstErr = computed(() => errs.value.password || errs.value.confirm);
const hint = (k: 'password' | 'confirm') => server.value[k] || (touched.value[k] ? errs.value[k] : '');
const tokenBlock = (): Notice => toBlock(new ApiError(400, { type: 'about:blank', title: 'token_invalid', status: 400, code: 'token_invalid', reason: 'token_invalid', gate: 'G27' }));
if (!token) block.value = tokenBlock();

async function save() {
  touched.value = { password: true, confirm: true };
  if (firstErr.value || busy.value || !token) return;
  busy.value = true; block.value = null; server.value = {};
  try {
    await api.post('/v1/auth/recovery/reset', { body: { token, password: password.value, passwordConfirm: confirm.value }, noRedirect: true });
    session.reset();
    await router.replace({ path: '/app/login', query: { reset: '1' } });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, null);
    if (err.status === 422) server.value = fieldHints(err);
    block.value = toBlock(err);
  } finally { busy.value = false; }
}

async function onAction() {
  if (block.value?.gate === 'G27') await router.push('/app/recovery');
}
</script>

<template>
  <PublicHeader link="login" />
  <main class="container page stack">
    <form class="card stack auth-form" novalidate @submit.prevent="save">
      <h1 class="t-headline">{{ ko.auth.resetTitle }}</h1>
      <div class="field">
        <label for="rs-pw">{{ ko.auth.newPassword }}</label>
        <input id="rs-pw" v-model="password" class="input" :class="{ 'is-error': hint('password') }" type="password" autocomplete="new-password"
          :aria-invalid="hint('password') ? 'true' : undefined" aria-describedby="rs-pw-h" @blur="touched.password = true">
        <p id="rs-pw-h" class="hint">{{ hint('password') }}</p>
      </div>
      <div class="field">
        <label for="rs-pw2">{{ ko.auth.newPasswordConfirm }}</label>
        <input id="rs-pw2" v-model="confirm" class="input" :class="{ 'is-error': hint('confirm') }" type="password" autocomplete="new-password"
          :aria-invalid="hint('confirm') ? 'true' : undefined" aria-describedby="rs-pw2-h" @blur="touched.confirm = true">
        <p id="rs-pw2-h" class="hint">{{ hint('confirm') }}</p>
      </div>
      <BlockNotice v-if="block" :notice="block" @action="onAction" />
      <div><ReasonButton :label="ko.auth.save" :disabled="!!firstErr || busy || !token" :reason="firstErr || (!token ? block?.reason : '')" type="submit" @blocked="touched = { password: true, confirm: true }" /></div>
    </form>
  </main>
</template>

<style scoped>
.auth-form{max-width:560px}
</style>
