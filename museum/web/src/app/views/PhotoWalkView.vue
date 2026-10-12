<script setup lang="ts">
// 홈 /app — 1인칭 고전 회랑(D33 이제민 결정, SD_02 §17-9). 시안 docs/C/louvre-walk/를 제품으로 옮김(엔진 walkphoto/engine.ts).
// 자유 라이선스 실사진을 편 조각(/museum/photos/manifest.json의 kind:"tip")을 CSS 3D로 세워 걷는다. 3D 엔진 없음, 미술관 이름 · 로고 없음.
// 나이 구역 = N살 전시실(입구 쪽이 최근). 두 번째 방문은 마지막 구역에서(walk/prefs.ts의 방문 기억). 크게 보기는 ArtViewer 그대로.
// 사진 목록을 못 읽으면 §17-6 걷는 미술관(WalkHomeView, SVG)으로 대신한다. 셸의 [올리기] · [목록] · [메뉴]는 MuseumBar(§17-8).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import type { BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import ArtFrame from '@/components/ArtFrame.vue';
import BlockNotice from '@/components/BlockNotice.vue';
import { ko } from '@/copy/ko';
import { blockOf } from '../artwork';
import ArtViewer from '../walk/ArtViewer.vue';
import WalkHomeView from './WalkHomeView.vue';
import { loadVisit, saveVisit } from '../walk/prefs';
import { PhotoCorridor, ZMAX, ZMIN, type Cam, type Hung, type TipNode, type WalkArt } from '../walkphoto/engine';

type Child = components['schemas']['Child'];
type Gallery = components['schemas']['Gallery'];
type Item = components['schemas']['GalleryItem'];

const route = useRoute();
const router = useRouter();
const children = ref<Child[] | null>(null);
const childId = ref(typeof route.query.child === 'string' ? route.query.child : '');
const g = ref<Gallery | null>(null);
const block = ref<Notice | null>(null);
const node = shallowRef<TipNode | null>(null);
const fallback = ref(false);
const vp = ref<HTMLElement | null>(null);
const eng = shallowRef<PhotoCorridor | null>(null);
const entered = ref(false);
const whereSec = shallowRef<{ age: number | null } | null>(null);
const near = shallowRef<Hung | null>(null);
const viewing = ref<Item | null>(null);
const planOpen = ref(false);
const cam = ref<Cam>({ x: 0, z: 0, yaw: 0, pitch: 0, P: 1000 });
const top = ref(64);
let opener: HTMLElement | null = null;
/** 걸리는 장면(D34 ⑤): 무대(액자에 담는 중 → 걸었어요) → 날아가 벽에 걸림 → 권유 */
const stage = ref<{ src: string | null; step: 1 | 2; framed: boolean; out: boolean } | null>(null);
const suggest = ref(false);
let suggestTimer = 0;

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const alias = computed(() => children.value?.find((c) => c.id === childId.value)?.alias ?? '');
const groups = computed(() => (g.value?.groups ?? []).map((r) => ({ age: (r.ageAtMaking as number | null) ?? null, items: r.items })));
const all = computed(() => groups.value.flatMap((r) => r.items));
function still(it: Item) { return (it.kind === 'frame' ? it.photoUrl ?? it.originalUrl : it.kind === 'relief' ? it.auxUrl ?? it.originalUrl : it.posterUrl ?? it.photoUrl ?? it.originalUrl) ?? null; }
const where = computed(() => (!entered.value ? ko.photo.atGate : whereSec.value ? ko.photo.room(whereSec.value.age) : ko.photo.atHall));
const touch = matchMedia('(hover: none), (pointer: coarse)').matches;

// ---- 불러오기 ----
async function loadManifest() {
  try {
    const r = await fetch('/museum/photos/manifest.json', { credentials: 'same-origin' });
    const m = (await r.json()) as { nodes?: TipNode[] };
    const n = m.nodes?.find((x) => x.kind === 'tip' && x.faces?.length);
    if (!n) throw new Error('no tip node');
    node.value = n;
  } catch { fallback.value = true; } // 사진이 없으면 §17-6 걷는 미술관
}
async function loadGallery() {
  if (!childId.value) return;
  try { g.value = await api.get<Gallery>('/v1/gallery', { query: { child: childId.value } }); block.value = null; } catch (e) { block.value = blockOf(e); }
}
onMounted(async () => {
  measure(); window.addEventListener('resize', measure);
  const [, kids] = await Promise.all([loadManifest(), api.get<Child[]>('/v1/children').catch((e) => { block.value = blockOf(e); return null; })]);
  children.value = kids;
  if (kids && !kids.some((c) => c.id === childId.value)) childId.value = kids[0]?.id ?? ''; else void loadGallery();
  if (kids && !kids.length) g.value = { childId: '', groups: [] };
});
watch(childId, (id) => { if (id) { void router.replace({ query: { ...route.query, child: id } }); void loadGallery(); } });

// ---- 엔진 ----
const artsOf = () => groups.value.map((r) => ({ age: r.age, items: r.items.map<WalkArt>((it) => ({ id: it.id, title: it.title, age: it.ageAtMaking, madeOn: it.madeOn, src: still(it) })) }));
const labels = { banner: ko.photo.banner, art: ko.photo.art, plaque: (d: string, a: number) => `${d.replace(/-/g, '.')} · ${a}살` };
let lastCam = 0;
watch([node, vp], async () => {
  if (!node.value || !vp.value || eng.value) return;
  await nextTick();
  const base = `/museum/photos/${node.value.id}/${Math.min(window.innerWidth, window.innerHeight) < 761 ? 'mobile' : 'desktop'}`;
  eng.value = new PhotoCorridor(vp.value, node.value, base, reduce, {
    onNear: (a) => { near.value = a; },
    onWhere: (sec) => { whereSec.value = sec; if (sec?.age != null && childId.value) saveVisit(childId.value, sec.age); },
    onOpen: (a) => openById(a.art.id),
    onFrame: (c) => { const t = performance.now(); if (t - lastCam > 90) { lastCam = t; cam.value = { ...c }; } },
  });
  if (g.value) place();
});
watch(g, () => { if (eng.value) place(); });
/** 작품을 걸고 시작 자리: 두 번째 방문이면 마지막 구역 앞(입구 연출 없이) */
function place() {
  const e = eng.value!; e.hangAll(artsOf(), labels);
  const hung = typeof route.query.hung === 'string' ? route.query.hung : '';
  if (hung && all.value.some((x) => x.id === hung)) { void playHang(hung); return; }
  const v = childId.value ? loadVisit(childId.value) : null;
  if (v && !e.entered) { e.goToSection(v.room, true); entered.value = true; }
}
onBeforeUnmount(() => { eng.value?.dispose(); window.removeEventListener('resize', measure); clearTimeout(suggestTimer); });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function playHang(id: string) {
  const e = eng.value; const it = all.value.find((x) => x.id === id); if (!e || !it) return;
  entered.value = true;
  const q = { ...route.query }; delete q.hung; void router.replace({ query: q }); // 새로고침하면 다시 재생하지 않게
  if (reduce()) { await e.land(id); showSuggest(); return; }
  e.enter(true);
  stage.value = { src: still(it), step: 1, framed: false, out: false };
  await wait(700); if (stage.value) stage.value.framed = true;
  await wait(1300); if (stage.value) stage.value.step = 2;
  await wait(600); if (stage.value) stage.value.out = true;
  const landing = e.land(id);
  await wait(900); stage.value = null;
  await landing; showSuggest();
}
function showSuggest() { suggest.value = true; clearTimeout(suggestTimer); suggestTimer = window.setTimeout(() => { suggest.value = false; }, 12000); }
function enter() {
  if (!eng.value) return;
  if (childId.value && !loadVisit(childId.value)) saveVisit(childId.value, null);
  eng.value.enter(reduce()); entered.value = true;
  setTimeout(() => document.querySelector<HTMLElement>('.pw-nx')?.focus({ preventScroll: true }), 400);
}
function skip() { const v = childId.value ? loadVisit(childId.value) : null; eng.value?.goToSection(v?.room ?? null, reduce()); entered.value = true; }
function step(d: 1 | -1) { eng.value?.step(d); entered.value = true; }

// ---- 크게 보기 · 안내도 ----
function openById(id: string) { const it = all.value.find((x) => x.id === id); if (it) { opener = document.activeElement as HTMLElement | null; viewing.value = it; } }
async function closeViewer() { viewing.value = null; await nextTick(); opener?.focus(); }
async function openPlan() { opener = document.activeElement as HTMLElement | null; planOpen.value = true; await nextTick(); document.querySelector<HTMLElement>('.pw-plan-close')?.focus(); }
async function closePlan() { planOpen.value = false; await nextTick(); opener?.focus(); }
function planGo(a: Hung) { planOpen.value = false; eng.value?.goTo(a); entered.value = true; }
function onKey(e: KeyboardEvent) {
  if (viewing.value) return;
  if (planOpen.value && e.key === 'Escape') { e.preventDefault(); void closePlan(); return; }
  if (e.key.toLowerCase() === 'm' && entered.value && !(e.target as HTMLElement)?.closest?.('input, select, textarea')) void openPlan();
  if (!entered.value && (e.key === 'Enter') && (e.target === document.body)) { e.preventDefault(); enter(); }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

// ---- 안내도(평면도) ----
const plan = computed(() => {
  const n = node.value; const e = eng.value; if (!n || !e) return null;
  void g.value; // 작품이 바뀌면 다시
  const { xl, xr } = n.box; const W = xr - xl; const topZ = ZMAX + 4; const bot = ZMIN - 6;
  return { vb: `${xl - 1} ${-topZ - 1} ${W + 2} ${topZ - bot + 2}`, xl, xr, W, topZ, bot, sections: e.sections, arts: e.arts };
});
const fov = computed(() => {
  const c = cam.value; const y = (c.yaw * Math.PI) / 180; const fx = -Math.sin(y); const fz = Math.cos(y); const a = 0.5; const L = 9;
  const l = [fx * Math.cos(a) - fz * Math.sin(a), fx * Math.sin(a) + fz * Math.cos(a)]; const r = [fx * Math.cos(-a) - fz * Math.sin(-a), fx * Math.sin(-a) + fz * Math.cos(-a)];
  const X = c.x; const Z = -Math.max(c.z, ZMIN - 5);
  return { X, Z, d: `M${X} ${Z} L${X + l[0]! * L} ${Z - l[1]! * L} L${X + r[0]! * L} ${Z - r[1]! * L} Z` };
});

// ---- 조이스틱(터치) ----
const stickEl = ref<HTMLElement | null>(null);
const knob = ref({ x: 0, y: 0 });
let sp: number | null = null;
function stickMove(e: PointerEvent) {
  const r = stickEl.value!.getBoundingClientRect(); const dx = e.clientX - (r.left + r.width / 2); const dy = e.clientY - (r.top + r.height / 2);
  const m = Math.min(1, Math.hypot(dx, dy) / 40); const a = Math.atan2(dy, dx);
  const v = { x: Math.cos(a) * m, y: Math.sin(a) * m }; knob.value = v; eng.value?.setStick(v.x, v.y);
}
function stickDown(e: PointerEvent) { if (!entered.value) enter(); sp = e.pointerId; stickEl.value?.setPointerCapture(sp); stickMove(e); }
function stickUp() { sp = null; knob.value = { x: 0, y: 0 }; eng.value?.setStick(0, 0); }

// ---- 장면 높이(셸 머리 아래) ----
const rootEl = ref<HTMLElement | null>(null);
function measure() { const r = rootEl.value?.getBoundingClientRect(); if (r) top.value = Math.max(0, r.top + window.scrollY); }
</script>

<template>
  <WalkHomeView v-if="fallback" />
  <main v-else ref="rootEl" class="pw" :class="{ entered }" :style="{ '--pw-top': `${top}px` }">
    <div ref="vp" class="pw-vp" role="region" :aria-label="ko.photo.scene"></div>
    <div class="pw-vig" aria-hidden="true"></div>
    <div class="pw-grain" aria-hidden="true"></div>
    <div class="pw-veil" :class="{ off: entered }" aria-hidden="true"></div>
    <div v-if="block" class="pw-block"><BlockNotice :notice="block" @action="loadGallery" /></div>

    <!-- 위 가운데: 지금 위치 -->
    <div class="pw-shell pw-island" aria-live="polite"><div class="pw-core"><p>{{ where }}</p></div></div>
    <!-- 왼쪽 위: 안내도 -->
    <div v-if="entered && plan" class="pw-shell pw-mapbox">
      <button class="pw-core" type="button" :aria-label="ko.photo.map" @click="openPlan">
        <svg :viewBox="plan.vb" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect :x="plan.xl" :y="-plan.topZ" :width="plan.W" :height="plan.topZ - plan.bot" rx=".6" fill="#F4EDE2" stroke="#C9A552" stroke-width=".35" />
          <line v-for="s in plan.sections" :key="String(s.age)" :x1="plan.xl" :x2="plan.xr" :y1="-(s.z0 - 1)" :y2="-(s.z0 - 1)" stroke="#C9A552" stroke-width=".25" stroke-dasharray=".6 .5" />
          <circle v-for="(a, i) in plan.arts" :key="i" :cx="a.x" :cy="-a.z" r=".9" fill="#A0496B" />
          <path :d="fov.d" fill="#A0496B" opacity=".25" /><circle :cx="fov.X" :cy="fov.Z" r="1.1" fill="#6E3550" stroke="#fff" stroke-width=".4" />
        </svg>
      </button>
    </div>
    <!-- 오른쪽 위: 건너뛰기 -->
    <div class="pw-shell pw-tools"><div class="pw-core">
      <button class="pw-ico" type="button" :aria-label="ko.photo.skip" :title="ko.photo.skip" @click="skip">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l6 6-6 6M12 6l6 6-6 6" /></svg>
      </button>
    </div></div>

    <!-- 입구 제목 -->
    <section class="pw-title" :class="{ off: entered }" aria-labelledby="pw-h1">
      <div class="pw-title-in">
        <span class="pw-eyebrow">{{ ko.museum.name }}</span>
        <h1 id="pw-h1">{{ alias ? ko.museum.hall(alias) : ko.museum.name }}</h1>
        <p>{{ ko.photo.intro }}</p>
        <button class="pw-cta" type="button" :disabled="!eng" @click="enter">{{ ko.photo.enter }}
          <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8" /></svg></span></button>
      </div>
    </section>

    <!-- 작품 0개 -->
    <div v-if="entered && g && !all.length" class="pw-empty">
      <ArtFrame size="md" variant="gold" />
      <h2>{{ ko.museum.emptyTitle }}</h2>
      <RouterLink class="btn btn-primary" :to="children?.length ? '/app/upload' : '/app/children'">{{ ko.museum.upload }}</RouterLink>
    </div>

    <!-- 아래: 가까운 작품 알림 · 다음 작품 · 조이스틱 -->
    <div v-if="near" class="pw-shell pw-prompt on">
      <button class="pw-core" type="button" @click="near && openById(near.art.id)">
        <kbd aria-hidden="true">E</kbd><span><b>{{ near.art.title }}</b><small>{{ ko.photo.near(near.art.madeOn.replace(/-/g, '.'), near.art.age) }}</small></span>
      </button>
    </div>
    <div v-if="all.length" class="pw-shell pw-next"><div class="pw-core">
      <button class="pw-pv" type="button" :aria-label="ko.photo.prev" @click="step(-1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg></button>
      <button class="pw-nx" type="button" @click="step(1)">{{ ko.photo.next }} <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span></button>
    </div></div>
    <div v-if="touch" ref="stickEl" class="pw-stick" aria-hidden="true" @pointerdown="stickDown" @pointermove="(e) => sp === e.pointerId && stickMove(e)" @pointerup="stickUp" @pointercancel="stickUp">
      <i :style="{ transform: `translate(${knob.x * 32}px,${knob.y * 32}px)` }"></i>
    </div>
    <p v-else-if="entered" class="pw-keys" aria-hidden="true">{{ ko.photo.keys }}</p>
    <p v-if="node" class="pw-credit">
      <a :href="node.source" target="_blank" rel="noopener">{{ ko.photo.credit(node.author, node.license) }}</a>
    </p>

    <!-- 큰 안내도 -->
    <div v-if="planOpen && plan" class="pw-modal" @click.self="closePlan">
      <div class="pw-shell pw-modal-box" role="dialog" aria-modal="true" aria-labelledby="pw-plan-t"><div class="pw-core">
        <h3 id="pw-plan-t">{{ ko.photo.mapTitle }}</h3>
        <svg class="pw-plan" :viewBox="plan.vb" role="img" :aria-label="ko.photo.mapTitle">
          <rect :x="plan.xl" :y="-plan.topZ" :width="plan.W" :height="plan.topZ - plan.bot" rx=".6" fill="#F4EDE2" stroke="#C9A552" stroke-width=".35" />
          <g v-for="s in plan.sections" :key="String(s.age)">
            <line :x1="plan.xl" :x2="plan.xr" :y1="-(s.z0 - 1)" :y2="-(s.z0 - 1)" stroke="#C9A552" stroke-width=".25" stroke-dasharray=".6 .5" />
            <text :x="(plan.xl + plan.xr) / 2" :y="-(s.z0 + 3)" text-anchor="middle" font-size="2.2" font-weight="700" fill="#6E3550">{{ ko.photo.room(s.age) }}</text>
          </g>
          <text :x="(plan.xl + plan.xr) / 2" :y="-(plan.bot + 1.2)" text-anchor="middle" font-size="2" fill="#2A1F1A">{{ ko.photo.entrance }}</text>
          <path :d="fov.d" fill="#A0496B" opacity=".25" /><circle :cx="fov.X" :cy="fov.Z" r="1.1" fill="#6E3550" stroke="#fff" stroke-width=".4" />
        </svg>
        <ul class="pw-plan-list">
          <li v-for="(a, i) in plan.arts" :key="i"><button type="button" class="pw-plan-art" @click="planGo(a)">{{ ko.photo.room(a.art.age) }} · {{ a.art.title }}</button></li>
        </ul>
        <p>{{ ko.photo.mapNote }}</p>
        <button class="pw-close pw-plan-close" type="button" @click="closePlan">{{ ko.walk.close }}</button>
      </div></div>
    </div>

    <!-- 걸리는 장면 무대(D34 ⑤) -->
    <div v-if="stage" class="pw-stage" :class="{ out: stage.out }">
      <p class="pw-step" aria-live="polite">{{ stage.step === 1 ? ko.photo.hangFraming : ko.photo.hangDone }}</p>
      <div class="pw-dots" aria-hidden="true"><i class="on"></i><i class="on"></i><i :class="{ on: stage.step === 2 }"></i></div>
      <div class="pw-work" :class="{ framed: stage.framed, fly: stage.out }"><img v-if="stage.src" :src="stage.src" alt=""></div>
    </div>
    <!-- 권유: 움직이게 · 입체로는 걸린 뒤 바꿔 만들기 API(D34 ②) 뒤에 보인다 -->
    <div v-if="suggest" class="pw-shell pw-suggest" role="status"><div class="pw-core">
      <span>{{ ko.photo.suggest }}</span>
      <button type="button" class="no" @click="suggest = false">{{ ko.photo.suggestNo }}</button>
    </div></div>

    <ArtViewer v-if="viewing" :item="viewing" :alias="alias" :still="still(viewing)" @close="closeViewer" />
  </main>
</template>

<style scoped>
.pw{--cream:#FDFBF7;--pw-ink:#2A1F1A;--plum:#6E3550;--gold:#C9A552;--gold-l:#E6CB86;--gold-d:#8E6B2A;--glass:rgba(253,251,247,.8);--spring:cubic-bezier(.32,.72,0,1);
  position:relative;height:max(540px,calc(100dvh - var(--pw-top)));overflow:hidden;background:#2B231D;color:var(--pw-ink)}
.pw-vp{position:absolute;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;background:radial-gradient(ellipse at 50% 40%,#5a4a3e,#2B231D 70%)}
.pw-vig{position:absolute;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse 85% 80% at 50% 46%,rgba(20,12,8,0) 55%,rgba(20,12,8,.5))}
.pw-grain{position:absolute;inset:0;pointer-events:none;z-index:6;opacity:.07;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.pw-veil{position:absolute;inset:0;z-index:7;pointer-events:none;background:linear-gradient(180deg,rgba(43,35,29,.55),rgba(43,35,29,.15) 40%,rgba(43,35,29,.7));transition:opacity 1.4s var(--spring)}
.pw-veil.off{opacity:0}
.pw-block{position:absolute;top:70px;left:16px;right:16px;z-index:12}
.pw-shell{padding:5px;border-radius:22px;background:rgba(253,251,247,.28);box-shadow:0 0 0 1px rgba(255,255,255,.35),0 18px 40px -22px rgba(20,12,8,.7);backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2)}
.pw-core{border-radius:17px;background:var(--glass);box-shadow:inset 0 1px 1px rgba(255,255,255,.7);color:var(--pw-ink)}
.pw-island{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:8;border-radius:999px}
.pw-island .pw-core{border-radius:999px;padding:9px 18px}
.pw-island p{margin:0;font:700 15px/1 var(--mc-serif,serif);white-space:nowrap;color:var(--plum)}
.pw-mapbox{position:absolute;left:14px;top:14px;z-index:8}
.pw-mapbox .pw-core{width:84px;height:132px;padding:6px;cursor:pointer;display:block;border:0}
.pw-mapbox svg{width:100%;height:100%;display:block}
.pw-tools{position:absolute;right:14px;top:14px;z-index:8;border-radius:28px}
.pw-tools .pw-core{border-radius:23px;display:flex;flex-direction:column;padding:4px}
.pw-ico{width:44px;height:44px;border:0;border-radius:50%;background:none;display:grid;place-items:center;cursor:pointer}
.pw-ico svg{width:21px;height:21px;fill:none;stroke:var(--pw-ink);stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}
.pw :focus-visible{outline:2px solid var(--plum);outline-offset:3px}
.pw-title{position:absolute;inset:0;z-index:9;display:grid;place-items:center;text-align:center;padding:24px;pointer-events:none;transition:opacity 1s var(--spring),transform 1.2s var(--spring)}
.pw-title.off{opacity:0;transform:translateY(-24px) scale(.98);visibility:hidden}
.pw-title-in{display:grid;justify-items:center;gap:14px;pointer-events:auto}
.pw-eyebrow{font:700 11px/1 var(--font-sans);letter-spacing:.2em;color:var(--cream);border:1px solid rgba(253,251,247,.45);border-radius:999px;padding:7px 12px;background:rgba(42,31,26,.3)}
.pw-title h1{margin:0;font:700 clamp(36px,9vw,80px)/1.08 var(--mc-serif,serif);color:var(--cream);text-shadow:0 2px 30px rgba(0,0,0,.5)}
.pw-title p{margin:0;color:rgba(253,251,247,.92);font:500 15px/1.6 var(--font-sans);text-shadow:0 1px 10px rgba(0,0,0,.5)}
.pw-cta{margin-top:10px;display:inline-flex;align-items:center;gap:14px;padding:8px 8px 8px 26px;border:0;border-radius:999px;cursor:pointer;min-height:56px;
  background:var(--cream);color:var(--pw-ink);font:700 17px/1 var(--font-sans);box-shadow:0 0 0 1px rgba(255,255,255,.6),0 24px 40px -20px rgba(0,0,0,.8)}
.pw-cta:disabled{opacity:.6;cursor:progress}
.pw-cta span{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--plum);color:var(--cream)}
.pw-cta svg,.pw-next svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.pw-empty{position:absolute;inset:0;z-index:9;display:grid;place-content:center;justify-items:center;gap:14px;text-align:center;pointer-events:none}
.pw-empty > *{pointer-events:auto}
.pw-empty h2{font:700 22px/1.35 var(--font-sans);color:var(--cream);text-shadow:0 1px 12px rgba(0,0,0,.6)}
.pw-prompt{position:absolute;left:50%;bottom:20px;z-index:8;transform:translate(-50%,24px);opacity:0;pointer-events:none;transition:opacity .6s var(--spring),transform .8s var(--spring);max-width:calc(100% - 220px);border-radius:20px}
.pw-prompt.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.pw-prompt .pw-core{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:15px;cursor:pointer;border:0;text-align:left;width:100%;background:linear-gradient(135deg,#EFD9A2,#CFAE5E 55%,#B08D3E)}
.pw-prompt b{display:block;font:700 16px/1.25 var(--mc-serif,serif);color:#2B2007}
.pw-prompt small{font:500 12px/1.3 var(--font-sans);color:#3B2C0B}
.pw-prompt kbd{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:rgba(253,251,247,.85);font:700 12px/1 var(--font-sans);color:var(--pw-ink)}
.pw-next{position:absolute;right:14px;bottom:18px;z-index:8;border-radius:999px}
.pw-next .pw-core{border-radius:999px;display:flex;gap:4px;padding:4px}
.pw-next button{border:0;cursor:pointer;display:inline-flex;align-items:center;gap:10px;border-radius:999px;font:700 14px/1 var(--font-sans)}
.pw-pv{width:44px;height:44px;justify-content:center;background:none;color:var(--pw-ink)}
.pw-nx{padding:6px 6px 6px 16px;height:44px;background:var(--plum);color:var(--cream)}
.pw-nx span{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:rgba(253,251,247,.16)}
.pw-stick{position:absolute;left:16px;bottom:16px;z-index:8;width:108px;height:108px;border-radius:50%;touch-action:none;background:radial-gradient(circle,rgba(253,251,247,.12),rgba(253,251,247,.34));box-shadow:0 0 0 1px rgba(255,255,255,.5);backdrop-filter:blur(6px)}
.pw-stick i{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:var(--cream);box-shadow:0 8px 16px -8px rgba(0,0,0,.6)}
.pw-keys{position:absolute;left:14px;bottom:16px;z-index:8;margin:0;pointer-events:none;font:500 12px/1.7 var(--font-sans);color:rgba(253,251,247,.92);text-shadow:0 1px 6px rgba(0,0,0,.6)}
@media (max-width:900px){.pw-keys{display:none}}
.pw-credit{position:absolute;right:14px;bottom:78px;z-index:8;margin:0;font:500 11px/1.3 var(--font-sans);text-align:right}
.pw-credit a{color:rgba(253,251,247,.92);text-shadow:0 1px 6px rgba(0,0,0,.7)}
@media (max-width:600px){
  .pw-prompt{bottom:136px;max-width:calc(100% - 32px);width:calc(100% - 32px)}
  .pw-credit{left:14px;right:auto;bottom:auto;top:160px;text-align:left;max-width:130px}
}
.pw-stage{position:absolute;inset:0;z-index:15;display:grid;place-items:center;align-content:center;gap:18px;padding:24px;background:radial-gradient(ellipse at 50% 45%,rgba(43,35,29,.55),rgba(24,16,12,.88));transition:opacity .8s var(--spring)}
.pw-stage.out{opacity:0}
.pw-step{margin:0;font:700 22px/1.2 var(--mc-serif,serif);color:var(--cream);text-align:center}
.pw-dots{display:flex;gap:8px;justify-content:center}.pw-dots i{width:8px;height:8px;border-radius:50%;background:rgba(253,251,247,.3);transition:background .5s,transform .5s var(--spring)}.pw-dots i.on{background:var(--gold-l);transform:scale(1.25)}
.pw-work{width:min(80vw,520px);aspect-ratio:4/3;display:grid;place-items:center;transition:transform 1s var(--spring)}
.pw-work img{max-width:100%;max-height:100%;display:block;background:#fff;box-shadow:0 24px 50px -20px rgba(0,0,0,.8);transition:padding 1s var(--spring),background 1s var(--spring),box-shadow 1s var(--spring)}
.pw-work.framed img{padding:14px;background:linear-gradient(135deg,var(--gold-l),var(--gold) 38%,var(--gold-d) 62%,var(--gold-l));box-shadow:inset 0 0 0 12px #FBF8F1,0 30px 60px -20px rgba(0,0,0,.85)}
.pw-work.fly{transform:translateY(-12vh) scale(.35);opacity:0;transition:transform 1.1s var(--spring),opacity 1.1s ease}
.pw-suggest{position:absolute;left:50%;top:70px;transform:translateX(-50%);z-index:9;border-radius:999px}
.pw-suggest .pw-core{border-radius:999px;display:flex;gap:10px;align-items:center;padding:6px 6px 6px 16px;font:600 14px/1.2 var(--font-sans);white-space:nowrap}
.pw-suggest button{border:0;border-radius:999px;padding:9px 14px;min-height:40px;cursor:pointer;font:700 13px/1 var(--font-sans);background:var(--plum);color:var(--cream)}
.pw-suggest button.no{background:none;color:var(--pw-ink);box-shadow:inset 0 0 0 1px rgba(42,31,26,.25)}
@media (max-width:600px){.pw-suggest{top:auto;bottom:200px}}
.pw-modal{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:16px;background:rgba(24,16,12,.62);backdrop-filter:blur(10px)}
.pw-modal-box{width:min(94vw,560px);max-height:92vh;overflow:auto;border-radius:32px}
.pw-modal-box .pw-core{border-radius:27px;padding:22px;display:grid;gap:14px;background:var(--cream)}
.pw-modal h3{margin:0;font:700 22px/1.25 var(--mc-serif,serif);color:var(--plum)}
.pw-plan{width:100%;height:auto;max-height:46vh}
.pw-plan-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.pw-plan-art{border:1px solid rgba(42,31,26,.15);border-radius:999px;background:#fff;padding:8px 12px;min-height:40px;font:500 13px/1.2 var(--font-sans);color:var(--pw-ink);cursor:pointer}
.pw-modal p{margin:0;font:500 13px/1.6 var(--font-sans);color:var(--pw-ink)}
.pw-close{justify-self:end;padding:10px 18px;border:0;border-radius:999px;background:var(--pw-ink);color:var(--cream);font:700 14px/1 var(--font-sans);cursor:pointer;min-height:44px}
@media (prefers-reduced-motion:reduce){.pw *{transition:none!important;animation:none!important}}
</style>

<style>
/* 엔진이 만드는 3D 요소(scoped 밖) — 시안 docs/C/louvre-walk/ 그대로 */
.pw-world{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d;will-change:transform}
.pw-pl{position:absolute;left:0;top:0;backface-visibility:hidden;background-size:100% 100%;background-repeat:no-repeat}
.pw-pl.pw-two{backface-visibility:visible}
.pw-entry{background:linear-gradient(#EDE6DC,#D9CFC2)}
.pw-vp:not(.pw-in) .pw-post{visibility:hidden}
.pw-art{padding:0;border:0;background:none;cursor:pointer}
.pw-art .pw-glow{position:absolute;left:-70%;right:-70%;top:-95%;bottom:-35%;pointer-events:none;background:radial-gradient(ellipse 42% 55% at 50% 34%,rgba(255,238,200,.55),rgba(255,238,200,0) 70%)}
.pw-art .pw-fr{position:absolute;inset:0;padding:7px;border-radius:1px;background:linear-gradient(135deg,#E6CB86,#C9A552 38%,#8E6B2A 62%,#E6CB86);box-shadow:0 1px 0 rgba(255,255,255,.4) inset,0 22px 30px -18px rgba(20,12,8,.8)}
.pw-art .pw-mat{display:block;width:100%;height:100%;padding:8px;background:#FBF8F1;box-shadow:inset 0 0 0 1px rgba(142,107,42,.45),inset 0 6px 10px -6px rgba(0,0,0,.25)}
.pw-art img{width:100%;height:100%;display:block;object-fit:contain;background:#fff}
.pw-art.pw-landing{transition:transform 1.5s cubic-bezier(.2,.9,.25,1.08)}
.pw-art.pw-landing .pw-glow{opacity:0}.pw-art .pw-glow{transition:opacity 1.2s ease .9s}
.pw-art.pw-near .pw-fr{box-shadow:0 0 0 2px rgba(255,248,230,.95),0 0 60px 10px rgba(255,226,160,.55),0 22px 30px -18px rgba(20,12,8,.8)}
.pw-art:focus-visible .pw-fr{outline:4px solid #fff;outline-offset:4px}
.pw-plaque{display:flex;flex-direction:column;justify-content:center;padding:2px 4px;border-radius:1px;white-space:nowrap;overflow:hidden;background:linear-gradient(135deg,#E9D39A,#C9A552 55%,#A98435);color:#2B2007;font:500 4.2px/1.3 sans-serif;box-shadow:0 3px 5px -3px rgba(0,0,0,.5)}
.pw-plaque b{font:700 5.8px/1.2 serif;overflow:hidden;text-overflow:ellipsis}
.pw-banner{display:grid;place-items:center;text-align:center;color:#FDFBF7;background:linear-gradient(#7A3B57,#5E2C43);box-shadow:0 30px 40px -24px rgba(0,0,0,.7);border-top:10px solid #C9A552;padding:10px 12px;font:700 28px/1.2 serif;white-space:nowrap}
</style>
