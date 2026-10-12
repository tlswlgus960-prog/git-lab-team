<script setup lang="ts">
// S0o 팀원 로그인(T055, SD_02 §4-5 D21·D22, INC2, G1). POST /v1/ops/auth/login → GET /v1/ops/me.
// 보호자 로그인(S0a)과 모양은 같고 부르는 API·쿠키(uam_ops_sid)·갈 곳만 다르다. 보호자 화면으로 가는 링크·가입 링크는 없다(UX8).
// 팀원 계정은 운영 CLI로만 만든다(npm run ops:staff) — 가입·찾기 링크를 두지 않는다.
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import { safeNext } from '@/router/menu';
import { useSession } from '@/stores/session';
import { emailProblem } from '@/app/authForm';

const route = useRoute();
const router = useRouter();
const session = useSession();
const email = ref('');
const password = ref('');
const busy = ref(false);
const block = ref<Notice | null>(null);
const emailEl = ref<HTMLInputElement | null>(null);

const reason = computed(() => emailProblem(email.value) || (password.value ? '' : ko.auth.needPassword));

async function submit() {
  if (reason.value || busy.value) return;
  busy.value = true; block.value = null;
  try {
    await api.post('/v1/ops/auth/login', { body: { email: email.value.trim(), password: password.value }, noRedirect: true });
    await session.loadStaff(true);
    await router.replace(safeNext(route.query.next, 'ops'));
  } catch (e) {
    block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null));
    password.value = '';
  } finally { busy.value = false; }
}
function onAction() { emailEl.value?.focus(); }
</script>

<template>
  <header class="topnav" data-shell="ops">
    <div class="container"><span class="wordmark">{{ ko.shell.opsName }}</span></div>
  </header>
  <main class="container page stack">
    <form class="card stack auth-form" novalidate @submit.prevent="submit">
      <h1 class="t-headline">{{ ko.auth.opsLoginTitle }}</h1>
      <div class="field">
        <label for="ol-email">{{ ko.auth.email }}</label>
        <input id="ol-email" ref="emailEl" v-model="email" class="input" type="email" autocomplete="username">
      </div>
      <div class="field">
        <label for="ol-pw">{{ ko.auth.password }}</label>
        <input id="ol-pw" v-model="password" class="input" type="password" autocomplete="current-password">
      </div>
      <BlockNotice v-if="block" :notice="block" @action="onAction" />
      <div>
        <ReasonButton :label="ko.auth.login" :disabled="!!reason || busy" :reason="reason" type="submit" />
      </div>
    </form>
  </main>
</template>

<style scoped>
.auth-form{max-width:560px}
</style>
