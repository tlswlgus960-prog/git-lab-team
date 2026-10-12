<script setup lang="ts">
// S0 가입(T052, SD_02 §4-5, UC13, G26). 이메일·비밀번호·확인만 받는다. 응답은 가입 여부와 관계없이 늘 같은 "메일함을 확인해 주세요"(결정 ④).
// 초대 링크로 온 가입(UC13 A4)은 ?invite= 토큰을 함께 보내고, 끝나면 로그인으로 보낸다.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import JourneyRail from '@/components/JourneyRail.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import PublicHeader from '../components/PublicHeader.vue';
import NoticeBlock from '../components/NoticeBlock.vue';
import { emailProblem, fieldHints, JOURNEY, passwordProblems } from '../authForm';

const route = useRoute();
const router = useRouter();
const invite = typeof route.query.invite === 'string' ? route.query.invite : undefined;

const email = ref('');
// 초대 링크로 온 가입은 초대받은 이메일을 미리 채운다(SD_02 S1c, UC15 A4) — 무효 토큰이면 빈 칸 그대로
onMounted(async () => {
  if (!invite) return;
  const r = await api.get<{ email: string }>('/v1/family/invites/lookup', { query: { token: invite }, noRedirect: true }).catch(() => null);
  if (r?.email && !email.value) email.value = r.email;
});
const password = ref('');
const confirm = ref('');
const touched = ref({ email: false, password: false, confirm: false });
const server = ref<Record<string, string>>({});
const busy = ref(false);
const sent = ref(false);
const block = ref<Notice | null>(null);
const emailEl = ref<HTMLInputElement | null>(null);

const errs = computed(() => ({ email: emailProblem(email.value), ...passwordProblems(password.value, confirm.value) }));
const firstErr = computed(() => errs.value.email || errs.value.password || errs.value.confirm);
const hint = (k: 'email' | 'password' | 'confirm') => server.value[k] || (touched.value[k] ? errs.value[k] : '');

async function submit() {
  touched.value = { email: true, password: true, confirm: true };
  if (firstErr.value || busy.value) return;
  busy.value = true; block.value = null; server.value = {};
  try {
    await api.post('/v1/auth/signup', { body: { email: email.value.trim(), password: password.value, passwordConfirm: confirm.value, ...(invite ? { inviteToken: invite } : {}) }, noRedirect: true });
    if (invite) { await router.push('/app/login'); return; }
    sent.value = true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) server.value = fieldHints(e);
    block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null));
  } finally { busy.value = false; }
}

async function resend() {
  await api.post('/v1/auth/email/verify/resend', { body: { email: email.value.trim() }, noRedirect: true }).catch(() => undefined);
  sent.value = false; // 같은 안내를 다시 그려 포커스·낭독을 되살린다
  queueMicrotask(() => { sent.value = true; });
}

function onBlockAction() { emailEl.value?.focus(); }
</script>

<template>
  <PublicHeader link="login" />
  <main class="container page stack">
    <JourneyRail :current="sent ? 'verify' : 'signup'" :steps="JOURNEY" />
    <NoticeBlock v-if="sent" :title="ko.auth.checkMailbox">
      <p>{{ ko.auth.checkMailboxBody }}</p>
      <p>{{ ko.auth.mailboxHint }}</p>
      <template #actions>
        <button class="btn btn-secondary" type="button" @click="resend">{{ ko.auth.resendVerify }}</button>
        <RouterLink class="btn btn-secondary" to="/app/login">{{ ko.auth.haveAccount }}</RouterLink>
      </template>
    </NoticeBlock>
    <form v-else class="card stack auth-form" novalidate @submit.prevent="submit">
      <h1 class="t-headline">{{ ko.auth.signupTitle }}</h1>
      <p class="t-body-sm">{{ ko.auth.signupLead }}</p>
      <div class="field">
        <label for="su-email">{{ ko.auth.email }}</label>
        <input id="su-email" ref="emailEl" v-model="email" class="input" :class="{ 'is-error': hint('email') }" type="email" autocomplete="email"
          :aria-invalid="hint('email') ? 'true' : undefined" aria-describedby="su-email-h" @blur="touched.email = true">
        <p id="su-email-h" class="hint">{{ hint('email') || ko.auth.emailIsId }}</p>
      </div>
      <div class="field">
        <label for="su-pw">{{ ko.auth.password }}</label>
        <input id="su-pw" v-model="password" class="input" :class="{ 'is-error': hint('password') }" type="password" autocomplete="new-password"
          :aria-invalid="hint('password') ? 'true' : undefined" aria-describedby="su-pw-h" @blur="touched.password = true">
        <p id="su-pw-h" class="hint">{{ hint('password') }}</p>
      </div>
      <div class="field">
        <label for="su-pw2">{{ ko.auth.passwordConfirm }}</label>
        <input id="su-pw2" v-model="confirm" class="input" :class="{ 'is-error': hint('confirm') }" type="password" autocomplete="new-password"
          :aria-invalid="hint('confirm') ? 'true' : undefined" aria-describedby="su-pw2-h" @blur="touched.confirm = true">
        <p id="su-pw2-h" class="hint">{{ hint('confirm') }}</p>
      </div>
      <p class="t-body-sm">{{ ko.auth.notCollected }}</p>
      <BlockNotice v-if="block" :notice="block" @action="onBlockAction" />
      <div>
        <ReasonButton :label="ko.auth.signup" :disabled="!!firstErr || busy" :reason="firstErr" type="submit" @blocked="touched = { email: true, password: true, confirm: true }" />
      </div>
    </form>
  </main>
</template>

<style scoped>
.auth-form{max-width:560px}
</style>
