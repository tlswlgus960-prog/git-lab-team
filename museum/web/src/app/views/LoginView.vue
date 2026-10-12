<script setup lang="ts">
// S0a 보호자 로그인(T053, SD_02 §4-5 D21·D22 ③). POST /v1/auth/login → GET /v1/me.
// 성공: ?next(같은 셸 상대 경로만) → 가족 없음이면 S1d → 그 밖에는 S4. 불일치는 한 문구(가입 여부 비노출).
// 2026-09-30 D36(SD_02 §17-7): 크게 [카카오로 시작하기](키 없으면 "준비 중이에요" 비활성), 아래 작게 "이메일로 로그인(기존 회원)".
// D53(SD_02 §17-19): 입장 화면과 같은 배경(GameStage) 위 "입장권" 패널 — 카카오 노랑 큰 버튼, 이메일 로그인은 작게 · 같은 패널 안.
// 카카오 취소·실패는 ?kakao=cancelled|failed 안내. 메일 관련 문구(확인·다시 받기·찾기)는 보이지 않는다 — 메일을 보내지 않는다.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import GameStage from '@/components/GameStage.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import { safeNext } from '@/router/menu';
import { home as hc, neighbor as nbc } from '@/app/town/copy';
import { markEntered } from '../entrance';
import { useSession } from '@/stores/session';
import NoticeBlock from '../components/NoticeBlock.vue';
import { emailProblem } from '../authForm';

const route = useRoute();
const router = useRouter();
/** 친구 링크로 왔는가(§17-16) — 초대 안내 한 줄 + 미술관 배경 */
// 로그인 화면을 거쳐 왔으면 입장 화면을 다시 보이지 않는다(D53 ④, 외부 피드백 4차 ②) — 로그인 뒤 바로 내 미술관
markEntered();
const fromFriend = typeof route.query.next === 'string' && route.query.next.startsWith('/app/neighbor');
const session = useSession();
const email = ref('');
const password = ref('');
const busy = ref(false);
const block = ref<Notice | null>(null);
const resent = ref(false);
const emailEl = ref<HTMLInputElement | null>(null);
const resetDone = route.query.reset === '1';
const kakaoOn = ref<boolean | null>(null);
const showEmail = ref(false);
const kakaoNote = route.query.kakao === 'cancelled' ? ko.kakao.cancelled : route.query.kakao === 'failed' ? ko.kakao.failed : '';
onMounted(async () => {
  try { kakaoOn.value = (await api.get<{ kakao: boolean }>('/v1/auth/providers', { noRedirect: true })).kakao; } catch { kakaoOn.value = false; }
});
// D47: 로그인 전에 연 주소(이웃 링크 등)는 카카오를 다녀와도 그대로 — next를 넘긴다(safeNext, 기본 /app이면 넘기지 않음)
function startKakao() {
  if (!kakaoOn.value) return;
  const next = safeNext(route.query.next, 'app');
  window.location.assign(next === '/app' ? '/v1/auth/kakao/start' : `/v1/auth/kakao/start?next=${encodeURIComponent(next)}`);
}
// 초대 링크(S1c)로 왔는데 계정이 없으면 초대받은 이메일로 가입(UC15 A4) — next의 token을 가입에 넘긴다
const inviteToken = computed(() => {
  const n = typeof route.query.next === 'string' ? route.query.next : '';
  return n.startsWith('/app/invite') ? new URLSearchParams(n.split('?')[1] ?? '').get('token') : null;
});

const reason = computed(() => emailProblem(email.value) || (password.value ? '' : ko.auth.needPassword));

async function submit() {
  if (reason.value || busy.value) return;
  busy.value = true; block.value = null; resent.value = false;
  try {
    await api.post('/v1/auth/login', { body: { email: email.value.trim(), password: password.value }, noRedirect: true });
    const me = await session.loadGuardian(true);
    const next = safeNext(route.query.next, 'app');
    // 초대 수락(S1c)은 가족이 없어도 간다. 그 밖에는 가족이 없으면 S1d
    await router.replace(!me.hasFamily && !next.startsWith('/app/invite') ? '/app/no-family' : next);
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, null);
    if (err.status === 409 && err.reason === 'no_family') { await router.replace('/app/no-family'); return; }
    // 불일치 블록은 SD_02 S0a 와이어프레임대로 "막힘 G0"(API는 gate 없이 보낸다) — 메일 확인 G27 블록과 표기를 맞춘다
    const b = toBlock(err);
    // 메일을 보내지 않으므로(D36) 확인 전 계정에 "메일 다시 받기"를 주지 않는다
    block.value = err.reason === 'email_unverified' ? { ...b, reason: ko.kakao.unverified, actions: [] }
      : { ...b, gate: err.gate ?? (err.reason === 'bad_credentials' ? 'G0' : null), actions: b.actions.filter((a) => a !== ko.auth.forgot && a !== ko.auth.resendVerify) };
    password.value = '';
  } finally { busy.value = false; }
}

async function onAction(label: string) {
  if (label === ko.auth.forgot) { await router.push('/app/recovery'); return; }
  if (label === ko.auth.resendVerify) {
    await api.post('/v1/auth/email/verify/resend', { body: { email: email.value.trim() }, noRedirect: true }).catch(() => undefined);
    block.value = null; resent.value = true; return;
  }
  emailEl.value?.focus();
}
</script>

<template>
  <GameStage>
    <header class="lg-top"><RouterLink class="lg-mark" to="/app/login">{{ ko.shell.appName }}</RouterLink></header>
    <main class="lg" :class="{ 'from-friend': fromFriend }">
      <p v-if="fromFriend" class="g-note friend-note" role="status">{{ nbc.loginNote }}</p>
      <NoticeBlock v-if="resetDone" :title="ko.auth.resetDone" />
      <!-- 입장권: 크림 양피지 + 금테 두 줄, 위에 절취선 장식 -->
      <section class="g-panel ticket" aria-labelledby="li-h">
        <p class="stub" aria-hidden="true"><span>{{ hc.ticket }}</span></p>
        <h1 id="li-h" class="g-title">{{ ko.auth.loginTitle }}</h1>
        <span class="g-rule" aria-hidden="true" />
        <p v-if="kakaoNote" class="kakao-note" role="status">{{ kakaoNote }}</p>
        <ReasonButton class="g-btn g-btn--kakao g-btn--big kakao-btn" :label="ko.kakao.start" :disabled="!kakaoOn" :reason="kakaoOn === false ? ko.kakao.preparing : ''" @click="startKakao" />
        <p v-if="kakaoOn" class="ticket-hint">{{ hc.ticketHint }}</p>
        <button class="g-link email-toggle" type="button" :aria-expanded="showEmail" aria-controls="li-form" @click="showEmail = !showEmail">{{ ko.kakao.emailLogin }}</button>
        <form v-if="showEmail" id="li-form" class="li-form" novalidate @submit.prevent="submit">
          <div class="field">
            <label for="li-email">{{ ko.auth.email }}</label>
            <input id="li-email" ref="emailEl" v-model="email" class="input" type="email" autocomplete="username">
          </div>
          <div class="field">
            <label for="li-pw">{{ ko.auth.password }}</label>
            <input id="li-pw" v-model="password" class="input" type="password" autocomplete="current-password">
          </div>
          <BlockNotice v-if="block" :notice="block" @action="onAction" />
          <ReasonButton class="g-btn g-btn--primary li-go" :label="ko.auth.login" :disabled="!!reason || busy" :reason="reason" type="submit" />
        </form>
      </section>
    </main>
  </GameStage>
</template>

<style scoped>
/* 위 줄: 로그인 전 화면은 로고만(§17-19) */
.lg-top{position:absolute;left:0;right:0;top:0;padding:14px clamp(16px,2.5vw,32px);z-index:2}
.lg-mark{display:inline-flex;align-items:center;min-height:44px;padding:6px 16px;border-radius:999px;background:rgba(255,250,240,.85);border:1.5px solid var(--g-gold);
  font:700 17px/1 var(--g-serif);color:#6e3550;text-decoration:none}
.lg{width:100%;max-width:480px;display:grid;gap:14px;padding-top:44px}
.ticket{position:relative;display:grid;gap:14px;justify-items:center;padding:34px clamp(18px,5vw,36px) 26px;text-align:center}
/* 입장권 머리: 금빛 리본 */
.stub{position:absolute;left:50%;top:-16px;transform:translateX(-50%);margin:0}
.stub span{display:inline-block;padding:6px 22px;border-radius:999px;background:linear-gradient(#f3dd9c,#d7b465);border:1.5px solid #b08a34;
  font:700 14px/1 var(--g-serif);letter-spacing:.3em;color:#3a2a12;box-shadow:0 3px 0 rgba(176,138,52,.45)}
.ticket .g-title{font-size:clamp(26px,4vw,32px)}
.g-btn.kakao-btn{width:100%}
.ticket-hint{margin:-6px 0 0;font:500 14px/1.4 var(--font-sans);color:#6d5d4e}
.kakao-note{margin:0;font:600 16px/1.45 var(--font-sans)}
.email-toggle{font-size:14px}
.li-form{width:100%;display:grid;gap:14px;text-align:left;padding-top:14px;border-top:1px dashed var(--g-gold)}
.li-go{justify-self:stretch}
.friend-note{text-align:center}
</style>
