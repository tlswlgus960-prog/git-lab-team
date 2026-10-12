<script setup lang="ts">
// 중앙 홀 끝벽 벽화(D40, SD_02 §17-13 B) — 자체 제작 SVG: 들판 · 해 · 무지개, 아이 캐릭터 색으로 칠한다. 장식이라 aria-hidden.
import { computed } from 'vue';

const props = defineProps<{ tint: string }>();
/** 두 색 섞기(t = 0 → a, 1 → b) */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const c = computed(() => ({
  sun: props.tint, sunGlow: mix(props.tint, '#ffffff', 0.55),
  hill1: mix(props.tint, '#9ED98C', 0.55), hill2: mix(props.tint, '#BDE8A8', 0.7), hill3: mix(props.tint, '#E3F4C8', 0.75),
}));
const bows = ['#F7A8A8', '#F9CB94', '#F8E59A', '#B7E3A8', '#A9D4F2', '#C9B6EE'];
</script>

<template>
  <svg class="mural" viewBox="0 0 720 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="m3-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DDF0FF" /><stop offset="1" stop-color="#FFF8EC" /></linearGradient>
      <radialGradient id="m3-sun"><stop offset=".55" :stop-color="c.sun" /><stop offset="1" :stop-color="c.sunGlow" stop-opacity="0" /></radialGradient>
    </defs>
    <rect width="720" height="420" fill="url(#m3-sky)" />
    <circle cx="560" cy="110" r="88" fill="url(#m3-sun)" />
    <g fill="none" stroke-width="13" stroke-linecap="round" opacity=".85">
      <path v-for="(b, i) in bows" :key="b" :d="`M${110 + i * 13} 330 A${250 - i * 13} ${230 - i * 13} 0 0 1 ${610 - i * 13} 330`" :stroke="b" />
    </g>
    <g fill="#FFFFFF" opacity=".9">
      <ellipse cx="170" cy="92" rx="48" ry="18" /><ellipse cx="205" cy="80" rx="34" ry="20" />
      <ellipse cx="400" cy="62" rx="40" ry="14" /><ellipse cx="428" cy="54" rx="26" ry="15" />
    </g>
    <path d="M0 300 C120 250 240 262 360 300 S600 330 720 280 V420 H0Z" :fill="c.hill3" />
    <path d="M0 340 C160 300 300 318 440 344 S640 360 720 330 V420 H0Z" :fill="c.hill2" />
    <path d="M0 378 C140 352 280 360 420 384 S620 400 720 372 V420 H0Z" :fill="c.hill1" />
    <g>
      <circle cx="96" cy="372" r="7" fill="#FFFFFF" /><circle cx="96" cy="372" r="3" :fill="c.sun" />
      <circle cx="238" cy="392" r="7" fill="#FFD1DC" /><circle cx="238" cy="392" r="3" fill="#FFFFFF" />
      <circle cx="512" cy="396" r="7" fill="#FFFFFF" /><circle cx="512" cy="396" r="3" :fill="c.sun" />
      <circle cx="650" cy="386" r="7" fill="#FFD1DC" /><circle cx="650" cy="386" r="3" fill="#FFFFFF" />
    </g>
  </svg>
</template>

<style scoped>
.mural{display:block;width:100%;height:100%}
</style>
