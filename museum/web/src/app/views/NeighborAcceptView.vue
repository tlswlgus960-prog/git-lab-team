<script setup lang="ts">
// 이웃 초대 받기(D40, SD_02 §17-13 E, UC_16 BF2·BF3·A1·E1~E3): /app/neighbor?token= — 로그인 전이면 가드가 로그인으로 보낸다(next 유지).
// D53(SD_02 §17-19): 공통 틀 GameStage 위 금테 양피지 패널 · 금테 알약 버튼.
// 받기 전에 무엇이 보이는지(그림·별칭·제목만)와 언제든 끊을 수 있음을 먼저 보인다. 거절: 400 token_invalid · 409 own_family · 409 neighbor_full.
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '@/api/client';
import GameStage from '@/components/GameStage.vue';
import { neighbor as nc } from '@/app/town/copy';

const route = useRoute();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const busy = ref(false);
const done = ref(false);
const err = ref(token ? '' : nc.noToken);
/** 링크가 쓰였거나 끝났으면 다시 눌러도 소용없다 — [친구 되기] 대신 [마을로 가기](세션2 판별 A2-8) */
const dead = ref(!token);

async function accept() {
  if (busy.value || !token) return;
  busy.value = true; err.value = '';
  try {
    await api.post('/v1/neighbors/accept', { body: { token } });
    done.value = true;
  } catch (e) {
    const r = e instanceof ApiError ? e.reason : null;
    const st = e instanceof ApiError ? e.status : 0;
    // 링크 문제(400 token_invalid · 422 형식)만 "이미 쓰였거나 끝났어요", 끊김 · 서버 문제는 잠시 뒤 다시(링크는 아직 쓸 수 있다)
    err.value = r === 'own_family' ? nc.ownFamily : r === 'neighbor_full' ? nc.fullAccept
      : r === 'token_invalid' || st === 400 || st === 422 ? nc.tokenInvalid : nc.tryLater;
    dead.value = err.value === nc.tokenInvalid || err.value === nc.ownFamily || err.value === nc.fullAccept;
  } finally { busy.value = false; }
}
</script>

<template>
  <GameStage>
    <main class="nb-wrap">
      <section class="g-panel nb" aria-labelledby="nb-h">
        <span class="nb-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="48" height="48"><path d="M24 40s-14-8.4-14-18.2A7.8 7.8 0 0 1 24 17a7.8 7.8 0 0 1 14 4.8C38 31.6 24 40 24 40z" fill="#e9a3b8" stroke="#a0496b" stroke-width="2.5" stroke-linejoin="round" /></svg>
        </span>
        <h1 id="nb-h" class="g-title">{{ nc.acceptTitle }}</h1>
        <span class="g-rule" aria-hidden="true" />
        <template v-if="!done">
          <p class="lead">{{ nc.accept1 }}</p>
          <ul class="facts">
            <li>{{ nc.accept2 }}</li>
            <li>{{ nc.accept3 }}</li>
          </ul>
          <p v-if="err" class="g-note" role="alert">{{ err }}</p>
          <div class="acts">
            <button v-if="!dead" class="g-btn g-btn--primary g-btn--big" type="button" :disabled="busy" @click="accept">{{ nc.acceptGo }}</button>
            <RouterLink v-else class="g-btn g-btn--primary g-btn--big" to="/app/town">{{ nc.toTown }}</RouterLink>
          </div>
        </template>
        <template v-else>
          <p class="lead" role="status">{{ nc.accepted }}</p>
          <div class="acts"><RouterLink class="g-btn g-btn--primary g-btn--big" to="/app/town">{{ nc.toTown }}</RouterLink></div>
        </template>
      </section>
    </main>
  </GameStage>
</template>

<style scoped>
.nb-wrap{width:100%;max-width:560px}
.nb{display:grid;gap:14px;justify-items:center;padding:30px clamp(18px,5vw,40px) 28px;text-align:center}
.nb .g-title{font-size:clamp(24px,3.6vw,32px)}
.lead{margin:0;font:600 17px/1.55 var(--font-sans);word-break:keep-all}
.facts{margin:0;padding:12px 16px 12px 34px;text-align:left;display:grid;gap:6px;border-radius:14px;background:rgba(255,255,255,.55);border:1px solid rgba(201,162,74,.5);
  font:500 15px/1.5 var(--font-sans);word-break:keep-all}
.facts li::marker{color:var(--g-gold)}
.acts{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;width:100%}
@media (max-width:560px){.acts .g-btn{width:100%}}
</style>
