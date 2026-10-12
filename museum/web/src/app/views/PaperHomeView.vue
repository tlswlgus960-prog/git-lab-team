<script setup lang="ts">
// 홈 /app — 아날로그 감성의 현대 디스플레이(SD_02 §17-3, D26 ⑥ 확정). 전시실은 /app/hall(§17-4).
// 파낸 모서리 첫 화면(최근 작품 매트 액자 + 마스킹테이프) → 강조색 숫자 줄 → 원통으로 휜 폴라로이드 작품 줄 → 모듈 패널.
// 데이터는 전시실(MuseumView)과 같다: GET /v1/children · /v1/gallery · /v1/artworks. 카드를 누르면 전시실의 작품 앞(/app/hall?art=).
// 색은 paper.css(--paper-*)만 — 아이보리 · 블러시 · 빨강 한 계열(D26 ⑤). 3D 엔진·외부 이미지 없음(CSS rotateY · scale). 움직임 줄이기면 전환 애니메이션만 끈다.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import type { BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import BlockNotice from '@/components/BlockNotice.vue';
import { ko } from '@/copy/ko';
import { blockOf, type ArtworkSummary } from '../artwork';

type Child = components['schemas']['Child'];
type Gallery = components['schemas']['Gallery'];
type Item = components['schemas']['GalleryItem'];

const route = useRoute();
const router = useRouter();
const children = ref<Child[] | null>(null);
const childId = ref(typeof route.query.child === 'string' ? route.query.child : '');
const g = ref<Gallery | null>(null);
const preparing = ref(0);
const block = ref<Notice | null>(null);

const alias = computed(() => children.value?.find((c) => c.id === childId.value)?.alias ?? '');
const rooms = computed(() => g.value?.groups ?? []);
const all = computed(() => rooms.value.flatMap((r) => r.items));
const byDate = computed(() => [...all.value].sort((a, b) => a.madeOn.localeCompare(b.madeOn)));
const latest = computed(() => byDate.value[byDate.value.length - 1] ?? null);
const first = computed(() => byDate.value[0] ?? null);
const lastWords = computed(() => [...byDate.value].reverse().find((it) => it.childWords)?.childWords ?? '');

function still(it: Item) { return it.kind === 'frame' ? it.photoUrl ?? it.originalUrl : it.kind === 'relief' ? it.auxUrl ?? it.originalUrl : it.posterUrl ?? it.photoUrl ?? it.originalUrl; }

async function load() {
  if (!childId.value) return;
  try {
    const [gal, list] = await Promise.all([
      api.get<Gallery>('/v1/gallery', { query: { child: childId.value } }),
      api.get<ArtworkSummary[]>('/v1/artworks', { query: { child: childId.value } }).catch(() => [] as ArtworkSummary[]),
    ]);
    g.value = gal; preparing.value = list.filter((a) => a.state !== 'exhibited').length; block.value = null;
    await nextTick(); measure();
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

// ---- 원통으로 휜 작품 줄: 가운데에서 떨어진 정도(--d)로 기울기·크기를 정한다 ----
const reel = ref<HTMLElement | null>(null);
const active = ref(0);
let raf = 0;
function measure() {
  const el = reel.value;
  if (!el) return;
  const mid = el.scrollLeft + el.clientWidth / 2;
  let best = 0; let bestD = Infinity;
  el.querySelectorAll<HTMLElement>('.rc').forEach((c, i) => {
    const w = c.offsetWidth || 1;
    const d = Math.max(-3, Math.min(3, (c.offsetLeft + w / 2 - mid) / w));
    c.style.setProperty('--d', d.toFixed(3));
    c.style.setProperty('--ad', Math.abs(d).toFixed(3));
    if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = i; }
  });
  active.value = best;
}
function onScroll() { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); }
function go(i: number) {
  const el = reel.value;
  const c = el?.querySelectorAll<HTMLElement>('.rc')[i];
  if (!el || !c) return;
  el.scrollTo({ left: c.offsetLeft + c.offsetWidth / 2 - el.clientWidth / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
onMounted(() => window.addEventListener('resize', onScroll));
onBeforeUnmount(() => { window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf); });
/** 빨간 가는 선 문양(스피로그래프 — 장식, SD_02 §17-3 재료) */
function spiro(R: number, r: number, d: number, turns: number) {
  const pts: string[] = [];
  for (let t = 0; t <= Math.PI * 2 * turns; t += 0.04) {
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    pts.push(`${(x + 110).toFixed(1)},${(y + 110).toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
}
const SPIRO = spiro(96, 41, 50, 41); // 96고리 — 가는 선이 겹친 고리 문양
const progress = computed(() => (byDate.value.length > 1 ? active.value / (byDate.value.length - 1) : 0));
</script>

<template>
  <main class="paper ph">
    <div class="container">
      <BlockNotice v-if="block" :notice="block" @action="load" />
    </div>

    <!-- 1 파낸 모서리 첫 화면 -->
    <section class="container hero" aria-labelledby="ph-title">
      <div class="board">
        <div class="notch-tl">
          <p class="eyebrow">{{ ko.museum.name }}</p>
          <h1 id="ph-title" class="title">{{ alias ? ko.museum.hall(alias) : ko.museum.name }}</h1>
          <p class="tagline">{{ ko.museum.tagline }}</p>
        </div>
        <div class="deco" aria-hidden="true">
          <svg class="ornament o1" viewBox="0 0 220 220" focusable="false"><path :d="SPIRO" /></svg>
          <svg class="ornament o2" viewBox="0 0 220 220" focusable="false"><path :d="SPIRO" /></svg>
        </div>
        <div class="stage">
          <button v-if="latest" class="hero-art" type="button" :aria-label="`${ko.museum.latest} - ${latest.title}`" @click="openArt(latest)">
            <span class="paper-tape tape-l" aria-hidden="true"></span><span class="paper-tape tape-r" aria-hidden="true"></span>
            <span class="mat"><img :src="still(latest) ?? ''" :alt="latest.title"></span>
            <span class="caption">{{ latest.title }} · {{ ko.museum.plaque(latest.madeOn, latest.ageAtMaking) }}</span>
          </button>
          <div v-else-if="g" class="hero-art empty">
            <span class="paper-tape tape-l" aria-hidden="true"></span><span class="paper-tape tape-r" aria-hidden="true"></span>
            <span class="mat blank" aria-hidden="true"></span>
            <p class="caption">{{ ko.museum.emptyTitle }}</p>
          </div>
        </div>
        <div class="notch-br">
          <RouterLink v-if="latest" class="paper-stamp" :to="{ path: '/app/hall', query: { child: childId } }">{{ ko.paper.enterHall }} <span aria-hidden="true">↗</span></RouterLink>
          <RouterLink v-else class="paper-stamp" :to="children?.length ? '/app/upload' : '/app/children'">{{ ko.museum.upload }} <span aria-hidden="true">↗</span></RouterLink>
        </div>
      </div>
    </section>

    <template v-if="all.length">
      <!-- 2 숫자 줄 -->
      <section class="container stats" :aria-label="ko.museum.collection(all.length)">
        <p><b>{{ all.length }}<small>{{ ko.paper.unitWorks }}</small></b><span>{{ ko.paper.statWorks }}</span></p>
        <p><b>{{ rooms.length }}<small>{{ ko.paper.unitRooms }}</small></b><span>{{ ko.paper.statRooms }}</span></p>
        <p v-if="first"><b>{{ ko.paper.firstOf(first.madeOn) }}</b><span>{{ ko.paper.statFirst }}</span></p>
      </section>

      <!-- 3 원통으로 휜 작품 줄 -->
      <section class="reel-sec" aria-labelledby="ph-reel">
        <h2 id="ph-reel" class="container sec-h">{{ ko.paper.reel }}</h2>
        <div ref="reel" class="reel" tabindex="0" role="region" :aria-label="ko.paper.reel" @scroll.passive="onScroll">
          <ul class="track">
            <li v-for="(it, i) in byDate" :key="it.id" class="rc" :class="{ on: i === active }">
              <button class="polaroid" type="button" :aria-label="it.title" @click="i === active ? openArt(it) : go(i)">
                <span class="ph-img"><img :src="still(it) ?? ''" :alt="it.title" loading="lazy"></span>
                <span class="ph-t">{{ it.title }}</span>
                <span class="ph-d">{{ ko.museum.plaque(it.madeOn, it.ageAtMaking) }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div class="container reel-ctl">
          <button class="ctl" type="button" :disabled="active === 0" @click="go(active - 1)"><span aria-hidden="true">←</span> {{ ko.paper.prev }}</button>
          <div class="bar" aria-hidden="true"><span class="dot" :style="{ left: `${progress * 100}%` }"></span></div>
          <span class="pos">{{ ko.paper.pos(active + 1, byDate.length) }}</span>
          <button class="ctl" type="button" :disabled="active >= byDate.length - 1" @click="go(active + 1)">{{ ko.paper.next }} <span aria-hidden="true">→</span></button>
        </div>
      </section>

      <!-- 4 모듈 패널 -->
      <section class="container panels">
        <article class="panel">
          <h2 class="panel-h">{{ ko.museum.plan }}</h2>
          <ul class="tickets">
            <li v-for="r in rooms" :key="r.ageAtMaking ?? 'none'"><RouterLink class="ticket" :to="{ path: '/app/hall', query: { child: childId } }"><b>{{ ko.museum.room(r.ageAtMaking) }}</b><span>{{ r.items.length }}</span></RouterLink></li>
          </ul>
        </article>
        <article v-if="lastWords" class="panel quote">
          <h2 class="panel-h">{{ ko.museum.childWords }}</h2>
          <p class="words">“{{ lastWords }}”</p>
        </article>
        <article v-if="preparing" class="panel">
          <h2 class="panel-h">{{ ko.museum.preparing(preparing) }}</h2>
          <RouterLink class="line-link" to="/app/works">{{ ko.museum.manage }} <span aria-hidden="true">→</span></RouterLink>
        </article>
        <article class="panel">
          <h2 class="panel-h">{{ ko.paper.family }}</h2>
          <RouterLink class="line-link" to="/app/family">{{ ko.paper.toFamily }} <span aria-hidden="true">→</span></RouterLink>
        </article>
      </section>
    </template>
  </main>
</template>

<style scoped>
.ph{min-height:100vh;padding-bottom:var(--s-section);word-break:keep-all;overflow-x:clip}
/* ---- 1 파낸 모서리 첫 화면 ---- */
.hero{margin-top:var(--s-xl)}
.board{--r:28px;--cut:var(--paper-bg);position:relative;border-radius:var(--r);min-height:clamp(440px,52vw,620px);background:var(--paper-blush)}
.deco{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none}
.ornament{position:absolute;fill:none;stroke:var(--paper-accent);stroke-width:.35;opacity:.8}
.o1{width:clamp(180px,22vw,300px);left:4%;bottom:-8%}
.o2{width:clamp(110px,12vw,170px);right:4%;top:6%;opacity:.55}
@media (max-width:760px){.o1{left:-18%;bottom:-6%}.o2{display:none}}
/* 파낸 자리 — 바탕색 탭 + 오목한 모서리 두 개(방사 그라데이션) */
.notch-tl,.notch-br{position:absolute;background:var(--cut);z-index:2}
.notch-tl{top:-1px;left:-1px;padding:0 clamp(20px,3vw,40px) clamp(18px,2.4vw,28px) 0;border-bottom-right-radius:var(--r);max-width:min(560px,86%)}
.notch-br{right:-1px;bottom:-1px;padding:clamp(14px,1.6vw,20px) 0 0 clamp(14px,1.6vw,20px);border-top-left-radius:var(--r)}
.notch-tl::before,.notch-tl::after,.notch-br::before,.notch-br::after{content:"";position:absolute;width:var(--r);height:var(--r);
  background:radial-gradient(circle at 100% 100%,transparent calc(var(--r) - .5px),var(--cut) var(--r))}
.notch-tl::before{top:0;right:calc(var(--r) * -1)}
.notch-tl::after{bottom:calc(var(--r) * -1);left:0}
.notch-br::before{bottom:0;left:calc(var(--r) * -1)}
.notch-br::after{top:calc(var(--r) * -1);right:0}
.notch-br::before,.notch-br::after{background:radial-gradient(circle at 0 0,transparent calc(var(--r) - .5px),var(--cut) var(--r))}
.eyebrow{font:600 13px/1 var(--font-sans);letter-spacing:.8px;color:var(--paper-ink-2);padding-top:4px}
.title{margin:12px 0 0;font:750 clamp(36px,5.4vw,68px)/1.05 var(--font-sans);letter-spacing:-.035em;color:var(--paper-accent)}
.tagline{margin-top:10px;font:400 17px/1.4 var(--font-sans);color:var(--paper-ink)}
.stage{position:absolute;inset:0;display:grid;place-items:center;padding:clamp(150px,14vw,170px) 20px 90px clamp(20px,30%,380px)}
@media (max-width:760px){.board{min-height:500px}.stage{padding:180px 16px 118px}}
.hero-art{position:relative;border:0;background:none;padding:0;cursor:pointer;display:grid;justify-items:center;gap:12px;transform:rotate(-1.4deg)}
.hero-art .mat{display:block;background:var(--paper-mat);padding:clamp(16px,2.2vw,28px);box-shadow:inset 0 0 0 1px var(--paper-line),0 18px 30px -14px var(--paper-shadow)}
.hero-art img{display:block;height:clamp(180px,24vw,300px);width:auto;max-width:min(58vw,440px);object-fit:contain}
.hero-art .blank{width:220px;height:170px;border:1px dashed var(--paper-line)}
.tape-l{top:-12px;left:-18px;transform:rotate(-34deg);z-index:1}
.tape-r{top:-12px;right:-18px;transform:rotate(30deg);z-index:1}
.caption{font:400 13px/1.3 var(--font-mono);letter-spacing:.3px;color:var(--paper-ink);transform:rotate(1.4deg)}

/* ---- 2 숫자 줄 ---- */
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:var(--s-xxl);text-align:center}
.stats p{display:grid;gap:6px;padding:4px 8px}
.stats p + p{border-left:1px solid var(--paper-line)}
.stats b{font:750 clamp(32px,5vw,56px)/1 var(--font-sans);color:var(--paper-accent);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stats small{font-size:.42em;margin-left:4px;letter-spacing:0}
.stats p{min-width:0}
@media (max-width:560px){.stats b{font-size:clamp(24px,7.4vw,32px)}}
.stats span{font:500 14px/1.3 var(--font-sans);color:var(--paper-ink)}

/* ---- 3 원통으로 휜 작품 줄 ---- */
.reel-sec{margin-top:var(--s-xxl);background:var(--paper-blush);padding:var(--s-xxl) 0 var(--s-xl)}
.sec-h{font:750 clamp(28px,3.6vw,44px)/1.15 var(--font-sans);text-align:center;letter-spacing:-.03em;margin-bottom:var(--s-md);color:var(--paper-accent)}
.reel{overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;perspective:1100px;--cw:clamp(180px,22vw,250px)}
.reel::-webkit-scrollbar{display:none}
.reel:focus-visible{outline:2px solid var(--paper-accent);outline-offset:-2px}
.track{list-style:none;margin:0;display:flex;gap:clamp(8px,1.4vw,18px);padding:28px calc(50% - var(--cw) / 2) 40px;width:max-content;transform-style:preserve-3d}
.rc{--d:0;--ad:0;flex:none;width:var(--cw);scroll-snap-align:center;
  transform:rotateY(calc(var(--d) * -16deg)) scale(calc(1 - var(--ad) * .07)) translateZ(calc(var(--ad) * -30px));
  transition:transform .35s ease}
/* 멀어진 카드는 그림만 옅게 — 글자는 대비 4.5:1 유지 */
.rc .ph-img img{opacity:calc(1 - var(--ad) * .2);transition:opacity .35s ease}
.polaroid{display:grid;gap:4px;width:100%;border:0;cursor:pointer;background:var(--paper-mat);padding:12px 12px 16px;text-align:left;color:var(--paper-ink);
  box-shadow:0 16px 26px -14px var(--paper-shadow)}
.ph-img{display:grid;place-items:center;aspect-ratio:1;background:var(--paper-bg);overflow:hidden}
.ph-img img{width:100%;height:100%;object-fit:contain}
.ph-t{margin-top:8px;font:540 16px/1.3 var(--font-sans)}
.ph-d{font:400 12px/1.2 var(--font-mono);color:var(--paper-ink)}
.rc.on .polaroid{box-shadow:0 0 0 2px var(--paper-accent),0 22px 30px -14px var(--paper-shadow)}
.reel-ctl{display:grid;grid-template-columns:auto 1fr auto auto;gap:var(--s-sm);align-items:center;max-width:720px;margin:0 auto}
.ctl{background:var(--paper-bg);border:1px solid var(--paper-line);border-radius:999px;padding:9px 16px;font:500 14px/1 var(--font-sans);color:var(--paper-ink);cursor:pointer}
.ctl:disabled{opacity:.35;cursor:default}
.bar{position:relative;height:1px;background:var(--paper-line)}
.dot{position:absolute;top:50%;width:10px;height:10px;border-radius:50%;background:var(--paper-accent);transform:translate(-50%,-50%);transition:left .3s ease}
.pos{font:400 13px/1 var(--font-mono);color:var(--paper-ink)}
@media (max-width:560px){.reel-ctl{grid-template-columns:auto 1fr auto}.pos{display:none}}

/* ---- 4 모듈 패널 ---- */
.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:var(--s-md);margin-top:var(--s-xxl)}
.panel{background:var(--paper-bg);border:1px solid var(--paper-line);border-radius:22px;padding:var(--s-lg);display:grid;gap:var(--s-sm);align-content:start}
.panel-h{font:600 13px/1.3 var(--font-sans);letter-spacing:.6px;color:var(--paper-ink-2)}
.tickets{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.ticket{position:relative;display:inline-flex;gap:10px;align-items:center;padding:8px 16px;border:1px solid var(--paper-line);border-radius:6px;text-decoration:none;color:var(--paper-ink);
  background:linear-gradient(90deg,transparent calc(100% - 38px),var(--paper-line) calc(100% - 38px) calc(100% - 37px),transparent 0) ,var(--paper-mat)}
.ticket b{font-weight:540}
.ticket span{font:400 12px/1 var(--font-mono);min-width:14px;text-align:center}
.ticket:hover{border-color:var(--paper-accent)}
.words{font:600 24px/1.45 var(--font-sans);color:var(--paper-accent)}
.line-link{justify-self:start;color:var(--paper-ink);font:540 16px/1.3 var(--font-sans);text-underline-offset:4px}
.ph-img{background:var(--paper-mat)}
@media (prefers-reduced-motion:reduce){.rc,.dot,.rc .ph-img img{transition:none}}
</style>
