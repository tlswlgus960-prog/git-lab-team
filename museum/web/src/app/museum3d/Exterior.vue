<script setup lang="ts">
// 미술관 바깥 광장(D52 C, SD_02 §17-18 C) — 아이 미술관에 들어오면 여기서 시작한다. 고른 미술관 모양(D40 A)의 큰 외관 · 넓은 계단 · 정문 · 가로등 · 하늘.
// 자체 제작 SVG(모양만 모티브 — 실제 미술관 이름 · 로고 없음, D33). 버튼은 부르는 쪽이 정한다: 가족 [들어가기] · [미술관 마을] · [친구 초대],
// 방문자 [들어가기] · [마을로], 견본 [들어가기] · [카카오로 시작하기]. [들어가기]는 정문으로 다가가는 연출 뒤 enter(움직임 줄이기면 바로).
import { computed, nextTick, onMounted, ref } from 'vue';
import { reducedMotion } from '@/composables/usePolling';
import { m3 } from './copy';

const props = withDefaults(defineProps<{ alias: string; museumStyle?: string | null; tint?: string; actions: OutsideAction[] }>(), { museumStyle: null, tint: '#FFC93C' });
const emit = defineEmits<{ action: [key: string] }>();
const going = ref(false);
const root = ref<HTMLElement | null>(null);
const style = computed(() => props.museumStyle ?? 'column_temple');
const brick = computed(() => style.value === 'brick_chimney');
const wall = computed(() => (brick.value ? '#C8674E' : style.value === 'silver_wave' ? '#E9EDF2' : '#F6EEDD'));
const trim = computed(() => (brick.value ? '#8E3B2A' : '#C9A24A'));
function act(a: OutsideAction) {
  if (a.key !== 'enter' || reducedMotion()) { emit('action', a.key); return; }
  going.value = true; setTimeout(() => emit('action', a.key), 760);
}
onMounted(async () => { await nextTick(); root.value?.querySelector<HTMLElement>('.ex-b')?.focus({ preventScroll: true }); });
const cols = [0, 1, 2, 3, 4, 5, 6, 7];
</script>

<script lang="ts">
export interface OutsideAction { key: string; label: string; primary?: boolean; to?: string | { path: string; query?: Record<string, string>; hash?: string } }
</script>

<template>
  <section ref="root" class="ex" :class="{ going }" role="region" :aria-label="m3.outsideRegion(alias)">
    <svg class="ex-art" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ex-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9FD4FF" /><stop offset=".7" stop-color="#DDF0FF" /><stop offset="1" stop-color="#FFF4E0" /></linearGradient>
        <linearGradient id="ex-plaza" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9DFCC" /><stop offset="1" stop-color="#F8F2E6" /></linearGradient>
        <linearGradient id="ex-col" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E4DAC6" /><stop offset=".4" stop-color="#FFFFFF" /><stop offset="1" stop-color="#D8CCB4" /></linearGradient>
        <linearGradient id="ex-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F1DB9B" /><stop offset=".5" stop-color="#C9A24A" /><stop offset="1" stop-color="#9C7A2E" /></linearGradient>
        <linearGradient id="ex-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E6F6FF" stop-opacity=".9" /><stop offset="1" stop-color="#8FC6EE" stop-opacity=".75" /></linearGradient>
      </defs>
      <rect width="1200" height="800" fill="url(#ex-sky)" />
      <circle cx="1030" cy="120" r="58" fill="#FFE08A" opacity=".9" />
      <g fill="#FFFFFF" opacity=".9"><ellipse cx="200" cy="120" rx="80" ry="24" /><ellipse cx="250" cy="104" rx="52" ry="26" /><ellipse cx="840" cy="80" rx="70" ry="20" /><ellipse cx="880" cy="68" rx="42" ry="20" /></g>
      <!-- 광장 -->
      <path d="M0 610 H1200 V800 H0Z" fill="url(#ex-plaza)" />
      <g stroke="#D9CBB0" stroke-width="2" opacity=".7"><path d="M600 610 L0 800 M600 610 L300 800 M600 610 L900 800 M600 610 L1200 800" /><path d="M0 660 H1200 M0 720 H1200" /></g>
      <!-- 뒤 지붕 모양(고른 미술관 모양) -->
      <g v-if="style === 'golden_dome'"><ellipse cx="600" cy="250" rx="170" ry="150" fill="url(#ex-gold)" /><rect x="585" y="70" width="30" height="40" fill="#C9A24A" /><circle cx="600" cy="64" r="12" fill="#F1DB9B" /></g>
      <g v-else-if="style === 'clock_station'"><rect x="540" y="90" width="120" height="220" fill="#E8DCC4" stroke="#B89B62" stroke-width="4" /><circle cx="600" cy="160" r="40" fill="#FFFFFF" stroke="#8E6B2A" stroke-width="6" /><path d="M600 160 V132 M600 160 H622" stroke="#4A3526" stroke-width="5" stroke-linecap="round" /><path d="M530 90 L600 40 L670 90Z" fill="#6F8FA8" /></g>
      <g v-else-if="style === 'white_spiral'"><ellipse cx="600" cy="300" rx="230" ry="44" fill="#FFFFFF" stroke="#D5D9E0" stroke-width="4" /><ellipse cx="600" cy="245" rx="190" ry="38" fill="#FFFFFF" stroke="#D5D9E0" stroke-width="4" /><ellipse cx="600" cy="195" rx="150" ry="32" fill="#FFFFFF" stroke="#D5D9E0" stroke-width="4" /><ellipse cx="600" cy="152" rx="110" ry="26" fill="#DDF0FF" stroke="#D5D9E0" stroke-width="4" /></g>
      <g v-else-if="style === 'brick_chimney'"><rect x="760" y="80" width="70" height="240" fill="#A9503C" /><rect x="752" y="72" width="86" height="18" fill="#7E3526" /></g>
      <g v-else-if="style === 'hanok_roof'"><path d="M250 330 Q600 250 950 330 L900 300 Q600 200 300 300Z" fill="#5E6B7A" /><path d="M300 300 Q600 200 900 300" stroke="#3F4A57" stroke-width="10" fill="none" /></g>
      <g v-else-if="style === 'silver_wave'"><path d="M230 330 Q360 220 480 300 T720 290 T970 320 L970 340 H230Z" fill="#C9D1DB" stroke="#9AA6B5" stroke-width="5" /></g>
      <!-- 건물 몸 -->
      <rect x="230" y="330" width="740" height="280" :fill="wall" stroke="#D9CBB0" stroke-width="3" />
      <rect x="230" y="318" width="740" height="18" fill="url(#ex-gold)" />
      <g v-if="!brick">
        <rect v-for="c in cols" :key="c" :x="262 + c * 90" y="352" width="36" height="236" fill="url(#ex-col)" />
        <rect v-for="c in cols" :key="`k${c}`" :x="254 + c * 90" y="344" width="52" height="14" fill="#E4D6B6" />
      </g>
      <g v-else fill="#FFFFFF" opacity=".25"><rect v-for="c in cols" :key="c" :x="262 + c * 90" y="380" width="36" height="120" rx="18" /></g>
      <!-- 박공(기둥 신전 · 기본) -->
      <path v-if="style === 'column_temple' || style === 'glass_pyramid' || style === 'clock_station'" d="M210 322 L600 180 L990 322Z" fill="#F3E9D4" stroke="url(#ex-gold)" stroke-width="10" />
      <!-- 정문 아치 + 이름 판 -->
      <path d="M540 610 V470 A60 60 0 0 1 660 470 V610Z" :fill="tint" stroke="url(#ex-gold)" stroke-width="10" />
      <path d="M600 470 V610" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="3" />
      <circle cx="588" cy="540" r="5" fill="#8E6B2A" /><circle cx="612" cy="540" r="5" fill="#8E6B2A" />
      <rect x="470" y="366" width="260" height="56" rx="28" fill="#FFF9EE" stroke="url(#ex-gold)" stroke-width="5" />
      <text x="600" y="403" text-anchor="middle" font-size="28" font-weight="700" fill="#4A3526" font-family="'Noto Serif KR',serif">{{ m3.title(alias) }}</text>
      <!-- 유리 피라미드는 광장 앞에 -->
      <g v-if="style === 'glass_pyramid'"><path d="M860 610 L960 470 L1060 610Z" fill="url(#ex-glass)" stroke="#9BB9D3" stroke-width="4" /><path d="M910 540 H1010 M885 575 H1035 M960 470 V610" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="3" /></g>
      <!-- 넓은 계단 -->
      <rect x="440" y="610" width="320" height="18" fill="#EFE6D4" /><rect x="410" y="628" width="380" height="20" fill="#E9DFCB" /><rect x="380" y="648" width="440" height="22" fill="#E3D8C2" /><rect x="350" y="670" width="500" height="24" fill="#DDD1B9" />
      <!-- 가로등 -->
      <g v-for="lx in [320, 880]" :key="lx"><rect :x="lx - 5" y="560" width="10" height="130" fill="#4A3F36" /><rect :x="lx - 16" y="540" width="32" height="30" rx="6" fill="#FFF1C4" stroke="#4A3F36" stroke-width="5" /><circle :cx="lx" cy="555" r="30" fill="#FFF1C4" opacity=".35" /></g>
      <!-- 화분(아이 느낌 한 스푼) -->
      <g v-for="px in [270, 930]" :key="px"><path :d="`M${px - 26} 690 h52 l-8 36 h-36z`" fill="#E9B98C" /><circle :cx="px" cy="672" r="30" fill="#8FD18A" /><circle :cx="px - 16" cy="684" r="16" fill="#7CC47A" /><circle :cx="px + 16" cy="684" r="16" fill="#A5DD9C" /></g>
    </svg>
    <div class="ex-ui">
      <h2 class="ex-h">{{ m3.title(alias) }}</h2>
      <p class="ex-sub">{{ m3.outsideSub }}</p>
      <div class="ex-row">
        <template v-for="a in actions" :key="a.key">
          <RouterLink v-if="a.to" class="ex-b" :class="{ primary: a.primary }" :to="a.to">{{ a.label }}</RouterLink>
          <button v-else type="button" class="ex-b" :class="{ primary: a.primary }" @click="act(a)">{{ a.label }}</button>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ex{position:absolute;inset:0;z-index:20;overflow:hidden;background:#DDF0FF;transform-origin:50% 72%;transition:transform .75s cubic-bezier(.5,0,.75,0),opacity .75s ease-in}
.ex.going{transform:scale(2.6);opacity:0}
.ex-art{position:absolute;inset:0;width:100%;height:100%}
.ex-ui{position:absolute;left:0;right:0;bottom:18px;display:grid;justify-items:center;gap:8px;padding:0 16px}
.ex-h{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0} /* 이름은 건물 판에 이미 크게 — 화면 읽기용만 */
.ex-sub{margin:0;padding:4px 12px;border-radius:999px;background:rgba(255,249,238,.8);font:600 14px/1.3 var(--font-sans);color:#6E3550}
.ex-row{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:4px}
.ex-b{display:inline-flex;align-items:center;justify-content:center;min-height:56px;min-width:120px;padding:10px 24px;border:1.5px solid #C9A24A;border-radius:999px;cursor:pointer;background:#FFF9EE;color:#4A3526;
  font:800 17px/1.2 var(--font-sans);text-decoration:none;box-shadow:0 3px 0 #D9C08A,0 10px 20px -12px rgba(74,53,38,.5);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.ex-b.primary{background:#A0496B;border-color:#6E2B47;color:#FFFBF7;box-shadow:0 3px 0 #6E2B47,0 10px 20px -12px rgba(74,53,38,.5)}
.ex-b:hover{transform:translateY(-1px)}
.ex-b:active{transform:translateY(3px);box-shadow:0 0 0 #D9C08A}
.ex-b:focus-visible{outline:3px solid #6E3550;outline-offset:3px}
@media (max-width:600px){.ex-b{min-width:100px;padding:10px 16px;font-size:16px}}
@media (prefers-reduced-motion:reduce){.ex,.ex-b{transition:none}.ex.going{transform:none}}
</style>
