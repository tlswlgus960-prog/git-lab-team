<script setup lang="ts">
// S4 작품 목록(T080, SD_02 §7, UC3 BF1·BF2). 로그인 뒤 진입 홈. 가족 작품만, 상태 배지(C4)와 현재 단계.
// 작품을 누르면 상태에 맞는 화면으로 간다(routeFor). 진행 중 작품이 있을 때만 폴링(R-12).
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/client';
import type { BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import BlockNotice from '@/components/BlockNotice.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { usePolling } from '@/composables/usePolling';
import { ko } from '@/copy/ko';
import NoticeBlock from '../components/NoticeBlock.vue';
import { MOVING_STATES, blockOf, nextActionLabel, routeFor, type ArtworkSummary } from '../artwork';

type Child = components['schemas']['Child'];

const joined = useRoute().query.joined === '1'; // S1c 수락 뒤(UC15 BF6)
const deleted = useRoute().query.deleted === '1'; // 작품을 지운 뒤(외부 피드백 4차) — 다음 이동 때 없어진다
const items = ref<ArtworkSummary[] | null>(null);
const children = ref<Child[]>([]);
const block = ref<Notice | null>(null);
const alias = computed(() => new Map(children.value.map((c) => [c.id, c.alias])));

async function load(): Promise<boolean> {
  const [list, kids] = await Promise.all([api.get<ArtworkSummary[]>('/v1/artworks'), api.get<Child[]>('/v1/children')]);
  items.value = list; children.value = kids; block.value = null;
  return list.some((a) => MOVING_STATES.includes(a.state));
}
const poll = usePolling(load);
async function first() {
  try { if (await load()) poll.start(); } catch (e) { block.value = blockOf(e); }
}
onMounted(first);
</script>

<template>
  <main class="container page stack">
    <div class="head">
      <h1 class="t-headline">{{ ko.shell.appMenu.artworks }}</h1>
      <RouterLink v-if="children.length" class="btn btn-primary" to="/app/upload">{{ ko.shell.appMenu.upload }}</RouterLink>
      <ReasonButton v-else-if="items" :label="ko.shell.appMenu.upload" disabled :reason="ko.child.needChild" />
    </div>
    <NoticeBlock v-if="joined" :title="ko.family.joined" />
    <NoticeBlock v-if="deleted" :title="ko.del.deleted" />
    <BlockNotice v-if="block" :notice="block" @action="first" />

    <section v-if="items && !items.length" class="stack">
      <p class="t-body">{{ ko.list.empty }}</p>
      <RouterLink v-if="!children.length" class="btn btn-secondary" to="/app/children">{{ ko.shell.appMenu.children }}</RouterLink>
    </section>

    <!-- D38 수장고: 원근 있는 벽에 액자로 걸린 작품 · 아래 상태 명패 -->
    <ul v-else-if="items" class="vault" :aria-label="ko.shell.appMenu.artworks">
      <li v-for="(a, i) in items" :key="a.id" v-reveal="i" class="vault-item">
        <RouterLink v-tilt class="vframe" :to="routeFor(a)" :style="{ viewTransitionName: `art-${a.id}` }" :aria-label="a.title || ko.list.untitled">
          <span class="vmat"><img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" alt="" loading="lazy"><span v-else class="vblank"></span></span>
        </RouterLink>
        <div class="vplaque">
          <b>{{ a.title || ko.list.untitled }}</b>
          <span>{{ alias.get(a.childId) ?? '' }}</span>
        </div>
        <div class="vstate">
          <StatusBadge :state="a.state === 'failed' ? 'not_delivered' : a.state" />
          <RouterLink v-if="nextActionLabel(a.state)" class="vact" :to="a.state === 'exhibited' ? `/app/museum/${a.childId}` : routeFor(a)">{{ nextActionLabel(a.state) }}</RouterLink>
          <span v-else-if="a.currentStage" class="t-body-sm">{{ ko.stageName[a.currentStage] ?? '' }}</span>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--s-sm)}
/* 수장고 벽: 액자 격자(D38) */
.vault{list-style:none;margin:0;padding:clamp(8px,2vw,24px) 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(44%,210px),1fr));gap:clamp(22px,4vw,44px) clamp(14px,3vw,36px)}
.vault-item{display:grid;justify-items:center;gap:10px;text-align:center}
.vframe{display:block;padding:9px;border-radius:2px;background:linear-gradient(135deg,#f1d98b,#c9a043 38%,#8e6b22 62%,#e2c170);
  box-shadow:inset 0 0 0 2px rgba(255,236,170,.55),0 22px 28px -16px rgba(40,24,8,.6);width:100%;max-width:240px}
.vmat{display:grid;place-items:center;aspect-ratio:4/3;background:#fffeef;padding:9%;box-shadow:inset 0 0 0 1px rgba(142,107,34,.45),inset 0 6px 10px -6px rgba(0,0,0,.25)}
.vmat img{width:100%;height:100%;object-fit:contain}
.vblank{width:100%;height:100%;border:1px dashed #c9a552}
.vplaque{display:grid;gap:2px;padding:6px 12px;border-radius:3px;background:linear-gradient(135deg,#e9d39a,#c9a552 55%,#a98435);color:#2b2007;box-shadow:0 6px 10px -6px rgba(0,0,0,.45);max-width:100%}
.vplaque b{font:700 15px/1.25 var(--mc-serif,serif);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vplaque span{font:500 12px/1.2 var(--font-sans)}
.vstate{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center}
.vact{font:700 14px/1 var(--font-sans);color:var(--color-primary);padding:10px 12px;min-height:44px;display:inline-flex;align-items:center;text-underline-offset:3px}
</style>
