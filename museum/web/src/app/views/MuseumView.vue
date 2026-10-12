<script setup lang="ts">
// 전시실 /app/hall(SD_02 §17-4, D26 ⑥ — 색 틀 v2. 내용·동작은 §17-2 그대로). 홈은 /app(§17-3).
// 머리("{별칭}의 전시실" · [← 홈으로] · 아이 고르기) → 평면도(빨간 가는 선 도면: 두꺼운 벽선 · 문 틈 · 실 번호 · 회랑 · 로비 · 입구 계단 · 방위,
// 누르면 그 관으로) → N세관(아이보리·블러시 번갈아 평평한 구획, 흰 매트 액자와 명패를 가로로, 많으면 그 영역 안에서 옆으로).
// 작품을 누르면 "작품 앞"(주소 ?art={id}): 큰 흰 매트 액자 + 월 라벨(StoryCard — 작품명 · 작가 줄 · 결과 종류 · 규칙 문장 해설 ·
// 보호자 감상평 · 승인된 AI 해설). 뒤로가기는 [← 전시실로] · 브라우저 뒤로가기 · Esc. 움직이는 그림은 누를 때만(UX4).
// 전시 데이터는 GET /v1/gallery 그대로(exhibited만, 제작일 순, 낮춤 표시 없음 — UX3·D3). 준비 중 작품 수는 GET /v1/artworks.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import type { BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import ArtFrame from '@/components/ArtFrame.vue';
import StoryCard from '@/components/StoryCard.vue';
import SaveButtons from '@/components/SaveButtons.vue';
import BlockNotice from '@/components/BlockNotice.vue';
import { ko } from '@/copy/ko';
import NoticeBlock from '../components/NoticeBlock.vue';
import { blockOf, type ArtworkSummary } from '../artwork';
import { reducedMotion } from '@/composables/usePolling';
import { museumTheme, roomLabel, roomNumbers } from '../museumTheme';
import { loadWall } from '../walk/prefs';

type Child = components['schemas']['Child'];
type Gallery = components['schemas']['Gallery'];
type Item = components['schemas']['GalleryItem'];

const route = useRoute();
const router = useRouter();
const joined = route.query.joined === '1';
const children = ref<Child[] | null>(null);
const childId = ref(typeof route.query.child === 'string' ? route.query.child : '');
const g = ref<Gallery | null>(null);
const preparing = ref(0);
const playing = ref(false);
const showOriginal = ref(false);
const block = ref<Notice | null>(null);
const labelEl = ref<HTMLElement | null>(null);
/** 이 화면에서 작품을 열었으면 뒤로가기는 history.back — 주소로 바로 들어왔으면 전시실 주소로 바꾼다 */
let pushed = false;
let lastOpenedId = '';

const alias = computed(() => children.value?.find((c) => c.id === childId.value)?.alias ?? '');
/** 시안(D30, SD_02 §17-5): 전시실 이름과 작품 앞의 벽 · 액자만 바뀐다. v2는 지금 그대로 */
const theme = museumTheme();
const frameVariant = theme === 'walk' ? 'gold' : 'mat';
const wall = computed(() => (theme === 'walk' ? loadWall(childId.value) : undefined));
const roomNo = computed(() => roomNumbers(rooms.value));
const roomName = (age: number | null) => roomLabel(roomNo.value.get(age) ?? 1, age, theme);
const rooms = computed(() => g.value?.groups ?? []);
const all = computed(() => rooms.value.flatMap((r) => r.items));
const count = computed(() => all.value.length);
const open = computed<Item | null>(() => {
  const id = typeof route.query.art === 'string' ? route.query.art : '';
  return id ? all.value.find((it) => it.id === id) ?? null : null;
});

// 평면도 칸 바탕 — 세관마다 컬러 블록을 돌려 쓴다(토큰 v2)
const BLOCKS = ['pink', 'lime', 'lilac', 'coral', 'cream', 'mint'];
const blockOf2 = (i: number) => `var(--color-block-${BLOCKS[i % BLOCKS.length]})`;

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
    // 주소의 아이가 그대로 맞으면 watch가 돌지 않으므로 여기서 불러온다(?child=&art= 로 바로 들어온 경우)
    if (!children.value.some((c) => c.id === childId.value)) childId.value = children.value[0]?.id ?? ''; else void load();
    if (!children.value.length) g.value = { childId: '', groups: [] };
  } catch (e) { block.value = blockOf(e); }
});
watch(childId, (id, prev) => {
  const q: Record<string, unknown> = { ...route.query, child: id };
  if (prev) delete q.art; // 아이를 바꾸면 전시실로
  if (id) void router.replace({ query: q as typeof route.query });
  void load();
});

async function show(it: Item) {
  lastOpenedId = it.id; pushed = true;
  await router.push({ query: { ...route.query, art: it.id } });
}
function back() {
  if (!open.value) return;
  if (pushed) { pushed = false; router.back(); return; }
  const q = { ...route.query }; delete q.art;
  void router.replace({ query: q });
}
// 작품 앞에 들어가면 라벨로 초점, 나오면 열었던 작품으로 초점을 돌려준다
watch(open, async (it, prev) => {
  playing.value = false; showOriginal.value = false;
  await nextTick();
  if (it) { labelEl.value?.focus(); window.scrollTo({ top: 0 }); return; }
  if (!it && prev) { pushed = false; document.querySelector<HTMLElement>(`[data-art="${lastOpenedId || prev.id}"]`)?.focus(); }
});
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && open.value) { e.preventDefault(); back(); } }
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function goRoom(age: number | null) { // 나이 미정 = room-null
  await nextTick();
  const el = document.getElementById(`room-${age}`);
  el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  el?.querySelector<HTMLElement>('h2')?.focus();
}
/** 평면도 칸: 왼쪽·오른쪽 번갈아, 두 칸이 한 줄 */
const planRows = computed(() => Math.max(1, Math.ceil(rooms.value.length / 2)));
</script>

<template>
  <main class="hallpage" :class="theme" :style="wall ? { '--walk-wall': wall } : undefined">
    <div class="container">
      <NoticeBlock v-if="joined" :title="ko.family.joined" />
      <BlockNotice v-if="block" :notice="block" @action="load" />
    </div>

    <!-- 작품 앞: 큰 흰 매트 액자 + 월 라벨(StoryCard) -->
    <section v-if="open" class="viewing" aria-labelledby="wl-title">
      <div class="container viewing-in">
        <div class="wall-piece">
          <ArtFrame size="lg" :variant="frameVariant" :src="(showOriginal ? open.originalUrl : still(open)) ?? null"
            :video="!showOriginal && open.kind === 'animated' ? open.primaryUrl ?? null : null" :playing="playing" :alt="open.title" @reload="load" />
        </div>
        <aside ref="labelEl" class="walllabel" tabindex="-1" aria-live="polite">
          <button class="wl-back" type="button" @click="back"><span aria-hidden="true">←</span> {{ ko.museum.back }}</button>
          <StoryCard :item="open" :alias="alias" title-id="wl-title" />
          <SaveButtons :item="open" :alias="alias" :still="still(open) ?? null" /><!-- D37 저장하기 -->
          <div v-if="open.kind !== 'frame'" class="wl-acts">
            <button v-if="open.kind === 'animated' && !showOriginal && open.primaryUrl && !reducedMotion()" class="btn btn-primary" type="button" :aria-pressed="playing"
              @click="playing = !playing">{{ playing ? ko.museum.stop : ko.museum.play }}</button>
            <button class="btn btn-secondary" type="button" :aria-pressed="showOriginal"
              @click="showOriginal = !showOriginal; playing = false">{{ showOriginal ? ko.museum.showWork : ko.museum.showOriginal }}</button>
          </div>
        </aside>
      </div>
    </section>

    <template v-else>
      <!-- 머리 -->
      <header class="container hall-head">
        <RouterLink class="to-home" to="/app"><span aria-hidden="true">←</span> {{ ko.museum.toHome }}</RouterLink>
        <p class="eyebrow">{{ ko.museum.name }}</p>
        <h1 class="hall-title" aria-live="polite">{{ alias ? ko.museum.hallTitle(alias) : ko.museum.name }}</h1>
        <div v-if="(children?.length ?? 0) > 1" class="field pick">
          <label for="ms-child">{{ ko.museum.child }}</label>
          <select id="ms-child" v-model="childId" class="input">
            <option v-for="c in children ?? []" :key="c.id" :value="c.id">{{ c.alias }}</option>
          </select>
        </div>
      </header>

      <!-- 평면도: 빨간 가는 선 도면 -->
      <nav v-if="rooms.length" class="container plan" :aria-label="ko.museum.plan">
        <p class="plan-h">{{ ko.museum.plan }}</p>
        <div class="blueprint">
          <p class="compass" aria-hidden="true"><span>▲</span>{{ ko.museum.north }}</p>
          <p class="bp-title" aria-hidden="true">{{ ko.museum.floorPlan }}</p>
          <div class="plan-map" :style="{ gridTemplateRows: `repeat(${planRows}, minmax(64px,auto)) 56px` }">
            <div class="corridor" aria-hidden="true" :style="{ gridRow: `1 / span ${planRows}` }"><span>{{ ko.museum.corridor }}</span></div>
            <button v-for="(r, i) in rooms" :key="r.ageAtMaking ?? 'none'" type="button" class="plan-room" :class="i % 2 ? 'right' : 'left'"
              :style="{ gridRow: Math.floor(i / 2) + 1, '--blk': blockOf2(i) }" @click="goRoom(r.ageAtMaking)">
              <span class="no" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
              <b>{{ roomName(r.ageAtMaking) }}</b><span class="n">{{ r.items.length }}</span>
            </button>
            <div class="plan-lobby" aria-hidden="true" :style="{ gridRow: planRows + 1 }">{{ ko.museum.lobby }}</div>
          </div>
          <div class="stairs" aria-hidden="true"><span>{{ ko.museum.entrance }}</span></div>
        </div>
      </nav>

      <!-- N세관: 평평한 구획을 번갈아 -->
      <section v-for="(r, ri) in rooms" :id="`room-${r.ageAtMaking}`" :key="r.ageAtMaking ?? 'none'" class="room" :class="{ alt: ri % 2 === 0 }" :aria-labelledby="`rh-${r.ageAtMaking}`">
        <div class="container room-head">
          <h2 :id="`rh-${r.ageAtMaking}`" class="signplate" tabindex="-1">{{ roomName(r.ageAtMaking) }}</h2>
          <p class="room-meta">{{ ko.museum.roomMeta(r.items.length, r.items[0]?.madeOn ?? '') }}</p>
        </div>
        <div class="container">
          <div class="hang-scroll" tabindex="0" role="region" :aria-label="ko.museum.hangOf(r.ageAtMaking)">
            <ul class="hang">
              <li v-for="it in r.items" :key="it.id">
                <button class="piece" type="button" :aria-label="it.title" :data-art="it.id" @click="show(it)">
                  <ArtFrame size="sm" :variant="frameVariant" :src="still(it) ?? null" :alt="it.title" />
                </button>
                <p class="plaque"><b>{{ it.title }}</b><span>{{ ko.museum.plaque(it.madeOn, it.ageAtMaking) }}</span></p>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 빈 전시실 -->
      <section v-if="g && !count" class="room alt" aria-labelledby="rh-empty">
        <div class="container empty-cta">
          <ul class="hang empty">
            <li><ArtFrame size="sm" /></li>
            <li class="hide-m"><ArtFrame size="sm" /></li>
          </ul>
          <h2 id="rh-empty" class="t-headline">{{ ko.museum.emptyTitle }}</h2>
          <RouterLink class="btn btn-primary" :to="children?.length ? '/app/upload' : '/app/children'">{{ ko.museum.upload }}</RouterLink>
        </div>
      </section>

      <div v-if="preparing" class="container prep">
        <p class="t-body-sm">{{ ko.museum.preparing(preparing) }}</p>
        <RouterLink class="btn btn-secondary" to="/app/works">{{ ko.museum.manage }}</RouterLink>
      </div>
    </template>
  </main>
</template>

<style scoped>
/* 전시실(SD_02 §17-4) — 색은 스타일가이드 토큰 v2만 */
.hallpage{padding-bottom:var(--s-section);word-break:keep-all;overflow-x:clip;min-height:100vh}
.hall-head{display:grid;gap:var(--s-xs);padding-top:var(--s-xl);padding-bottom:var(--s-lg)}
.to-home{justify-self:start;font:500 15px/1 var(--font-sans);text-decoration:none;border:1px solid var(--color-accent-magenta);border-radius:var(--r-pill);padding:8px 14px}
.to-home:hover{background:var(--color-surface-soft)}
.eyebrow{margin-top:var(--s-md);font:600 13px/1 var(--font-sans);letter-spacing:.8px}
.hall-title{margin:0;font:750 clamp(36px,6vw,72px)/1.05 var(--font-sans);letter-spacing:-.035em;color:var(--color-accent-magenta)}
.pick{max-width:260px}

/* 평면도 — 아이보리 판 위 빨간 선 도면 */
.plan{margin:var(--s-lg) auto var(--s-xl)}
.plan-h{font:600 13px/1.3 var(--font-sans);letter-spacing:.8px;text-align:center;margin-bottom:var(--s-sm)}
.blueprint{position:relative;max-width:640px;margin:0 auto;padding:40px 18px 0;border:1px solid var(--color-accent-magenta);border-radius:var(--r-lg);
  background:repeating-linear-gradient(0deg,transparent 0 23px,rgba(184,106,139,.10) 23px 24px),repeating-linear-gradient(90deg,transparent 0 23px,rgba(184,106,139,.10) 23px 24px),var(--color-canvas)}
.bp-title{position:absolute;top:14px;left:20px;font:400 12px/1 var(--font-mono);letter-spacing:.6px}
.compass{position:absolute;top:10px;right:18px;display:grid;justify-items:center;font:600 12px/1 var(--font-mono)}
.compass span{font-size:14px;color:var(--color-accent-magenta)}
.plan-map{display:grid;grid-template-columns:1fr 72px 1fr;border:5px solid var(--color-accent-magenta);background:var(--color-canvas)}
.corridor{grid-column:2;border-left:2px solid var(--color-accent-magenta);border-right:2px solid var(--color-accent-magenta);display:flex;align-items:center;justify-content:center;
  background:repeating-linear-gradient(45deg,transparent 0 10px,rgba(184,106,139,.12) 10px 11px)}
/* 글자는 가로 한 줄(세로 쪼개짐 수정, D30 — SD_02 §17-5) */
.corridor span{font:400 12px/1 var(--font-mono);letter-spacing:.6px;white-space:nowrap}
.plan-room{position:relative;border:0;border-bottom:2px solid var(--color-accent-magenta);background:var(--blk);min-height:64px;
  display:flex;align-items:center;justify-content:center;gap:var(--s-xs);padding:10px 14px;font:500 16px/1.2 var(--font-sans);cursor:pointer;color:var(--color-ink)}
.plan-room b{font-weight:750}
.plan-room .n{font:400 12px/1 var(--font-mono);border:1px solid var(--color-ink);border-radius:var(--r-pill);padding:3px 7px}
.plan-room .no{position:absolute;top:6px;font:400 11px/1 var(--font-mono)}
.plan-room.left{grid-column:1}.plan-room.left .no{left:8px}
.plan-room.right{grid-column:3}.plan-room.right .no{right:8px}
.plan-room::after{content:"";position:absolute;top:50%;height:26px;width:8px;transform:translateY(-50%);background:var(--color-canvas)}
.plan-room.left::after{right:-5px}.plan-room.right::after{left:-5px}
.plan-room:hover,.plan-room:focus-visible{box-shadow:inset 0 0 0 2px var(--color-accent-magenta)}
.plan-lobby{grid-column:1 / -1;display:grid;place-items:center;font:400 13px/1 var(--font-mono);letter-spacing:.6px;background:var(--color-surface-soft)}
.stairs{white-space:nowrap;width:120px;margin:0 auto;padding:28px 0 12px;display:grid;justify-items:center;font:400 12px/1 var(--font-mono);letter-spacing:.6px;
  background:repeating-linear-gradient(180deg,var(--color-accent-magenta) 0 1px,transparent 1px 6px) top/100% 22px no-repeat}

/* N세관 — 평평한 구획 */
.room{padding:var(--s-xxl) 0;scroll-margin-top:var(--s-md)}
.room.alt{background:var(--color-surface-soft)}
.room-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--s-sm);margin-bottom:var(--s-lg)}
.signplate{margin:0;font:750 clamp(32px,4.4vw,52px)/1 var(--font-sans);letter-spacing:-.03em;color:var(--color-accent-magenta)}
.room-meta{font:500 15px/1.4 var(--font-sans)}
.hang-scroll{overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:thin;margin:0 calc(var(--gutter) * -1);padding:0 var(--gutter)}
.hang-scroll:focus-visible{outline:2px solid var(--color-accent-magenta);outline-offset:-2px}
.hang{list-style:none;margin:0;padding:6px 2px 10px;display:flex;gap:var(--s-xl);align-items:flex-end;width:max-content}
.hang li{display:grid;justify-items:center;gap:10px;flex:none;scroll-snap-align:start}
.piece{border:0;background:none;padding:0;cursor:pointer;transition:transform .2s ease}
.piece:hover{transform:translateY(-3px)}
.plaque{display:grid;gap:2px;text-align:center;min-width:140px;max-width:240px;padding:6px 12px;background:var(--color-canvas);border:1px solid var(--color-accent-magenta);border-radius:var(--r-sm)}
.plaque b{font:700 15px/1.3 var(--font-sans)}
.plaque span{font:400 12px/1.2 var(--font-mono);letter-spacing:.3px}
.empty-cta{display:grid;justify-items:center;gap:var(--s-md);text-align:center}
.hang.empty{width:auto}
@media (max-width:560px){.hide-m{display:none}}
.prep{display:flex;flex-wrap:wrap;gap:var(--s-sm);align-items:center;justify-content:center;margin-top:var(--s-xl)}

/* 작품 앞 */
.viewing{padding:var(--s-xl) 0 var(--s-section);min-height:calc(100dvh - 64px)}
.viewing-in{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr);gap:var(--s-xxl);align-items:center}
@media (max-width:900px){.viewing-in{grid-template-columns:minmax(0,1fr);justify-items:center}}
.wall-piece{display:grid;place-items:center;max-width:100%;padding:clamp(16px,3vw,40px);background:var(--color-surface-soft);border-radius:var(--r-lg);width:100%;min-width:0}
.wall-piece :deep(.is-lg){--art-max-w:min(calc(100vw - 112px),560px)}
.walllabel{background:#fff;color:var(--color-ink);border:1px solid var(--color-accent-magenta);border-radius:var(--r-lg);padding:var(--s-lg);display:grid;gap:var(--s-sm);max-width:440px;width:100%}
.wl-back{justify-self:start;background:none;border:1px solid var(--color-accent-magenta);border-radius:var(--r-pill);padding:8px 14px;font:500 15px/1 var(--font-sans);color:var(--color-ink);cursor:pointer}
.wl-back:hover{background:var(--color-surface-soft)}
.wl-acts{display:flex;flex-wrap:wrap;gap:var(--s-xs);margin-top:var(--s-xs)}
.wl-acts .btn{font-size:16px;padding:8px 16px}
.wl-acts .btn-secondary{border:1px solid var(--color-accent-magenta)}
/* 걸어 다니는 미술관(D31, SD_02 §17-6) — 작품 앞의 벽은 고른 벽 색 + 금빛 처마 선 */
.hallpage.walk .wall-piece{background:var(--walk-wall,var(--color-block-cream));box-shadow:inset 0 10px 0 #D9B566,inset 0 11px 0 #B08A3E}
</style>
