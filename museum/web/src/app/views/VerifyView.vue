<script setup lang="ts">
// S0 메일 확인 링크(T052, UC13 BF5~6·E7, G27). /app/verify?token= — 성공(204)이면 세션을 받고 S1로 가서 "이제 아이를 등록해 주세요".
// 만료·사용·무효는 구분 없이 400 token_invalid → G27 블록. [메일 다시 받기]는 가입한 이메일 칸과 재발송을 보인다([추론], C_화면문구 §4).
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import JourneyRail from '@/components/JourneyRail.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import { useSession } from '@/stores/session';
import PublicHeader from '../components/PublicHeader.vue';
import NoticeBlock from '../components/NoticeBlock.vue';
import { emailProblem, JOURNEY } from '../authForm';

const route = useRoute();
const router = useRouter();
const session = useSession();
const block = ref<Notice | null>(null);
const asking = ref(false);
const sent = ref(false);
const email = ref('');
const emailErr = computed(() => emailProblem(email.value));

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';
  try {
    if (!token) throw new ApiError(400, { type: 'about:blank', title: 'token_invalid', status: 400, code: 'token_invalid', reason: 'token_invalid', gate: 'G27' });
    await api.post('/v1/auth/email/verify', { body: { token }, noRedirect: true });
    await session.loadGuardian(true).catch(() => undefined);
    await router.replace({ path: '/app/children', query: { verified: '1' } });
  } catch (e) {
    block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null));
  }
});

async function resend() {
  if (emailErr.value) return;
  await api.post('/v1/auth/email/verify/resend', { body: { email: email.value.trim() }, noRedirect: true }).catch(() => undefined);
  sent.value = true;
}
</script>

<template>
  <PublicHeader link="login" />
  <main class="container page stack">
    <JourneyRail current="verify" :steps="JOURNEY" :variant="block ? 'blocked' : 'default'" :gate="block?.gate" />
    <p v-if="!block" class="t-body" role="status">{{ ko.auth.verifying }}</p>
    <template v-else-if="!sent">
      <BlockNotice :notice="block" @action="asking = true" />
      <form v-if="asking" class="card stack verify-resend" novalidate @submit.prevent="resend">
        <div class="field">
          <label for="vf-email">{{ ko.auth.recoveryEmail }}</label>
          <input id="vf-email" v-model="email" class="input" type="email" autocomplete="email" aria-describedby="vf-email-h">
          <p id="vf-email-h" class="hint">{{ email ? emailErr : '' }}</p>
        </div>
        <div><ReasonButton :label="ko.auth.resendVerify" :disabled="!!emailErr" :reason="emailErr" @click="resend" /></div>
      </form>
    </template>
    <NoticeBlock v-else :title="ko.auth.checkMailbox">
      <p>{{ ko.auth.checkMailboxBody }}</p>
      <p>{{ ko.auth.mailboxHint }}</p>
      <template #actions><RouterLink class="btn btn-secondary" to="/app/login">{{ ko.auth.toLogin }}</RouterLink></template>
    </NoticeBlock>
  </main>
</template>

<style scoped>
.verify-resend{max-width:560px}
</style>
