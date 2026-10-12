<script setup lang="ts">
// 공통 틀 GameStage(D53, SD_02 §17-19): 밝은 하늘 → 광장 바닥(밝은 돌) + 먼 고전 미술관 외관(자체 제작 SVG — 기둥 · 페디먼트 · 금빛 선 · 넓은 계단).
// 모든 보호자 화면의 뒤 배경. 장식은 전부 aria-hidden. 내용(slot)은 가운데 위에 얹는다.
// 배경은 화면에 고정(position: fixed)이라 긴 화면을 내려도 하늘 · 외관이 그대로 있다. z-index 0 — 위 줄(MuseumBar, z 40)과 메뉴를 덮지 않는다.
// 높이: 기본 화면 높이. 위 줄 아래에 놓이는 화면은 --gs-min으로 줄인다.
// 방 안(MuseumRoom, D38)에 들어가면 방 벽 위를 이 배경이 덮고, 방의 위 여백을 줄인다.
import { inject } from 'vue';
import '@/styles/game.css';

withDefaults(defineProps<{ facade?: boolean; compact?: boolean }>(), { facade: true, compact: false });
const inRoom = inject<boolean>('inRoom', false);
/** 기둥 x 좌표(주랑 6개) */
const COLS = [468, 520, 572, 628, 680, 732];
/** 날개 창 x 좌표(한쪽 5개) */
const WIN_L = [96, 164, 232, 300, 368];
const WIN_R = WIN_L.map((x) => 1200 - x - 36);
</script>

<template>
  <div class="gs" :class="{ compact, 'in-room': inRoom }">
    <div class="gs-bg" aria-hidden="true">
      <span class="gs-sky" />
      <span class="gs-cloud c1" /><span class="gs-cloud c2" /><span class="gs-cloud c3" />
      <span class="gs-plaza" /><span class="gs-path" />
      <svg v-if="facade" class="gs-facade" viewBox="0 0 1200 470" preserveAspectRatio="xMidYMax meet" focusable="false">
        <defs>
          <linearGradient id="gs-stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf6ec" /><stop offset="1" stop-color="#eee3cf" /></linearGradient>
          <linearGradient id="gs-win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9d2e6" /><stop offset="1" stop-color="#e3edf5" /></linearGradient>
          <linearGradient id="gs-dome" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a9cfc6" /><stop offset=".45" stop-color="#d4ebe4" /><stop offset="1" stop-color="#9cc3ba" /></linearGradient>
          <linearGradient id="gs-col" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e6d9c1" /><stop offset=".4" stop-color="#fffaf0" /><stop offset="1" stop-color="#e2d4ba" /></linearGradient>
        </defs>
        <!-- 둥근 지붕(돔) · 드럼 · 등롱 -->
        <rect x="596" y="22" width="8" height="18" fill="#c9a24a" />
        <circle cx="600" cy="20" r="6" fill="#c9a24a" />
        <rect x="585" y="40" width="30" height="20" rx="3" fill="url(#gs-stone)" stroke="#c9a24a" stroke-width="1.5" />
        <path d="M512 140 Q512 62 600 58 Q688 62 688 140 Z" fill="url(#gs-dome)" stroke="#c9a24a" stroke-width="2" />
        <path d="M556 140 Q560 80 600 60 M644 140 Q640 80 600 60 M600 60 V140" fill="none" stroke="#c9a24a" stroke-width="1.5" opacity=".8" />
        <rect x="500" y="136" width="200" height="30" fill="url(#gs-stone)" stroke="#c9a24a" stroke-width="1.5" />
        <g fill="url(#gs-win)"><rect x="520" y="142" width="14" height="18" rx="7" /><rect x="556" y="142" width="14" height="18" rx="7" /><rect x="630" y="142" width="14" height="18" rx="7" /><rect x="666" y="142" width="14" height="18" rx="7" /></g>

        <!-- 양 날개 -->
        <g>
          <rect x="52" y="248" width="384" height="172" fill="url(#gs-stone)" />
          <rect x="764" y="248" width="384" height="172" fill="url(#gs-stone)" />
          <!-- 난간(아틱) · 코니스 금빛 선 -->
          <rect x="46" y="226" width="396" height="22" fill="#f4ecdc" />
          <rect x="758" y="226" width="396" height="22" fill="#f4ecdc" />
          <g fill="#e6d8bd"><rect v-for="i in 22" :key="`bl${i}`" :x="52 + i * 17" y="230" width="7" height="14" rx="3" /><rect v-for="i in 22" :key="`br${i}`" :x="764 + i * 17" y="230" width="7" height="14" rx="3" /></g>
          <rect x="40" y="246" width="408" height="6" fill="#c9a24a" />
          <rect x="752" y="246" width="408" height="6" fill="#c9a24a" />
          <rect x="52" y="272" width="384" height="2" fill="#d9c08a" />
          <rect x="764" y="272" width="384" height="2" fill="#d9c08a" />
          <!-- 아치 창 -->
          <g v-for="x in [...WIN_L, ...WIN_R]" :key="`w${x}`">
            <path :d="`M${x} 380 V318 a18 18 0 0 1 36 0 V380 Z`" fill="url(#gs-win)" stroke="#c9a24a" stroke-width="1.5" />
            <path :d="`M${x + 18} 300 V380 M${x} 344 H${x + 36}`" stroke="#fbf6ec" stroke-width="2" />
            <rect :x="x - 6" y="380" width="48" height="5" fill="#e6d8bd" />
          </g>
          <!-- 벽기둥(필라스터) -->
          <g fill="#f1e7d4"><rect v-for="x in [58, 142, 210, 278, 346, 414]" :key="`pl${x}`" :x="x" y="276" width="14" height="134" /><rect v-for="x in [770, 838, 906, 974, 1042, 1128]" :key="`pr${x}`" :x="x" y="276" width="14" height="134" /></g>
          <rect x="46" y="408" width="396" height="14" fill="#e9dcc3" />
          <rect x="758" y="408" width="396" height="14" fill="#e9dcc3" />
        </g>

        <!-- 가운데 본관 · 주랑 -->
        <rect x="432" y="196" width="336" height="226" fill="url(#gs-stone)" />
        <!-- 페디먼트 -->
        <path d="M424 200 L600 128 L776 200 Z" fill="#f7efdf" stroke="#c9a24a" stroke-width="3" stroke-linejoin="round" />
        <path d="M456 192 L600 138 L744 192 Z" fill="none" stroke="#d9c08a" stroke-width="1.5" />
        <circle cx="600" cy="172" r="13" fill="#fbf6ec" stroke="#c9a24a" stroke-width="2" />
        <path d="M594 172 h12 M600 166 v12" stroke="#c9a24a" stroke-width="2" stroke-linecap="round" />
        <!-- 엔타블러처 -->
        <rect x="428" y="200" width="344" height="10" fill="#c9a24a" />
        <rect x="436" y="210" width="328" height="18" fill="#f4ecdc" />
        <rect x="436" y="226" width="328" height="3" fill="#d9c08a" />
        <!-- 기둥 -->
        <g v-for="x in COLS" :key="`c${x}`">
          <rect :x="x - 6" y="230" width="24" height="8" fill="#e8dbc0" />
          <rect :x="x" y="238" width="16" height="164" fill="url(#gs-col)" />
          <rect :x="x - 5" y="400" width="26" height="8" fill="#e8dbc0" />
        </g>
        <!-- 정문 · 안쪽 그늘 -->
        <path d="M578 402 V336 a22 22 0 0 1 44 0 V402 Z" fill="#8c5d4a" opacity=".85" />
        <path d="M578 402 V336 a22 22 0 0 1 44 0 V402" fill="none" stroke="#c9a24a" stroke-width="2.5" />
        <rect x="598" y="340" width="4" height="62" fill="#c9a24a" opacity=".7" />
        <!-- 넓은 계단 -->
        <g>
          <rect x="424" y="408" width="352" height="10" fill="#f6eee0" /><rect x="424" y="417" width="352" height="2" fill="#dccbaa" />
          <rect x="396" y="419" width="408" height="11" fill="#f8f1e4" /><rect x="396" y="429" width="408" height="2" fill="#dccbaa" />
          <rect x="364" y="431" width="472" height="12" fill="#faf4e8" /><rect x="364" y="442" width="472" height="2" fill="#dccbaa" />
          <rect x="328" y="444" width="544" height="12" fill="#fbf6ec" /><rect x="328" y="455" width="544" height="2" fill="#dccbaa" />
          <rect x="288" y="457" width="624" height="13" fill="#fdf9f1" />
        </g>
        <!-- 가로등 -->
        <g v-for="x in [300, 900]" :key="`lp${x}`">
          <rect :x="x - 2" y="372" width="4" height="98" fill="#6e5a3a" />
          <circle :cx="x" cy="366" r="9" fill="#fff4cf" stroke="#c9a24a" stroke-width="2" />
          <rect :x="x - 6" y="464" width="12" height="6" fill="#6e5a3a" />
        </g>
        <!-- 끝의 둥근 정원수 -->
        <g fill="#a9d39a"><circle cx="30" cy="420" r="30" /><circle cx="1170" cy="420" r="30" /></g>
        <g fill="#c3e4b3"><circle cx="22" cy="410" r="14" /><circle cx="1162" cy="410" r="14" /></g>
      </svg>
    </div>
    <div class="gs-body"><slot /></div>
  </div>
</template>

<style scoped>
.gs{position:relative;z-index:0;min-height:100vh;min-height:var(--gs-min,100dvh);overflow-x:clip;display:flex;flex-direction:column}
/* 방 안: 방의 위 여백(몰딩 자리)을 줄이고 아래 여백은 이 틀이 가진다 */
.gs.in-room{margin-top:-60px;margin-bottom:-22vh;min-height:var(--gs-min,calc(100dvh - 61px))}
.gs-bg{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background:#eaf5fc}
.gs-bg>span{position:absolute;display:block}
.gs-sky{inset:0;background:
  radial-gradient(ellipse 60% 40% at 50% 0%,rgba(255,255,255,.75),rgba(255,255,255,0) 70%),
  linear-gradient(#b9dcf5 0%,#d6ecfa 30%,#eef7fc 52%,#fbf5e8 70%,#fbf5e8 100%)}
.gs-cloud{border-radius:999px;background:radial-gradient(closest-side,rgba(255,255,255,.95),rgba(255,255,255,0));filter:blur(1px)}
.c1{left:6%;top:9%;width:min(320px,50vw);height:70px}
.c2{right:4%;top:17%;width:min(420px,60vw);height:90px;opacity:.85}
.c3{left:38%;top:4%;width:min(240px,40vw);height:50px;opacity:.7}
/* 광장: 밝은 돌 포장, 원근 */
.gs-plaza{left:0;right:0;bottom:0;height:30%;overflow:hidden;background:linear-gradient(#efe5d2,#f6eee0 40%,#efe4cf)}
.gs-plaza::before{content:"";position:absolute;left:-60%;right:-60%;top:0;height:220%;transform-origin:50% 0;transform:perspective(420px) rotateX(62deg);
  background:repeating-linear-gradient(90deg,rgba(170,140,95,.2) 0 2px,transparent 2px 90px),repeating-linear-gradient(0deg,rgba(170,140,95,.16) 0 2px,transparent 2px 70px)}
.gs-plaza::after{content:"";position:absolute;left:0;right:0;top:0;height:14px;background:linear-gradient(rgba(120,95,55,.12),rgba(120,95,55,0))}
.gs-path{left:50%;bottom:0;width:min(900px,120vw);height:30%;transform:translateX(-50%);clip-path:polygon(38% 0,62% 0,100% 100%,0 100%);
  background:linear-gradient(rgba(255,251,242,.2),rgba(255,251,242,.85))}
.gs-facade{position:absolute;left:50%;bottom:calc(30% - 2px);width:min(1200px,165vw,110vh);height:auto;transform:translateX(-50%);opacity:.96;
  filter:drop-shadow(0 18px 24px rgba(120,95,55,.18))}
.gs-body{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;
  width:100%;padding:clamp(20px,4vh,48px) 16px clamp(24px,5vh,56px);box-sizing:border-box;min-width:0}
/* 긴 화면(캐릭터 만들기 등): 외관은 작고 옅게 · 내용은 위부터 */
.gs.compact .gs-body{justify-content:flex-start}
.gs.compact .gs-facade{width:min(900px,130vw);opacity:.55;filter:none}
.gs.compact .gs-plaza,.gs.compact .gs-path{height:22%}
.gs.compact .gs-facade{bottom:calc(22% - 2px)}
</style>
