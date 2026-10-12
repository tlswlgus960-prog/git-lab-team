<script setup lang="ts">
// 한눈에 보기 /app/list — 고전 미술관 목록형(D30 → D31 선택: 금빛 액자 · 크림 벽 + 고른 벽 색, SD_02 §17-5). 홈 /app은 걸어 다니는 미술관(§17-6).
// 아치 간판 → 로비 벽(천창 빛 · 몰딩 · 기둥 · 최근 작품 · 황동 설명판 · 대리석 바닥) → 미술관 안내도(방 칸 + 현재 위치 + 입구) → 전시실 구획(아치 입구 · 벽에 건 작품).
// 데이터는 지금 홈과 같다: GET /v1/children · /v1/gallery · /v1/artworks. 작품이나 설명판을 누르면 작품 앞(/app/hall?art=) — 전시 해설과 아이의 한마디.
// 색 · 장식은 classic.css(--mc-*)만. 3D 엔진 · 소리 · 외부 사진 없음. 움직임 줄이기면 빛 변화 · 떠오르기 · 부드러운 스크롤을 끈다.
import '@/styles/classic.css';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import type { BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import ArtFrame from '@/components/ArtFrame.vue';
import BlockNotice from '@/components/BlockNotice.vue';
import { ko } from '@/copy/ko';
import { blockOf, type ArtworkSummary } from '../artwork';
import { byAge, roomNumbers } from '../museumTheme';
import { loadWall } from '../walk/prefs';

type Child = components['schemas']['Child'];
type Gallery = components['schemas']['Gallery'];
type Item = components['schemas']['GalleryItem'];

const frame = 'gold';

const route = useRoute();
const router = useRouter();
const children = ref<Child[] | null>(null);
const childId = ref(typeof route.query.child === 'string' ? route.query.child : '');
const g = ref<Gallery | null>(null);
const preparing = ref(0);
const block = ref<Notice | null>(null);

const alias = computed(() => children.value?.find((c) => c.id === childId.value)?.alias ?? '');
/** 전시실 — 나이가 어린 순서, 번호는 1부터 */
const rooms = computed(() => {
  const groups = [...(g.value?.groups ?? [])].sort((a, b) => byAge(a.ageAtMaking, b.ageAtMaking)); // 나이 미정은 맨 뒤
  const no = roomNumbers(groups);
  return groups.map((r) => ({ ...r, no: no.get(r.ageAtMaking)!, items: [...r.items].sort((a, b) => a.madeOn.localeCompare(b.madeOn)) }));
});
const all = computed(() => rooms.value.flatMap((r) => r.items));
const latest = computed(() => [...all.value].sort((a, b) => a.madeOn.localeCompare(b.madeOn)).at(-1) ?? null);
/** 고른 벽 색(걸어 다니는 미술관과 같은 값, 이 기기 · 아이마다) */
const wall = computed(() => loadWall(childId.value));

function still(it: Item) { return it.kind === 'frame' ? it.photoUrl ?? it.originalUrl : it.kind === 'relief' ? it.auxUrl ?? it.originalUrl : it.posterUrl ?? it.photoUrl ?? it.originalUrl; }

async function load() {
  if (!childId.value) return;
  try {
    const [gal, list] = await Promise.all([
      api.get<Gallery>('/v1/gallery', { query: { child: childId.value } }),
      api.get<ArtworkSummary[]>('/v1/artworks', { query: { child: childId.value } }).catch(() => [] as ArtworkSummary[]),
    ]);
    g.value = gal; preparing.value = list.filter((a) => a.state !== 'exhibited').length; block.value = null;
  } catch (e) { block.value = blockOf(e); }
}
onMounted(async () => {
  try {
    children.value = await api.get<Child[]>('/v1/children');
    if (!children.value.some((c) => c.id === childId.value)) childId.value = children.value[0]?.id ?? ''; else void load();
    if (!children.value.length) g.value = { childId: '', groups: [] };
  } catch (e) { block.value = blockOf(e); }
});
watch(childId, (id) => { if (id) void router.replace({ query: { ...route.query, child: id } }); void load(); });

function openArt(it: Item) { void router.push({ path: '/app/hall', query: { child: childId.value, art: it.id } }); }
function goRoom(no: number) {
  const el = document.getElementById(`mc-room-${no}`);
  el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}
</script>

<template>
  <main class="mc" :style="{ '--mc-wall': wall }">
    <div class="container">
      <BlockNotice v-if="block" :notice="block" @action="load" />
    </div>

    <!-- 1 아치 간판 -->
    <header class="container">
      <div class="mc-sign">
        <p class="mc-eyebrow">{{ ko.museum.name }}</p>
        <h1>{{ alias ? ko.museum.hall(alias) : ko.museum.name }}</h1>
        <p class="mc-tagline">{{ ko.walk.list }}</p>
        <RouterLink class="mc-towalk" :to="{ path: '/app', query: childId ? { child: childId } : {} }">{{ ko.walk.toWalk }} <span aria-hidden="true">→</span></RouterLink>
      </div>
      <div class="mc-entab" aria-hidden="true"></div>
      <div v-if="(children?.length ?? 0) > 1" class="field mc-pick">
        <label for="mc-child">{{ ko.museum.child }}</label>
        <select id="mc-child" v-model="childId" class="input">
          <option v-for="c in children ?? []" :key="c.id" :value="c.id">{{ c.alias }}</option>
        </select>
      </div>
    </header>

    <!-- 2 로비 벽: 최근 작품 -->
    <section class="mc-wall mc-lobby" :aria-label="ko.museum.latest">
      <span class="mc-sky" aria-hidden="true"></span><span class="mc-cornice" aria-hidden="true"></span>
      <span class="mc-pil l" aria-hidden="true"></span><span class="mc-pil r" aria-hidden="true"></span>
      <div class="mc-lobby-in">
        <template v-if="latest">
          <p class="mc-lobby-h">{{ ko.museum.latest }}</p>
          <button class="mc-hero" type="button" :aria-label="ko.classic.plaqueOpen(latest.title)" :data-art="latest.id" @click="openArt(latest)">
            <ArtFrame size="lg" :variant="frame" priority :src="still(latest) ?? null" :alt="latest.title" />
          </button>
          <button class="mc-plaque" type="button" :aria-label="ko.classic.plaqueOpen(latest.title)" @click="openArt(latest)">
            <b>{{ latest.title }}</b><span>{{ ko.museum.plaque(latest.madeOn, latest.ageAtMaking) }}</span>
          </button>
        </template>
        <div v-else-if="g" class="mc-empty">
          <ArtFrame size="md" :variant="frame" />
          <h2>{{ ko.museum.emptyTitle }}</h2>
          <RouterLink class="btn btn-primary" :to="children?.length ? '/app/upload' : '/app/children'">{{ ko.museum.upload }}</RouterLink>
        </div>
      </div>
      <span class="mc-floor" aria-hidden="true"></span>
    </section>

    <template v-if="all.length">
      <!-- 3 미술관 안내도 -->
      <nav class="container mc-map" :aria-label="ko.classic.map">
        <p class="mc-map-h">{{ ko.classic.map }}</p>
        <div class="mc-plan">
          <ol class="mc-rooms">
            <li v-for="r in rooms" :key="r.ageAtMaking ?? 'none'">
              <a class="mc-cell" :href="`#mc-room-${r.no}`" @click.prevent="goRoom(r.no)">
                <span class="no" aria-hidden="true">{{ String(r.no).padStart(2, '0') }}</span>
                <b>{{ ko.classic.roomNo(r.no) }}</b>
                <span>{{ ko.classic.cell(r.ageAtMaking, r.items.length) }}</span>
              </a>
            </li>
          </ol>
          <p class="mc-here"><span class="mc-pin" aria-hidden="true"></span>{{ ko.museum.lobby }} <em>{{ ko.classic.here }}</em></p>
          <span class="mc-door" aria-hidden="true"></span>
        </div>
        <span class="mc-door-l">{{ ko.museum.entrance }}</span>
      </nav>

      <!-- 4 전시실 구획 -->
      <section v-for="r in rooms" :id="`mc-room-${r.no}`" :key="r.ageAtMaking ?? 'none'" class="mc-room" :aria-labelledby="`mc-rh-${r.no}`">
        <div class="mc-wall">
          <span class="mc-sky" aria-hidden="true"></span><span class="mc-cornice" aria-hidden="true"></span>
          <span class="mc-pil l" aria-hidden="true"></span><span class="mc-pil r" aria-hidden="true"></span>
          <div class="container">
            <div class="mc-arch">
              <h2 :id="`mc-rh-${r.no}`" tabindex="-1">{{ ko.classic.roomNo(r.no) }}</h2>
              <p>{{ ko.classic.roomLine(r.ageAtMaking, r.items.length, r.items[0]?.madeOn ?? '') }}</p>
            </div>
          </div>
          <div class="mc-hang-scroll" tabindex="0" role="region" :aria-label="ko.classic.wallOf(r.no)">
            <ul class="mc-hang">
              <li v-for="it in r.items" :key="it.id">
                <button class="mc-piece" type="button" :aria-label="ko.classic.plaqueOpen(it.title)" :data-art="it.id" @click="openArt(it)">
                  <ArtFrame size="md" :variant="frame" lazy :src="still(it) ?? null" :alt="it.title" />
                </button>
                <button class="mc-plaque" type="button" :aria-label="ko.classic.plaqueOpen(it.title)" @click="openArt(it)">
                  <b>{{ it.title }}</b><span>{{ ko.museum.plaque(it.madeOn, it.ageAtMaking) }}</span>
                </button>
              </li>
            </ul>
          </div>
          <span class="mc-floor" aria-hidden="true"></span>
        </div>
      </section>
    </template>

    <!-- 5 아래 -->
    <div class="container mc-foot">
      <template v-if="preparing">
        <p class="t-body-sm">{{ ko.museum.preparing(preparing) }}</p>
        <RouterLink class="btn btn-secondary" to="/app/works">{{ ko.museum.manage }}</RouterLink>
      </template>
      <RouterLink v-if="all.length" class="line" to="/app/family">{{ ko.paper.toFamily }} <span aria-hidden="true">→</span></RouterLink>
    </div>
  </main>
</template>
