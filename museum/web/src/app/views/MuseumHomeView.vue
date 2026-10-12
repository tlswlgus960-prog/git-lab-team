<script setup lang="ts">
// 홈 /app = 아이 미술관(D43, SD_02 §17-13 G): 아이 1명 → 바로 그 미술관 · 여럿 → 캐릭터 카드로 고르기(고른 아이는 이 브라우저에 기억해 다음엔 바로) · 0명 → 캐릭터 만들기.
// D53(SD_02 §17-19): 공통 틀 GameStage 위 — 고르기 카드 = 금테 양피지 패널, 버튼 = 금테 크림 알약.
// ?pick=1이면 기억한 아이가 있어도 고르기를 보인다([다른 아이 미술관]).
// 올리기 끝(D34 · D44): /app?child={id}&hung={artworkId} → 그 아이 미술관으로 hung을 그대로 넘겨 거는 장면을 재생한다.
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import GameStage from '@/components/GameStage.vue';
import CharacterAvatar from '@/app/character/CharacterAvatar.vue';
import MuseumBuilding from '@/app/character/MuseumBuilding.vue';
import { DEFAULT_COLOR, DEFAULT_KIND, DEFAULT_STYLE, isColor, isKind, isStyle } from '@/app/character/names';
import { home as hc } from '@/app/town/copy';
import { lastChild, rememberChild } from '@/app/town/lastChild';

interface Child { id: string; alias: string; character?: string | null; color?: string | null; museumStyle?: string | null }
const route = useRoute();
const router = useRouter();
const kids = ref<Child[] | null>(null);
const failed = ref(false);

const go = (id: string) => {
  rememberChild(id);
  const hung = typeof route.query.hung === 'string' ? route.query.hung : undefined;
  return router.replace({ path: `/app/museum/${id}`, query: hung ? { hung } : {} });
};

async function load() {
  failed.value = false;
  try {
    const list = await api.get<Child[]>('/v1/children');
    if (!list.length) return void (await router.replace('/app/children/new'));
    const last = lastChild();
    const asked = typeof route.query.child === 'string' ? route.query.child : null;
    if (asked && list.some((c) => c.id === asked)) return void (await go(asked));
    if (list.length === 1) return void (await go(list[0]!.id)); // 홈 버튼(?pick=1)도 1명이면 그 미술관(D47)
    if (route.query.pick !== '1') {
      if (last && list.some((c) => c.id === last)) return void (await go(last));
    }
    kids.value = list;
  } catch { failed.value = true; }
}
onMounted(load);
</script>

<template>
  <GameStage class="mh">
    <main class="mh-in">
      <div v-if="failed" class="g-panel center" role="alert">
        <p class="t-body">{{ hc.unavailable }}</p>
        <button class="g-btn g-btn--primary" type="button" @click="load">{{ hc.retry }}</button>
      </div>
      <template v-else-if="kids">
        <div class="g-panel plaque">
          <h1 class="g-title mh-h">{{ hc.pickTitle }}</h1>
          <span class="g-rule" aria-hidden="true" />
        </div>
        <ul class="cards">
          <li v-for="c in kids" :key="c.id">
            <button class="g-panel card-btn" type="button" @click="go(c.id)">
              <MuseumBuilding :museum-style="isStyle(c.museumStyle) ? c.museumStyle : DEFAULT_STYLE" :color="isColor(c.color) ? c.color : undefined" :size="120" decorative />
              <CharacterAvatar class="who" :kind="isKind(c.character) ? c.character : DEFAULT_KIND" :color="isColor(c.color) ? c.color : DEFAULT_COLOR" :size="64" />
              <span class="name">{{ hc.museumOf(c.alias) }}</span>
            </button>
          </li>
        </ul>
        <div class="acts">
          <RouterLink class="g-btn" to="/app/children/new">{{ hc.addChild }}</RouterLink>
          <RouterLink class="g-btn" to="/app/town">{{ hc.toTown }}</RouterLink>
        </div>
      </template>
      <p v-else class="g-panel center t-body" role="status">{{ hc.loading }}</p>
    </main>
  </GameStage>
</template>

<style scoped>
.mh{--gs-min:calc(100dvh - 61px)}
.mh-in{width:100%;max-width:960px;display:grid;justify-items:center;gap:16px}
/* 제목 명패: 외관 위에서도 또렷하게 */
.plaque{display:grid;gap:10px;justify-items:center;padding:16px clamp(20px,4vw,40px) 14px;border-radius:999px}
.mh-h{text-align:center;font-size:clamp(22px,3.2vw,32px)}
.center{display:grid;place-items:center;gap:12px;padding:28px 24px;text-align:center;margin:0}
.cards{list-style:none;margin:8px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,210px));gap:18px;justify-content:center;width:100%}
/* 고르기 카드: 금테 양피지 패널 + 누르면 3px 내려앉음(버튼과 같은 느낌) */
.card-btn{position:relative;width:100%;display:grid;justify-items:center;gap:6px;padding:18px 12px 16px;cursor:pointer;font:inherit;
  transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.card-btn:hover{transform:translateY(-3px)}
.card-btn:active{transform:translateY(3px);transition-duration:.05s}
.card-btn:focus-visible{outline:3px solid var(--g-plum-deep);outline-offset:4px}
.who{position:absolute;right:8px;top:8px}
.name{font:700 18px/1.3 var(--g-serif);color:var(--g-ink);text-align:center}
.acts{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:4px}
@media (prefers-reduced-motion:reduce){.card-btn,.card-btn:hover,.card-btn:active{transition:none;transform:none}}
</style>
