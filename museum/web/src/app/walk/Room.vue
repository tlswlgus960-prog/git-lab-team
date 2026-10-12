<script setup lang="ts">
// 전시실 배경(SD_02 §17-6) — 방 안쪽 벽(고른 벽 색) · 금빛 코브 천장과 그림판 · 양옆 벽 · 대리석 바닥. 모두 장식(aria-hidden).
// 작품 · 조명 · 명패는 부모가 이 위에 HTML로 올린다(그림에만 조명). 넓은 화면은 가로를 더 넓게 그린다.
import { computed } from 'vue';

const props = withDefaults(defineProps<{ wide?: boolean }>(), { wide: false });
const g = computed(() => {
  const TW = props.wide ? 1600 : 1000; const IN = props.wide ? 300 : 140;
  const L = IN; const R = TW - IN; const T = 190; const B = 800; const C = TW / 2;
  return {
    vb: `0 0 ${TW} 1000`, TW, L, R, T, B, C, bw: R - L, bh: B - T,
    ceil: `M0 0 H${TW} L${R} ${T} H${L} Z`,
    left: `M0 0 L${L} ${T} V${B} L0 1000 Z`,
    right: `M${TW} 0 L${R} ${T} V${B} L${TW} 1000 Z`,
    floor: `M${L} ${B} H${R} L${TW} 1000 H0 Z`,
  };
});
</script>

<template>
  <svg class="room" :viewBox="g.vb" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="rg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3DFA2" /><stop offset=".55" stop-color="#D9B566" /><stop offset="1" stop-color="#B08A3E" /></linearGradient>
      <linearGradient id="rg-panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BFE6E0" /><stop offset=".6" stop-color="#E0F3EF" /><stop offset="1" stop-color="#EEE6F8" /></linearGradient>
      <linearGradient id="rg-sideL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4A3A63" stop-opacity=".14" /><stop offset="1" stop-color="#4A3A63" stop-opacity=".02" /></linearGradient>
      <linearGradient id="rg-sideR" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#4A3A63" stop-opacity=".14" /><stop offset="1" stop-color="#4A3A63" stop-opacity=".02" /></linearGradient>
      <pattern id="rg-marble" patternUnits="userSpaceOnUse" width="200" height="200"><image href="@/assets/classic/marble-grey.webp" width="200" height="200" opacity=".4" /></pattern>
    </defs>
    <!-- 천장: 금빛 코브, 가운데 동화 그림판(구름 · 달) -->
    <path :d="g.ceil" fill="url(#rg-gold)" />
    <ellipse :cx="g.C" cy="92" :rx="g.bw * .3" ry="56" fill="url(#rg-panel)" stroke="#B08A3E" stroke-width="4" />
    <ellipse :cx="g.C - g.bw * .08" cy="108" :rx="g.bw * .1" ry="16" fill="#FFFFFF" opacity=".9" />
    <ellipse :cx="g.C + g.bw * .07" cy="112" :rx="g.bw * .08" ry="13" fill="#FDE4E8" />
    <circle :cx="g.C + g.bw * .17" cy="74" r="14" fill="#FFFBF7" />
    <ellipse :cx="g.L + g.bw * .1" cy="80" :rx="g.bw * .06" ry="26" fill="url(#rg-panel)" stroke="#B08A3E" stroke-width="3" />
    <ellipse :cx="g.R - g.bw * .1" cy="80" :rx="g.bw * .06" ry="26" fill="url(#rg-panel)" stroke="#B08A3E" stroke-width="3" />
    <!-- 양옆 벽 -->
    <path :d="g.left" class="wall" /><path :d="g.left" fill="url(#rg-sideL)" />
    <path :d="g.right" class="wall" /><path :d="g.right" fill="url(#rg-sideR)" />
    <!-- 안쪽 벽 · 벽기둥 · 처마 · 걸레받이 -->
    <rect :x="g.L" :y="g.T" :width="g.bw" :height="g.bh" class="wall" />
    <rect :x="g.L" :y="g.T" width="22" :height="g.bh" fill="url(#rg-gold)" opacity=".9" />
    <rect :x="g.R - 22" :y="g.T" width="22" :height="g.bh" fill="url(#rg-gold)" opacity=".9" />
    <rect :x="g.L" :y="g.T" :width="g.bw" height="16" fill="url(#rg-gold)" />
    <rect :x="g.L" :y="g.B - 16" :width="g.bw" height="16" fill="#EBD5D6" />
    <!-- 바닥 -->
    <path :d="g.floor" fill="#F4ECEF" /><path :d="g.floor" fill="url(#rg-marble)" /><path :d="g.floor" fill="#FDE4E8" opacity=".35" />
  </svg>
</template>

<style scoped>
.room{position:absolute;inset:0;width:100%;height:100%;display:block}
.wall{fill:var(--walk-wall,#FFF6EA)}
</style>
