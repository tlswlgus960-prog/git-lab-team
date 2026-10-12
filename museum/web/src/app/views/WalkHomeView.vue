<script setup lang="ts">
// 홈 /app — 걸어 다니는 미술관(D31, SD_02 §17-6). 입구 → (걷기) → 회랑(작품 · 명패) → 갈림길(N살 전시실) → 방 → 크게 보기 + 한마디.
// 두 번째 방문부터는 입구 · 걷기 없이 마지막으로 본 방에서 시작한다(이 기기 브라우저, 아이마다 — walk/prefs.ts).
// 늘 보이는 막대: [건너뛰기] · [작품 올리기] · [한눈에 보기](/app/list) · [벽 색] · 아이 고르기. 밀기 · 탭 · 키보드, 움직임 줄이기면 장면만 바꾼다.
// 데이터: GET /v1/children · /v1/gallery(전시된 작품만, 낮춤 표시 없음 — UX3). 배경은 CSS · 인라인 SVG뿐(3D 엔진 · 사진 없음).
import '@/styles/classic.css';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import type { BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import ArtFrame from '@/components/ArtFrame.vue';
import BlockNotice from '@/components/BlockNotice.vue';
import { ko } from '@/copy/ko';
import { byAge } from '../museumTheme';
import { blockOf } from '../artwork';
import Corridor from '../walk/Corridor.vue';
import Room from '../walk/Room.vue';
import WallPicker from '../walk/WallPicker.vue';
import ArtViewer from '../walk/ArtViewer.vue';
import { WALL_DEFAULT, lastChild, loadVisit, loadWall, saveVisit, saveWall } from '../walk/prefs';

type Child = components['schemas']['Child'];
type Gallery = components['schemas']['Gallery'];
type Item = components['schemas']['GalleryItem'];
type Scene = 'gate' | 'corridor' | 'junction' | 'room';

const route = useRoute();
const router = useRouter();
const children = ref<Child[] | null>(null);
const childId = ref(typeof route.query.child === 'string' ? route.query.child : '');
const g = ref<Gallery | null>(null);
const block = ref<Notice | null>(null);

// 두 번째 방문이면 API를 기다리기 전부터 방 장면(입구가 번쩍이지 않게)
const early = lastChild();
const scene = ref<Scene>(early && loadVisit(early) ? 'room' : 'gate');
const stop = ref(0);
const roomIdx = ref(0);
const walking = ref(false);
const wall = ref(early ? loadWall(early) : WALL_DEFAULT);
const picker = ref(false);
const viewing = ref<Item | null>(null);
let opener: HTMLElement | null = null;

const alias = computed(() => children.value?.find((c) => c.id === childId.value)?.alias ?? '');
const rooms = computed(() => [...(g.value?.groups ?? [])].sort((a, b) => byAge(a.ageAtMaking, b.ageAtMaking)) // 나이 미정은 맨 뒤
  .map((r) => ({ age: r.ageAtMaking, items: [...r.items].sort((a, b) => a.madeOn.localeCompare(b.madeOn)) })));
const all = computed(() => rooms.value.flatMap((r) => r.items));
/** 회랑: 최근 걸린 작품부터 6점 */
const hall = computed(() => [...all.value].sort((a, b) => b.madeOn.localeCompare(a.madeOn)).slice(0, 6));
const current = computed(() => hall.value[stop.value] ?? null);
const room = computed(() => rooms.value[roomIdx.value] ?? null);
const loaded = computed(() => g.value !== null);

function still(it: Item) { return (it.kind === 'frame' ? it.photoUrl ?? it.originalUrl : it.kind === 'relief' ? it.auxUrl ?? it.originalUrl : it.posterUrl ?? it.photoUrl ?? it.originalUrl) ?? null; }
const sideArts = computed(() => (scene.value === 'corridor' ? hall.value.slice(stop.value + 1) : scene.value === 'gate' ? hall.value : []).map(still));

const where = computed(() => {
  if (scene.value === 'gate') return ko.walk.atGate;
  if (scene.value === 'corridor') return hall.value.length ? ko.walk.atCorridor(stop.value + 1, hall.value.length) : ko.walk.atCorridor(0, 0);
  if (scene.value === 'junction') return ko.walk.atJunction;
  return room.value ? ko.walk.room(room.value.age) : '';
});

// ---- 불러오기 ----
async function load() {
  if (!childId.value) return;
  try {
    g.value = await api.get<Gallery>('/v1/gallery', { query: { child: childId.value } });
    block.value = null;
    start();
  } catch (e) { block.value = blockOf(e); }
}
onMounted(async () => {
  measure();
  try {
    children.value = await api.get<Child[]>('/v1/children');
    if (!children.value.some((c) => c.id === childId.value)) childId.value = children.value[0]?.id ?? ''; else void load();
    if (!children.value.length) { g.value = { childId: '', groups: [] }; scene.value = 'gate'; }
  } catch (e) { block.value = blockOf(e); }
});
watch(childId, (id) => {
  if (!id) return;
  void router.replace({ query: { ...route.query, child: id } });
  wall.value = loadWall(id);
  void load();
});
/** 불러온 뒤 시작 장면: 두 번째 방문이면 마지막 방(없으면 첫 방), 작품이 없으면 회랑 첫 자리 */
function start() {
  const v = loadVisit(childId.value);
  if (!v) { if (scene.value !== 'gate' && !walking.value) scene.value = 'gate'; return; }
  if (!rooms.value.length) { scene.value = 'corridor'; stop.value = 0; return; }
  const i = rooms.value.findIndex((r) => r.age === v.room);
  roomIdx.value = i >= 0 ? i : 0;
  scene.value = 'room';
}

// ---- 이동 ----
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
async function go(next: () => void, walk = false) {
  if (walking.value) return;
  if (walk && !reduce()) { walking.value = true; await new Promise((r) => setTimeout(r, 700)); }
  next(); walking.value = false;
  await nextTick();
  document.querySelector<HTMLElement>('.wk [data-focus]')?.focus({ preventScroll: true });
}
function enter() { saveVisit(childId.value, loadVisit(childId.value)?.room ?? null); void go(() => { scene.value = 'corridor'; stop.value = 0; }, true); }
function forward() {
  if (scene.value === 'gate') return enter();
  if (scene.value === 'corridor') {
    if (!hall.value.length) return;
    if (stop.value < hall.value.length - 1) return void go(() => { stop.value++; }, true);
    return void go(() => { scene.value = 'junction'; }, true);
  }
  if (scene.value === 'junction' && rooms.value.length === 1) return toRoom(0);
}
function backward() {
  if (scene.value === 'corridor') return void go(() => { if (stop.value > 0) stop.value--; else scene.value = 'gate'; });
  if (scene.value === 'junction') return void go(() => { scene.value = 'corridor'; stop.value = Math.max(0, hall.value.length - 1); });
  if (scene.value === 'room') return void go(() => { scene.value = 'junction'; });
}
function toRoom(i: number) {
  if (i < 0 || i >= rooms.value.length) return;
  saveVisit(childId.value, rooms.value[i]!.age);
  void go(() => { roomIdx.value = i; scene.value = 'room'; }, scene.value !== 'room');
}
function skip() {
  if (!rooms.value.length) { void go(() => { scene.value = 'corridor'; stop.value = 0; }); return; }
  const v = loadVisit(childId.value); const i = rooms.value.findIndex((r) => r.age === v?.room);
  toRoom(i >= 0 ? i : 0);
}
function side(dir: -1 | 1) {
  if (scene.value === 'junction') return toRoom(dir < 0 ? 0 : Math.min(1, rooms.value.length - 1));
  if (scene.value === 'room') return toRoom(roomIdx.value + dir);
}
const leftRoom = computed(() => (scene.value === 'junction' ? rooms.value[0] : rooms.value[roomIdx.value - 1]) ?? null);
const rightRoom = computed(() => (scene.value === 'junction' ? (rooms.value.length > 1 ? rooms.value[1] : null) : rooms.value[roomIdx.value + 1]) ?? null);

// ---- 크게 보기 ----
function open(it: Item, e?: Event) { opener = (e?.currentTarget as HTMLElement) ?? null; viewing.value = it; }
async function closeViewer() { viewing.value = null; await nextTick(); opener?.focus(); }

// ---- 키보드 · 밀기 ----
function onKey(e: KeyboardEvent) {
  if (viewing.value || picker.value || e.defaultPrevented) return;
  const t = e.target instanceof HTMLElement ? e.target : document.body;
  if (t.closest('input, select, textarea') || (t.closest('.rm-strip') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) return;
  const map: Record<string, () => void> = { ArrowUp: forward, ArrowDown: backward, ArrowLeft: () => side(-1), ArrowRight: () => side(1) };
  if (e.key === 'Enter' && scene.value === 'gate' && t === document.body) { e.preventDefault(); enter(); return; }
  const fn = map[e.key];
  if (fn) { e.preventDefault(); fn(); }
}
let sx = 0; let sy = 0; let sOk = false; let swiped = false;
/** 그림 위에서 밀어도 이동한다(SD_02 §17-6). 방 안 작품 줄 · 벽 색 판 · 막대 · 입력은 제외 */
function onDown(e: PointerEvent) { sOk = !(e.target as HTMLElement).closest('.rm-strip, .wp, .wk-bar, a, select, input'); sx = e.clientX; sy = e.clientY; }
/** 밀었으면 그 손끝의 누름은 크게 보기 · 버튼으로 치지 않는다 */
function onClickCapture(e: MouseEvent) { if (swiped) { e.preventDefault(); e.stopPropagation(); swiped = false; } }
function onUp(e: PointerEvent) {
  if (!sOk) return; sOk = false;
  const dx = e.clientX - sx; const dy = e.clientY - sy;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
  swiped = true; setTimeout(() => { swiped = false; }, 400);
  if (Math.abs(dy) > Math.abs(dx)) { if (dy < 0) forward(); else backward(); } else side(dx < 0 ? 1 : -1);
}
onMounted(() => { window.addEventListener('keydown', onKey); window.addEventListener('resize', measure); });
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', measure); });

// ---- 장면 높이(셸 머리 아래 화면 전체) ----
const rootEl = ref<HTMLElement | null>(null);
const top = ref(64);
const wide = ref(false);
function measure() {
  const r = rootEl.value?.getBoundingClientRect(); if (r) top.value = Math.max(0, r.top + window.scrollY);
  wide.value = window.innerWidth / Math.max(1, window.innerHeight - top.value) > 1.15;
}

// ---- 벽 색 ----
function setWall(hex: string) { wall.value = hex; saveWall(childId.value, hex); }
function resetWall() { wall.value = WALL_DEFAULT; saveWall(childId.value, null); }
</script>

<template>
  <main ref="rootEl" class="wk mc" :class="[`at-${scene}`, { walking }]" :style="{ '--walk-wall': wall, '--scene-top': `${top}px` }"
    @pointerdown="onDown" @pointerup="onUp" @click.capture="onClickCapture">
    <div class="wk-stage" role="region" :aria-label="ko.walk.scene">
      <div class="wk-bg" :class="{ zoom: walking && scene !== 'room' }">
        <Room v-if="scene === 'room'" :wide="wide" />
        <Corridor v-else :side-arts="sideArts" :junction="scene === 'junction'" :wide="wide" />
      </div>

      <!-- 늘 보이는 막대 -->
      <div class="wk-bar">
        <p class="wk-where" aria-live="polite">{{ where }}</p>
        <div class="wk-acts">
          <button v-if="scene !== 'room'" class="wk-pill" type="button" @click="skip">{{ ko.walk.skip }} <span aria-hidden="true">»</span></button>
          <!-- [올리기] · [목록]은 미술관 셸(MuseumBar)에 늘 있다(D34 ④) -->
          <div class="wk-wallbox">
            <button class="wk-pill" type="button" :aria-expanded="picker" @click="picker = !picker">
              <span class="wk-dot" :style="{ background: wall }" aria-hidden="true"></span>{{ ko.walk.wall }}
            </button>
            <WallPicker v-if="picker" :model-value="wall" @update:model-value="setWall" @reset="resetWall" @close="picker = false" />
          </div>
          <select v-if="(children?.length ?? 0) > 1" v-model="childId" class="wk-pill wk-child" :aria-label="ko.museum.child">
            <option v-for="c in children ?? []" :key="c.id" :value="c.id">{{ c.alias }}</option>
          </select>
        </div>
      </div>
      <div v-if="block" class="wk-block"><BlockNotice :notice="block" @action="load" /></div>

      <!-- 입구 -->
      <section v-if="scene === 'gate'" class="wk-gate" aria-labelledby="wk-title">
        <div class="wk-sign">
          <p class="wk-eyebrow">{{ ko.museum.name }}</p>
          <h1 id="wk-title">{{ alias ? ko.museum.hall(alias) : ko.museum.name }}</h1>
          <p class="wk-tag">{{ ko.museum.tagline }}</p>
          <button class="wk-enter" type="button" data-focus @click="enter">{{ ko.walk.enter }} <span aria-hidden="true">→</span></button>
        </div>
      </section>

      <!-- 회랑 -->
      <section v-else-if="scene === 'corridor'" class="wk-corr" :aria-label="where">
        <template v-if="current">
          <div class="wk-piece" :key="current.id">
            <span class="wk-spot" aria-hidden="true"></span>
            <button class="wk-art" type="button" data-focus :aria-label="ko.classic.plaqueOpen(current.title)" @click="open(current, $event)">
              <ArtFrame size="lg" variant="gold" priority :src="still(current)" :alt="current.title" />
            </button>
            <button class="mc-plaque" type="button" :aria-label="ko.classic.plaqueOpen(current.title)" @click="open(current, $event)">
              <b>{{ current.title }}</b><span>{{ ko.museum.plaque(current.madeOn, current.ageAtMaking) }}</span>
            </button>
          </div>
          <div class="wk-nav">
            <button class="wk-pill" type="button" @click="backward"><span aria-hidden="true">↓</span> {{ ko.walk.backward }}</button>
            <button class="wk-pill strong" type="button" @click="forward">{{ ko.walk.forward }} <span aria-hidden="true">↑</span></button>
          </div>
        </template>
        <div v-else-if="loaded" class="wk-piece wk-empty">
          <span class="wk-spot" aria-hidden="true"></span>
          <ArtFrame size="md" variant="gold" />
          <h2>{{ ko.museum.emptyTitle }}</h2>
          <RouterLink class="btn btn-primary" data-focus :to="children?.length ? '/app/upload' : '/app/children'">{{ ko.museum.upload }}</RouterLink>
        </div>
      </section>

      <!-- 갈림길 -->
      <section v-else-if="scene === 'junction'" class="wk-junc" :aria-label="ko.walk.atJunction">
        <div class="wk-sides">
          <button v-if="leftRoom && rightRoom" class="wk-door l" type="button" data-focus @click="side(-1)">{{ ko.walk.toLeft(leftRoom.age) }}</button>
          <button v-if="rightRoom" class="wk-door r" type="button" @click="side(1)">{{ ko.walk.toRight(rightRoom.age) }}</button>
          <button v-if="leftRoom && !rightRoom" class="wk-door c" type="button" data-focus @click="toRoom(0)">{{ ko.walk.toOnly(leftRoom.age) }}</button>
        </div>
        <ul v-if="rooms.length > 2" class="wk-chips">
          <li v-for="(r, i) in rooms" :key="r.age ?? 'none'"><button class="wk-pill" type="button" @click="toRoom(i)">{{ ko.walk.room(r.age) }} · {{ ko.walk.roomCount(r.items.length) }}</button></li>
        </ul>
        <div class="wk-nav"><button class="wk-pill" type="button" @click="backward"><span aria-hidden="true">↓</span> {{ ko.walk.backward }}</button></div>
      </section>

      <!-- 전시실 -->
      <section v-else-if="scene === 'room' && room" class="wk-room" :aria-labelledby="`wk-rh`" :key="room.age ?? 'none'">
        <header class="rm-head">
          <h2 id="wk-rh" tabindex="-1" data-focus>{{ ko.walk.room(room.age) }}</h2>
          <p>{{ ko.walk.roomCount(room.items.length) }}</p>
        </header>
        <div class="rm-strip" tabindex="0" role="region" :aria-label="ko.classic.wallOf(roomIdx + 1)">
          <ul>
            <li v-for="it in room.items" :key="it.id">
              <span class="wk-spot" aria-hidden="true"></span>
              <button class="wk-art" type="button" :aria-label="ko.classic.plaqueOpen(it.title)" :data-art="it.id" @click="open(it, $event)">
                <ArtFrame size="md" variant="gold" lazy :src="still(it)" :alt="it.title" />
              </button>
              <button class="mc-plaque" type="button" :aria-label="ko.classic.plaqueOpen(it.title)" @click="open(it, $event)">
                <b>{{ it.title }}</b><span>{{ ko.museum.plaque(it.madeOn, it.ageAtMaking) }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div class="wk-nav">
          <button v-if="rooms[roomIdx - 1]" class="wk-pill" type="button" @click="side(-1)">{{ ko.walk.toLeft(rooms[roomIdx - 1]!.age) }}</button>
          <button class="wk-pill" type="button" @click="backward">{{ ko.walk.toCorridor }}</button>
          <button v-if="rooms[roomIdx + 1]" class="wk-pill" type="button" @click="side(1)">{{ ko.walk.toRight(rooms[roomIdx + 1]!.age) }}</button>
        </div>
      </section>
    </div>

    <ArtViewer v-if="viewing" :item="viewing" :alias="alias" :still="still(viewing)" @close="closeViewer" />
  </main>
</template>

<style scoped>
.wk{min-height:0;padding:0;overflow:hidden;background:var(--walk-wall)}
.wk-stage{position:relative;height:max(560px,calc(100dvh - var(--scene-top)));overflow:hidden;touch-action:pan-x pinch-zoom;user-select:none}
.wk-bg{position:absolute;inset:0;transform-origin:50% 54%;transition:none}
.wk-stage::after{content:"";position:absolute;inset:0;z-index:4;pointer-events:none;background:radial-gradient(ellipse 70% 65% at 50% 52%,transparent 55%,rgba(74,58,99,.16) 100%)}
.at-gate .wk-stage::after{display:none}
.wk-bg.zoom{transform:scale(1.45);opacity:.25;transition:transform .7s cubic-bezier(.4,.0,.6,1),opacity .7s ease-in}
/* 막대 */
.wk-bar{position:absolute;top:0;left:0;right:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;padding:10px clamp(12px,2.5vw,32px)}
.wk-where{font:600 14px/1.2 var(--font-sans);color:var(--color-ink);background:rgba(255,251,247,.86);border-radius:var(--r-pill);padding:8px 14px}
.wk-acts{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end}
.wk-pill{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:8px 14px;border:1px solid var(--color-hairline);border-radius:var(--r-pill);
  background:rgba(255,251,247,.88);color:var(--color-ink);font:600 14px/1 var(--font-sans);text-decoration:none;cursor:pointer;backdrop-filter:blur(4px)}
.wk-pill:hover{background:var(--color-canvas)}
.wk-pill.strong{background:var(--color-primary);color:var(--color-on-primary);border-color:var(--color-primary)}
.wk-pill:focus-visible,.wk-enter:focus-visible,.wk-door:focus-visible,.wk-art:focus-visible{outline:3px solid var(--color-ink);outline-offset:3px}
.wk-wallbox{position:relative}
.wk-dot{width:16px;height:16px;border-radius:50%;border:1px solid var(--color-hairline)}
.wk-child{appearance:auto}
.wk-block{position:absolute;top:70px;left:16px;right:16px;z-index:21}
@media (max-width:560px){.wk-pill{padding:8px 11px;font-size:13px}.wk-where{font-size:13px}}
/* 입구 */
.wk-gate{position:absolute;inset:0;display:grid;place-items:center;padding:96px 16px 40px;z-index:5}
.wk-sign{display:grid;justify-items:center;gap:10px;text-align:center;padding:clamp(20px,3vw,36px) clamp(24px,5vw,56px);border-radius:999px 999px 28px 28px;
  background:rgba(255,251,247,.8);box-shadow:0 0 0 1px rgba(217,181,102,.6),0 20px 60px -30px rgba(74,58,99,.45);backdrop-filter:blur(3px)}
.wk-eyebrow{font:600 12px/1 var(--font-sans);letter-spacing:1.6px;color:var(--color-primary)}
.wk-sign h1{margin:0;font:600 clamp(30px,6.4vw,64px)/1.12 var(--mc-serif);color:var(--color-ink)}
.wk-tag{font:400 15px/1.4 var(--font-sans);color:var(--color-ink)}
.wk-enter{margin-top:8px;display:inline-flex;align-items:center;gap:10px;min-height:52px;padding:12px 28px;border:0;border-radius:var(--r-pill);cursor:pointer;
  background:var(--color-primary);color:var(--color-on-primary);font:700 18px/1 var(--font-sans);box-shadow:0 0 0 3px rgba(255,251,247,.9),0 0 0 5px #D9B566}
/* 회랑 · 방 공통: 그림에만 조명 */
.wk-corr,.wk-junc,.wk-room{position:absolute;inset:0;z-index:5;display:grid;align-content:center;justify-items:center;gap:var(--s-md);padding:76px 12px 20px}
.wk-piece{position:relative;display:grid;justify-items:center;gap:12px;animation:near .45s ease-out}
@keyframes near{from{transform:scale(.86);opacity:0}to{transform:none;opacity:1}}
.wk-spot{position:absolute;left:50%;top:-18%;width:150%;height:125%;transform:translateX(-50%);pointer-events:none;
  background:radial-gradient(ellipse 45% 55% at 50% 30%,rgba(255,255,255,.72),rgba(255,255,255,0) 72%)}
.wk-art{position:relative;border:0;background:none;padding:0;cursor:zoom-in}
.wk-corr .wk-art :deep(.mat img){width:min(72vw,560px);height:auto;max-height:min(50vh,470px);max-width:none;object-fit:contain}
@media (min-width:761px){.wk-corr .wk-art :deep(.mat img){width:auto;height:min(44vh,400px);max-width:min(42vw,600px)}}
.wk-nav{position:relative;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.wk-empty h2{position:relative;font:700 22px/1.35 var(--font-sans);color:var(--color-ink);background:rgba(255,251,247,.86);padding:6px 14px;border-radius:var(--r-md)}
/* 갈림길 */
.wk-sides{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(8px,3vw,48px);pointer-events:none}
.wk-door{pointer-events:auto;min-height:56px;padding:12px 20px;border:0;border-radius:var(--r-pill);cursor:pointer;background:rgba(255,251,247,.92);color:var(--color-ink);
  font:600 clamp(17px,2vw,22px)/1.2 var(--mc-serif);box-shadow:0 0 0 2px #D9B566,0 14px 30px -16px rgba(74,58,99,.5);white-space:nowrap}
.wk-door.c{margin:0 auto}
.wk-junc{align-content:end}
.wk-chips{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;position:relative}
/* 방 */
.wk-room{align-content:center;gap:var(--s-sm);padding-top:70px}
.rm-head{text-align:center;position:relative}
.rm-head h2{margin:0;font:600 clamp(26px,4.4vw,44px)/1.1 var(--mc-serif);color:var(--color-ink);outline:none}
.rm-head p{font:500 14px/1.3 var(--font-sans);color:var(--color-ink)}
.rm-strip{position:relative;width:100%;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:thin;padding:10px 0 6px}
.rm-strip:focus-visible{outline:3px solid var(--color-ink);outline-offset:-3px}
.rm-strip ul{list-style:none;margin:0 auto;padding:0 14vw;display:flex;gap:clamp(20px,4vw,56px);align-items:center;width:max-content}
@media (min-width:761px){.rm-strip ul{padding:0 6vw}}
.rm-strip li{position:relative;display:grid;justify-items:center;gap:10px;scroll-snap-align:center;flex:none}
.wk-room .wk-art :deep(.mat img){width:min(72vw,420px);height:auto;max-height:44vh;max-width:none;object-fit:contain}
@media (min-width:761px){.wk-room .wk-art :deep(.mat img){width:auto;height:min(40vh,330px);max-width:420px}}
@media (prefers-reduced-motion:reduce){.wk-stage::after{content:"";position:absolute;inset:0;z-index:4;pointer-events:none;background:radial-gradient(ellipse 70% 65% at 50% 52%,transparent 55%,rgba(74,58,99,.16) 100%)}
.at-gate .wk-stage::after{display:none}
.wk-bg.zoom{transform:none;transition:none}.wk-piece{animation:none}}
</style>
