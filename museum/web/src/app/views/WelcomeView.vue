<script setup lang="ts">
// S0w 입장 = 게임 타이틀 화면(D53, SD_02 §17-19). 공통 틀 GameStage(밝은 하늘 · 광장 · 먼 고전 외관) 앞에 큰 세리프 로고
// "우리 아이 미술관" · 태그라인 한 줄 · [시작하기](주 버튼) · [견본 미술관 둘러보기](D48 ①). 외부 이미지 없음.
// 동작은 그대로(§17-2 · D47 §17-16): 로그인했으면 [시작하기] → next(없으면 홈 /app = 아이 미술관), 아니면 로그인(next 유지).
// 들어오면 주 버튼에 초점. 움직임 줄이기면 로고가 떠오르는 장면 없이 바로.
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GameStage from '@/components/GameStage.vue';
import { ko } from '@/copy/ko';
import { markEntered } from '../entrance';
import { safeNext } from '@/router/menu';
import { useSession } from '@/stores/session';
import { home as hc } from '@/app/town/copy';

const route = useRoute();
const router = useRouter();
const btn = ref<HTMLButtonElement | null>(null);
onMounted(() => btn.value?.focus());
const s = useSession();
async function enter() {
  markEntered();
  const signedIn = await s.loadGuardian(true).then(() => true, () => false);
  if (signedIn) { await router.replace(safeNext(route.query.next, 'app')); return; }
  await router.replace({ path: '/app/login', query: typeof route.query.next === 'string' ? { next: route.query.next } : {} });
}
</script>

<template>
  <GameStage>
    <main class="wel">
      <div class="sign">
        <p class="eyebrow">{{ ko.museum.tagline }}</p>
        <h1 class="g-title logo">{{ ko.museum.name }}</h1>
        <span class="g-rule" aria-hidden="true" />
      </div>
      <div class="door">
        <p class="intro">{{ ko.museum.intro1 }}</p>
        <button ref="btn" class="g-btn g-btn--primary g-btn--big enter" type="button" @click="enter">{{ hc.start }}</button>
        <!-- D48 ①: 로그인 없이 걸어 보는 견본 미술관 -->
        <RouterLink class="g-btn sample" to="/app/sample">{{ hc.sampleTour }}</RouterLink>
      </div>
    </main>
  </GameStage>
</template>

<style scoped>
.wel{flex:1;width:100%;max-width:1100px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:24px;text-align:center;word-break:keep-all}
.sign{display:grid;justify-items:center;gap:10px;padding-top:clamp(8px,4vh,48px)}
.eyebrow{margin:0;font:700 clamp(16px,1.6vw,20px)/1.3 var(--g-serif);color:var(--g-plum-deep);letter-spacing:.08em}
/* 큰 세리프 로고: 자두색 글자 + 크림 빛 테두리(하늘 · 외관 위에서도 또렷하게) */
.logo{font-size:clamp(44px,7.4vw,108px);line-height:1.02;letter-spacing:-.02em;color:#6e3550;
  text-shadow:0 2px 0 #fff8ea,0 0 18px rgba(255,250,238,.95),0 0 42px rgba(255,250,238,.9),0 6px 0 rgba(201,162,74,.45)}
.intro{margin:0 0 4px;max-width:30em;padding:6px 16px;border-radius:999px;background:rgba(255,250,240,.78);font:600 clamp(15px,1.4vw,18px)/1.5 var(--font-sans);color:var(--g-ink)}
.door{display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;padding-bottom:clamp(8px,4vh,40px)}
.wel .g-btn.enter{min-width:min(320px,100%);font-size:22px;letter-spacing:.02em}
.g-btn.sample{min-width:min(280px,100%)}
@media (max-width:560px){.enter,.sample{width:100%;max-width:340px}}
@media (prefers-reduced-motion:no-preference){
  .sign{animation:rise .9s cubic-bezier(.2,.8,.2,1) both}
  .door{animation:rise .9s .15s cubic-bezier(.2,.8,.2,1) both}
}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
</style>
