<script setup lang="ts">
// S1c 초대 수락(T107, SD_02 §4-5, UC15 BF4~BF6·A4·E1~E3, G28). 메일 링크 /app/invite?token= — 로그인 전이면 가드가 로그인으로 보낸다(next 유지).
// 수락 전에 결과(공동 보호자·같은 권한·나갈 수 있음·1회용 7일)를 먼저 보인다. 아이 별칭·작품은 보이지 않는다.
// 이미 가족이 있으면 수락은 사유 달린 C3, 만든 보호자면 나갈 수 없다는 안내를 더한다. 거절: 400 token_invalid · 403 invite_email_mismatch · 409 already_in_family.
// 2026-09-30 D36(UC15 §0): 로그인 전에도 연다 — [카카오로 시작하기]가 초대 토큰을 싣고 가서 그 가족에 들어간다. 카카오가 돌려준 ?error=는 안내로.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import { useSession } from '@/stores/session';
import AccountHeader from '../components/AccountHeader.vue';

const route = useRoute();
const router = useRouter();
const s = useSession();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const busy = ref(false);
const block = ref<Notice | null>(null);
const signedIn = ref<boolean | null>(null);
const kakaoOn = ref<boolean | null>(null);
const inviteErr = typeof route.query.error === 'string' ? (ko.kakao.inviteError[route.query.error] ?? ko.kakao.failed) : '';

onMounted(async () => {
  signedIn.value = await s.loadGuardian(true).then(() => true, () => false);
  try { kakaoOn.value = (await api.get<{ kakao: boolean }>('/v1/auth/providers', { noRedirect: true })).kakao; } catch { kakaoOn.value = false; }
});
function startKakao() { if (kakaoOn.value && token) window.location.assign(`/v1/auth/kakao/start?invite=${encodeURIComponent(token)}`); }
const hasFamily = computed(() => !!s.guardian?.hasFamily);
const why = computed(() => (hasFamily.value ? ko.family.leaveFirst : busy.value ? ko.upload.sending : ''));

async function accept() {
  if (why.value) return;
  busy.value = true; block.value = null;
  try {
    await api.post('/v1/family/invites/accept', { body: { token } });
    await s.loadGuardian(true);
    await router.replace({ path: '/app', query: { joined: '1' } });
  } catch (e) {
    block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null));
  } finally { busy.value = false; }
}
async function onBlock(label: string) {
  if (label === '로그아웃하고 다시 로그인') { await s.logoutGuardian(); await router.push({ path: '/app/login', query: { next: route.fullPath } }); }
  else if (label === '다른 가족에서 나오기') await router.push('/app/family');
}
</script>

<template>
  <AccountHeader />
  <main class="container page stack">
    <section class="card stack-sm inv">
      <h1 class="t-headline">{{ ko.family.invitedTitle }}</h1>
      <p class="t-body">{{ ko.family.invited1 }}</p>
      <p class="t-body-sm">{{ ko.family.invited2 }}</p>
      <p class="t-body-sm">{{ ko.family.invited3 }}</p>
      <p v-if="inviteErr" class="t-body" role="alert">{{ inviteErr }}</p>
      <BlockNotice v-if="block" :notice="block" @action="onBlock" />
      <template v-if="signedIn === false">
        <p class="t-body-sm">{{ ko.kakao.invitedStart }}</p>
        <div class="acts"><ReasonButton class="kakao-btn" :label="ko.kakao.start" :disabled="!kakaoOn || !token" :reason="kakaoOn === false ? ko.kakao.preparing : ''" @click="startKakao" /></div>
      </template>
      <p v-if="hasFamily && s.guardian?.role === 'owner'" class="t-body-sm">{{ ko.family.ownerCannotLeave }}</p>
      <div v-if="signedIn" class="acts">
        <ReasonButton :label="ko.family.accept" :disabled="!!why || !token" :reason="why" @click="accept" />
        <RouterLink v-if="hasFamily" class="btn btn-secondary" to="/app">{{ ko.family.toFamily }}</RouterLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.inv{max-width:640px}
.stack-sm{display:grid;gap:var(--s-sm)}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
.kakao-btn{min-height:56px;font-size:18px}
</style>
