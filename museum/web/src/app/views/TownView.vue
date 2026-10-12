<script setup lang="ts">
// 미술관 마을(D40, SD_02 §17-13 D, UC_16 BF4): 가족마다 건물 1채 — 내 건물 · 이웃 건물(문 열림, 아이 미술관 문) · 모르는 가족(겉모양만, 자물쇠).
// 끌어서 마을 밀기 · 방향키 · 건물 누르기 → 그 앞으로 + 로비 카드. 미니맵은 오른쪽 아래(내 건물 자두 · 이웃 하늘 · 그 밖 회색 · 지금 보는 곳 사각형).
// D53(SD_02 §17-19): HUD 버튼 · 로비 카드 · 미니맵 = 공통 게임 틀(game.css 금테 크림 알약 · 금테 양피지 패널). 마을 장면은 그대로.
// 3D 엔진 없음(CSS 아이소메트릭). 움직임 줄이기면 옮길 때 애니메이션 없음.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import CharacterAvatar from '@/app/character/CharacterAvatar.vue';
import MuseumBuilding from '@/app/character/MuseumBuilding.vue';
import { DEFAULT_COLOR, DEFAULT_KIND } from '@/app/character/names';
import { town as tc } from '@/app/town/copy';
import '@/styles/game.css';
import { centerOn, clampPan, layoutTown, museumPath, type PlacedBuilding, type TownBuildingDto, type TownLayout } from '@/app/town/layout';

const router = useRouter();
const state = ref<'loading' | 'ready' | 'error'>('loading');
const lay = ref<TownLayout>({ buildings: [], width: 0, height: 0, minX: 0, minY: 0 });
const view = ref({ w: 390, h: 600 });
const pan = ref({ x: 0, y: 0 });
const picked = ref<PlacedBuilding | null>(null);
const bigMap = ref(false);
const stage = ref<HTMLElement | null>(null);
const lobbyHead = ref<HTMLElement | null>(null);
const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const gliding = ref(false);

const mine = computed(() => lay.value.buildings.find((b) => b.relation === 'mine') ?? null);
const nameOf = (b: PlacedBuilding) => (b.relation === 'mine' ? tc.mine : b.relation === 'neighbor' ? tc.neighbor : tc.stranger);

function measure() {
  const el = stage.value;
  if (el) view.value = { w: el.clientWidth, h: el.clientHeight };
}
function setPan(p: { x: number; y: number }, glide = false) {
  gliding.value = glide && !reduce;
  pan.value = clampPan(p, view.value, { w: lay.value.width, h: lay.value.height });
}

async function load() {
  state.value = 'loading';
  try {
    const r = await api.get<{ buildings: TownBuildingDto[] }>('/v1/town');
    lay.value = layoutTown(r.buildings);
    state.value = 'ready';
    await nextTick();
    measure();
    if (mine.value) setPan(centerOn(mine.value, view.value));
  } catch { state.value = 'error'; }
}

async function pick(b: PlacedBuilding) {
  setPan(centerOn(b, { w: view.value.w, h: view.value.h * 0.8 }), true);
  picked.value = b;
  await nextTick();
  lobbyHead.value?.focus();
}
const enter = (b: PlacedBuilding, childId: string) => router.push(museumPath(childId, b.relation));

// 끌기(마우스 · 손가락) — 조금만 움직였으면 누르기로 본다
let drag: { id: number; sx: number; sy: number; px: number; py: number; moved: boolean } | null = null;
function down(e: PointerEvent) {
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, px: pan.value.x, py: pan.value.y, moved: false };
}
function move(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.sx; const dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  if (!drag.moved) { drag.moved = true; stage.value?.setPointerCapture?.(e.pointerId); }
  setPan({ x: drag.px + dx, y: drag.py + dy });
}
function up(e: PointerEvent) {
  if (drag?.moved) stage.value?.releasePointerCapture?.(e.pointerId);
  if (drag?.moved) { justDragged = true; setTimeout(() => { justDragged = false; }, 0); }
  drag = null;
}
/** 끌기 끝에 따라오는 click은 건물 누르기로 치지 않는다 */
let justDragged = false;
function clickBuilding(b: PlacedBuilding) {
  if (!justDragged) void pick(b);
}
function key(e: KeyboardEvent) {
  const step = 80;
  const d: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  const v = d[e.key];
  if (!v || (e.target as HTMLElement).closest('input,textarea')) return;
  e.preventDefault();
  setPan({ x: pan.value.x + v[0], y: pan.value.y + v[1] }, true);
}

// 미니맵: 판 전체를 작은 네모에 맞춘다
const MAP = computed(() => (bigMap.value ? 260 : 140));
const mapScale = computed(() => Math.min(MAP.value / Math.max(1, lay.value.width), MAP.value / Math.max(1, lay.value.height)));
const mapBox = computed(() => ({ w: lay.value.width * mapScale.value, h: lay.value.height * mapScale.value }));
const viewRect = computed(() => ({
  x: -pan.value.x * mapScale.value, y: -pan.value.y * mapScale.value,
  w: Math.min(view.value.w, lay.value.width) * mapScale.value, h: Math.min(view.value.h, lay.value.height) * mapScale.value,
}));
function mapClick(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = (e.clientX - r.left) / mapScale.value; const y = (e.clientY - r.top) / mapScale.value;
  setPan(centerOn({ cx: x, cy: y }, view.value), true);
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  void load();
  if (typeof ResizeObserver !== 'undefined' && stage.value) { ro = new ResizeObserver(() => { measure(); setPan(pan.value); }); ro.observe(stage.value); }
  window.addEventListener('keydown', key);
});
onBeforeUnmount(() => { ro?.disconnect(); window.removeEventListener('keydown', key); });
</script>

<template>
  <main class="town">
    <h1 class="sr-only">{{ tc.title }}</h1>
    <div
      ref="stage" class="stage" role="region" :aria-label="tc.sceneName"
      @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"
    >
      <p v-if="state === 'loading'" class="center t-body" role="status">{{ tc.loading }}</p>
      <div v-else-if="state === 'error'" class="center" role="alert"><div class="g-panel err stack-sm">
        <p class="t-body">{{ tc.unavailable }}</p>
        <button class="g-btn g-btn--primary" type="button" @click="load">{{ tc.retry }}</button>
      </div></div>
      <div
        v-else class="board" :class="{ glide: gliding }"
        :style="{ width: `${lay.width}px`, height: `${lay.height}px`, transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }"
        @transitionend="gliding = false"
      >
        <div class="ground" aria-hidden="true" />
        <div
          v-for="b in lay.buildings" :key="b.id" class="lot" :class="b.relation"
          :style="{ left: `${b.cx}px`, top: `${b.cy}px` }"
        >
          <span class="tile" aria-hidden="true" />
          <button
            class="bld" type="button" :aria-label="b.relation === 'stranger' ? `${nameOf(b)} — ${tc.locked}` : nameOf(b)"
            :aria-pressed="picked?.id === b.id" @click="clickBuilding(b)"
          >
            <MuseumBuilding :museum-style="b.style" :color="b.color" :size="170" :locked="b.relation === 'stranger'" decorative />
          </button>
          <div v-if="b.relation !== 'stranger'" class="sign" aria-hidden="true">
            <CharacterAvatar v-for="c in b.children.slice(0, 3)" :key="c.id" :kind="c.kind ?? DEFAULT_KIND" :color="c.color ?? DEFAULT_COLOR" :size="34" />
            <span class="sign-t">{{ b.relation === 'mine' ? tc.legendMine : b.children.map((c) => c.alias).join(' · ') || tc.legendNeighbor }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 위: 안내 · 오른쪽 위 버튼 -->
    <div class="hud-top">
      <p class="hint t-body-sm">{{ tc.hint }}</p>
      <div class="hud-acts">
        <button v-if="mine" class="g-btn g-btn--primary" type="button" @click="pick(mine)">{{ tc.toMine }}</button>
        <RouterLink class="g-btn" to="/app/family#neighbors">{{ tc.inviteNeighbor }}</RouterLink>
      </div>
    </div>

    <!-- 로비 카드: 누른 건물 -->
    <section v-if="picked" class="g-panel lobby" aria-labelledby="town-lobby-h">
      <h2 id="town-lobby-h" ref="lobbyHead" tabindex="-1" class="g-title lobby-h">{{ nameOf(picked) }}</h2>
      <p v-if="picked.relation === 'stranger'" class="t-body-sm">{{ tc.locked }}</p>
      <template v-else>
        <p class="t-body-sm">{{ tc.lobby(picked.children.length) }}</p>
        <ul class="doors">
          <li v-for="c in picked.children" :key="c.id">
            <button class="door" type="button" @click="enter(picked, c.id)">
              <CharacterAvatar :kind="c.kind ?? DEFAULT_KIND" :color="c.color ?? DEFAULT_COLOR" :size="56" />
              <span class="door-t">{{ tc.museumOf(c.alias) }}</span>
              <span class="door-go">{{ tc.enter }}</span>
            </button>
          </li>
        </ul>
        <p v-if="picked.relation === 'mine' && !picked.children.length" class="t-body-sm">
          {{ tc.noChildMine }} <RouterLink to="/app/children/new">{{ tc.addChild }}</RouterLink>
        </p>
      </template>
      <button class="g-btn g-btn--sm lobby-close" type="button" @click="picked = null">{{ tc.close }}</button>
    </section>

    <!-- 미니맵(오른쪽 아래) -->
    <nav v-if="state === 'ready' && lay.buildings.length" class="g-panel minimap" :aria-label="tc.minimap">
      <div class="map" :style="{ width: `${mapBox.w}px`, height: `${mapBox.h}px` }" aria-hidden="true" @click="mapClick">
        <span
          v-for="b in lay.buildings" :key="b.id" class="dot" :class="b.relation"
          :style="{ left: `${b.cx * mapScale}px`, top: `${b.cy * mapScale}px` }"
        />
        <span class="vr" :style="{ left: `${viewRect.x}px`, top: `${viewRect.y}px`, width: `${viewRect.w}px`, height: `${viewRect.h}px` }" />
      </div>
      <ul class="legend t-caption" aria-hidden="true">
        <li><span class="dot mine" />{{ tc.legendMine }}</li><li><span class="dot neighbor" />{{ tc.legendNeighbor }}</li><li><span class="dot stranger" />{{ tc.legendOther }}</li>
      </ul>
      <button class="g-btn g-btn--sm map-size" type="button" :aria-expanded="bigMap" @click="bigMap = !bigMap">{{ bigMap ? tc.minimapSmall : tc.minimapBig }}</button>
      <!-- 화면 읽기 · 키보드용 건물 목록 -->
      <ul class="sr-only" :aria-label="tc.buildingList">
        <li v-for="b in lay.buildings" :key="b.id"><button type="button" @click="pick(b)">{{ nameOf(b) }}</button></li>
      </ul>
    </nav>
  </main>
</template>

<style scoped>
.town{position:relative;height:calc(100dvh - 64px);min-height:480px;overflow:hidden;
  background:linear-gradient(#bfe6ff 0%,#e6f6ff 38%,#d9f2c9 38.1%,#c9eab5 100%)}
.stage{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;user-select:none}
.stage:active{cursor:grabbing}
.center{position:absolute;inset:0;display:grid;place-content:center;text-align:center;gap:var(--s-sm);padding:16px}
.err{padding:24px;justify-items:center}
.board{position:absolute;left:0;top:0;will-change:transform}
.board.glide{transition:transform .5s cubic-bezier(.2,.7,.2,1)}
.ground{position:absolute;inset:0;background:
  radial-gradient(circle at 20% 30%,rgba(255,255,255,.5) 0 2px,transparent 3px) 0 0/48px 48px,
  radial-gradient(circle at 70% 60%,rgba(120,180,90,.35) 0 2px,transparent 3px) 0 0/64px 64px}
.lot{position:absolute;width:0;height:0}
.tile{position:absolute;left:-130px;top:-65px;width:260px;height:130px;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);
  background:linear-gradient(135deg,#f4ecd8,#e8dcc0)}
.lot.mine .tile{background:linear-gradient(135deg,#fde4e8,#f6c7d4)}
.lot.neighbor .tile{background:linear-gradient(135deg,#e2f3ff,#bfe2fa)}
.bld{position:absolute;left:-85px;top:-150px;width:170px;height:170px;padding:0;border:0;background:none;cursor:pointer;border-radius:16px}
.bld:focus-visible{outline:3px solid var(--color-primary);outline-offset:4px}
.bld[aria-pressed="true"]{filter:drop-shadow(0 0 10px rgba(255,214,90,.9))}
.lot.stranger .bld{filter:saturate(.55) brightness(1.02)}
.sign{position:absolute;left:-90px;top:-178px;z-index:2;width:180px;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:2px;
  padding:4px 6px;border-radius:12px;border:1.5px solid var(--g-gold);background:rgba(251,244,230,.95);box-shadow:0 2px 0 var(--g-gold-soft),0 4px 8px rgba(74,52,65,.14)}
.sign-t{width:100%;text-align:center;font:700 13px/1.3 var(--g-serif);color:var(--g-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hud-top{position:absolute;left:16px;right:16px;top:12px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;pointer-events:none}
.hud-top>*{pointer-events:auto}
.hint{margin:0;align-self:flex-start;padding:8px 16px;border-radius:999px;border:1.5px solid var(--g-gold);background:rgba(251,244,230,.94);color:var(--g-ink);font-weight:600;max-width:520px;box-shadow:0 6px 14px -10px rgba(74,53,38,.45)}
.hud-acts{display:flex;gap:10px;flex-wrap:wrap;padding-bottom:3px}
.lobby{position:absolute;left:16px;bottom:16px;width:min(380px,calc(100% - 32px));max-height:60%;overflow:auto;display:grid;gap:var(--s-sm);padding:20px 18px 18px}
.lobby-h{font-size:22px}
.lobby-close{justify-self:start}
.doors{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.door{width:100%;display:grid;grid-template-columns:56px 1fr auto;align-items:center;gap:10px;padding:8px 12px;min-height:72px;
  border:1.5px solid var(--g-gold);border-radius:18px;background:linear-gradient(#fffdf6,#fbf1dc);cursor:pointer;text-align:left;
  box-shadow:0 3px 0 var(--g-gold-soft);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.door:active{transform:translateY(3px);box-shadow:0 0 0 var(--g-gold-soft);transition-duration:.05s}
.door:hover{transform:translateY(-1px)}
.door:focus-visible{outline:3px solid var(--g-plum-deep);outline-offset:3px}
.door-t{font:600 17px/1.3 var(--font-sans);color:var(--color-ink)}
.door-go{padding:8px 14px;border-radius:999px;background:linear-gradient(#ad557e,#93405f);border:1.5px solid var(--g-gold);font:700 15px/1 var(--font-sans);color:#fff8ec}
.minimap{position:absolute;right:16px;bottom:16px;display:grid;gap:8px;justify-items:end;padding:12px}
.map{position:relative;border-radius:10px;background:#d9f2c9;cursor:pointer;overflow:hidden;box-shadow:inset 0 0 0 1.5px var(--g-gold)}
.map .dot{position:absolute;transform:translate(-50%,-50%)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#b8b2ad}
.dot.mine{background:#a0496b;width:12px;height:12px}
.dot.neighbor{background:#4aa3df}
.vr{position:absolute;border:2px solid #4a3441;border-radius:3px;pointer-events:none}
.legend{letter-spacing:0;word-spacing:normal;list-style:none;margin:0;padding:0;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.legend li{display:flex;align-items:center;gap:4px}
.minimap .g-btn.map-size{font-size:14px}
.stack-sm{display:grid;gap:var(--s-sm)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-width:600px){
  .lobby{bottom:auto;top:64px}
  .hint{display:none}
}
@media (prefers-reduced-motion:reduce){.board.glide{transition:none}.door,.door:hover,.door:active{transition:none;transform:none}}
</style>
