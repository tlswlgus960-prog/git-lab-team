<script setup lang="ts">
// 회랑 배경(SD_02 §17-6) — 한 점 투시로 계산해 그리는 인라인 SVG. 금빛 반원통 천장(칸마다 동화 그림판 · 메달리온), 벽(고른 벽 색),
// 금빛 벽기둥 · 처마 선, 대리석 바닥, 맨 끝 흰 아치 문과 민트 하늘 · 달. 분위기 참고: 루브르 아폴론 갤러리(사진 · 이름 · 로고 없음).
// 옆벽 액자(sideArts)는 벽 면을 따라 사다리꼴로 건다. 걷기는 부모가 `.walk-zoom` 클래스로 한 칸만큼 확대했다가 되돌린다(회랑이 반복이라 이어져 보임).
// 갈림길(junction)이면 가까운 칸 양쪽 벽에 아치 입구를 뚫는다. 모두 장식이라 aria-hidden — 조작은 부모의 HTML 버튼.
import { computed } from 'vue';

const props = withDefaults(defineProps<{ sideArts?: (string | null)[]; junction?: boolean; wide?: boolean }>(), { sideArts: () => [], junction: false, wide: false });
/** 넓은 화면은 좌우를 더 보여 깊이가 살게(앞 칸 k=-1까지 그린다) */
const viewBox = computed(() => (props.wide ? '-300 0 1600 1000' : '0 0 1000 1000'));

const VP = { x: 500, y: 540 };
const W = 520; // 앞면 반폭
const K = 9; // 칸 수
const s = (t: number) => 1 / (1 + 0.45 * t);
const X = (t: number, side: -1 | 1) => VP.x + side * W * s(t);
const Y = (y0: number, t: number) => VP.y + (y0 - VP.y) * s(t);
const IMPOST = 330; const FLOOR = 1080; const APEX = -210;
const I = (t: number) => Y(IMPOST, t); const F = (t: number) => Y(FLOOR, t); const A = (t: number) => Y(APEX, t);
const f = (n: number) => n.toFixed(1);
const arc = (t: number, dir: 1 | 0) => `A ${f(W * s(t))} ${f(I(t) - A(t))} 0 0 ${dir}`;

interface Bay { k: number; vault: string; wallL: string; wallR: string; floor: string; alt: boolean; medal: { cx: number; cy: number; rx: number; ry: number }[]; pil: { x: number; y1: number; y2: number; w: number; side: -1 | 1 }[]; cornice: string }
const bays = computed<Bay[]>(() => {
  const out: Bay[] = [];
  for (let k = K - 1; k >= -1; k--) {
    const a = k; const b = k + 1; const m = k + 0.5;
    const vault = `M ${f(X(a, -1))} ${f(I(a))} ${arc(a, 1)} ${f(X(a, 1))} ${f(I(a))} L ${f(X(b, 1))} ${f(I(b))} ${arc(b, 0)} ${f(X(b, -1))} ${f(I(b))} Z`;
    const wall = (side: -1 | 1) => `M ${f(X(a, side))} ${f(I(a))} L ${f(X(b, side))} ${f(I(b))} L ${f(X(b, side))} ${f(F(b))} L ${f(X(a, side))} ${f(F(a))} Z`;
    const floor = `M ${f(X(a, -1))} ${f(F(a))} L ${f(X(a, 1))} ${f(F(a))} L ${f(X(b, 1))} ${f(F(b))} L ${f(X(b, -1))} ${f(F(b))} Z`;
    // 천장 그림판: 꼭대기(90°)와 양옆(38° · 142°)에 타원 메달리온
    const rx = W * s(m); const ry = I(m) - A(m);
    const medal = [90, 38, 142].map((deg) => {
      const r = (deg * Math.PI) / 180;
      const band = (I(a) - A(a)) - (I(b) - A(b));
      return { cx: VP.x + rx * Math.cos(r), cy: I(m) - ry * Math.sin(r), rx: (deg === 90 ? 0.2 : 0.075) * W * (s(a) - s(b)) * 3.2, ry: Math.max(2, band * (deg === 90 ? 0.26 : 0.2)) };
    });
    const pil = ([-1, 1] as const).map((side) => ({ x: X(a, side), y1: I(a), y2: F(a), w: 26 * s(a), side }));
    const cornice = `M ${f(X(a, -1))} ${f(I(a))} L ${f(X(b, -1))} ${f(I(b))} M ${f(X(a, 1))} ${f(I(a))} L ${f(X(b, 1))} ${f(I(b))}`;
    out.push({ k, vault, wallL: wall(-1), wallR: wall(1), floor, alt: k % 2 === 0, medal, pil, cornice });
  }
  return out;
});
/** 맨 끝 아치 문 */
const end = computed(() => `M ${f(X(K, -1))} ${f(F(K))} L ${f(X(K, -1))} ${f(I(K))} ${arc(K, 1)} ${f(X(K, 1))} ${f(I(K))} L ${f(X(K, 1))} ${f(F(K))} Z`);
const endBox = computed(() => ({ x: X(K, -1), y: A(K), w: X(K, 1) - X(K, -1), h: F(K) - A(K) }));

/** 옆벽 액자: i번째 작품은 칸 2 + i(왼쪽 · 오른쪽 번갈아)에, 벽 높이 30%~70% */
const frames = computed(() => props.sideArts.slice(0, 6).map((src, i) => {
  const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
  const a = 2 + Math.floor(i / 2) * 1.3 + 0.18; const b = a + 0.62;
  const yAt = (t: number, p: number) => I(t) + (F(t) - I(t)) * p;
  const q = [[X(a, side), yAt(a, 0.3)], [X(b, side), yAt(b, 0.3)], [X(b, side), yAt(b, 0.7)], [X(a, side), yAt(a, 0.7)]] as const;
  const inset = (p: readonly (readonly [number, number])[], k: number) => {
    const cx = p.reduce((m, v) => m + v[0], 0) / 4; const cy = p.reduce((m, v) => m + v[1], 0) / 4;
    return p.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as const);
  };
  const inner = inset(q, 0.8);
  const poly = (p: readonly (readonly [number, number])[]) => p.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
  // 이미지: 단위 정사각형 → 안쪽 사다리꼴(가까운 위 · 먼 위 · 가까운 아래)로 가는 아핀 변환
  const [p0, p1, , p3] = inner as unknown as [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
  const m = `matrix(${f(p1[0] - p0[0])} ${f(p1[1] - p0[1])} ${f(p3[0] - p0[0])} ${f(p3[1] - p0[1])} ${f(p0[0])} ${f(p0[1])})`;
  return { id: `cf${i}`, src, outer: poly(q), inner: poly(inner), m };
}));

/** 갈림길: 가까운 칸(2.2~3.2) 양쪽 벽에 아치 입구 */
const doors = computed(() => (props.junction ? ([-1, 1] as const).map((side) => {
  const a = 2.2; const b = 3.2; const top = (t: number) => I(t) + (F(t) - I(t)) * 0.12;
  return `M ${f(X(a, side))} ${f(F(a))} L ${f(X(a, side))} ${f(top(a))} Q ${f((X(a, side) + X(b, side)) / 2)} ${f(top((a + b) / 2) - 70 * s(a))} ${f(X(b, side))} ${f(top(b))} L ${f(X(b, side))} ${f(F(b))} Z`;
}) : []));
</script>

<template>
  <svg class="corridor" :viewBox="viewBox" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="cg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3DFA2" /><stop offset=".55" stop-color="#D9B566" /><stop offset="1" stop-color="#B08A3E" /></linearGradient>
      <linearGradient id="cg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BFE6E0" /><stop offset=".6" stop-color="#E0F3EF" /><stop offset="1" stop-color="#FDE4E8" /></linearGradient>
      <radialGradient id="cg-medal" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#FFFFFF" /><stop offset=".45" stop-color="#FDE4E8" /><stop offset="1" stop-color="#EEE6F8" /></radialGradient>
      <linearGradient id="cg-panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BFE6E0" /><stop offset=".6" stop-color="#E0F3EF" /><stop offset="1" stop-color="#EEE6F8" /></linearGradient>
      <radialGradient id="cg-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".95" /><stop offset="1" stop-color="#FFFFFF" stop-opacity="0" /></radialGradient>
      <pattern id="cg-marble" patternUnits="userSpaceOnUse" width="220" height="220"><image href="@/assets/classic/marble-grey.webp" width="220" height="220" opacity=".4" /></pattern>
      <clipPath v-for="fr in frames" :id="fr.id" :key="fr.id"><polygon :points="fr.inner" /></clipPath>
    </defs>
    <!-- 끝: 흰 아치 문 너머 민트 하늘 · 달 · 구름 -->
    <path :d="end" fill="url(#cg-sky)" />
    <g class="sky-deco">
      <circle :cx="endBox.x + endBox.w * .62" :cy="endBox.y + endBox.h * .34" :r="endBox.w * .14" fill="#FFFFFF" opacity=".92" />
      <circle :cx="endBox.x + endBox.w * .62" :cy="endBox.y + endBox.h * .34" :r="endBox.w * .3" fill="url(#cg-glow)" />
      <ellipse :cx="endBox.x + endBox.w * .3" :cy="endBox.y + endBox.h * .72" :rx="endBox.w * .32" :ry="endBox.h * .07" fill="#FFFFFF" opacity=".9" />
      <ellipse :cx="endBox.x + endBox.w * .72" :cy="endBox.y + endBox.h * .8" :rx="endBox.w * .3" :ry="endBox.h * .06" fill="#FDE4E8" />
    </g>
    <path :d="end" fill="none" stroke="#FFFFFF" :stroke-width="10 * s(K)" />
    <!-- 칸: 먼 칸부터 -->
    <g v-for="b in bays" :key="b.k">
      <path :d="b.floor" :fill="b.alt ? '#F7EEF0' : '#EEE7F0'" /><path :d="b.floor" fill="url(#cg-marble)" /><path :d="b.floor" fill="#FDE4E8" opacity=".38" />
      <path :d="b.wallL" class="wall" /><path :d="b.wallR" class="wall" />
      <path :d="b.vault" fill="url(#cg-gold)" />
      <g v-for="(md, j) in b.medal" :key="j">
        <ellipse :cx="md.cx" :cy="md.cy" :rx="md.rx" :ry="md.ry" :fill="j === 0 ? 'url(#cg-panel)' : 'url(#cg-medal)'" stroke="#B08A3E" :stroke-width="Math.max(.6, 4 * s(b.k))" />
        <ellipse v-if="j === 0" :cx="md.cx - md.rx * .25" :cy="md.cy + md.ry * .2" :rx="md.rx * .38" :ry="md.ry * .28" fill="#FFFFFF" opacity=".85" />
        <ellipse v-if="j === 0" :cx="md.cx + md.rx * .22" :cy="md.cy + md.ry * .28" :rx="md.rx * .3" :ry="md.ry * .22" fill="#FDE4E8" />
        <circle v-if="j === 0" :cx="md.cx + md.rx * .45" :cy="md.cy - md.ry * .25" :r="md.ry * .22" fill="#FFFBF7" />
      </g>
      <path :d="b.cornice" stroke="#C9A45A" :stroke-width="7 * s(b.k)" fill="none" />
      <rect v-for="p in b.pil" :key="p.side" :x="p.x - p.w / 2" :y="p.y1" :width="p.w" :height="p.y2 - p.y1" fill="url(#cg-gold)" opacity=".92" />
    </g>
    <!-- 갈림길의 옆 아치 입구 -->
    <path v-for="(d, i) in doors" :key="`d${i}`" :d="d" fill="url(#cg-sky)" stroke="#D9B566" stroke-width="5" />
    <!-- 옆벽 액자 -->
    <g v-for="fr in frames" :key="fr.id">
      <polygon :points="fr.outer" fill="url(#cg-gold)" stroke="#B08A3E" stroke-width="1" />
      <polygon :points="fr.inner" fill="#FFFBF7" />
      <g :clip-path="`url(#${fr.id})`"><image v-if="fr.src" :href="fr.src" width="1" height="1" preserveAspectRatio="xMidYMid slice" :transform="fr.m" /></g>
    </g>
    <!-- 천창 빛 -->
    <ellipse class="sky-light" cx="500" cy="300" rx="420" ry="360" fill="url(#cg-glow)" opacity=".35" />
  </svg>
</template>

<style scoped>
.corridor{position:absolute;inset:0;width:100%;height:100%;display:block}
.wall{fill:var(--walk-wall,#FFF6EA)}
.sky-light{animation:breathe 18s ease-in-out infinite alternate}
@keyframes breathe{from{opacity:.22}to{opacity:.42}}
@media (prefers-reduced-motion:reduce){.sky-light{animation:none}}
</style>
