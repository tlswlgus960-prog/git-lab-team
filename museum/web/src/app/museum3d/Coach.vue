<script setup lang="ts">
// 처음 들어오면 3칸 안내 한 번(D52 B, SD_02 §17-18 B) — 이 브라우저에 기억(localStorage, 못 쓰면 매번 한 번만).
// ① 그림을 누르면 가까이 가요 ② [다음 작품 ▶]으로 차례로 봐요 ③ 끌면 둘러볼 수 있어요 · [알겠어요]. 대화 상자: 초점 가두기 · Esc 닫기.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { m3 } from './copy';

const emit = defineEmits<{ done: [] }>();
const step = ref(0);
const box = ref<HTMLElement | null>(null);
const main = ref<HTMLButtonElement | null>(null);
let before: HTMLElement | null = null;

function finish() {
  try { localStorage.setItem(COACH_KEY, '1'); } catch { /* 저장 못 해도 닫힌다 */ }
  emit('done');
}
function next() { if (step.value < m3.coachSteps.length - 1) { step.value++; void nextTick(() => main.value?.focus()); } else finish(); }
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); return; }
  if (e.key !== 'Tab' || !box.value) return;
  const f = box.value.querySelectorAll<HTMLElement>('button');
  const first = f[0]; const last = f[f.length - 1];
  if (!box.value.contains(document.activeElement)) { e.preventDefault(); first?.focus(); return; }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
}
onMounted(async () => { before = document.activeElement as HTMLElement | null; document.addEventListener('keydown', onKey, true); await nextTick(); main.value?.focus(); });
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey, true); before?.focus?.({ preventScroll: true }); });
</script>

<script lang="ts">
export const COACH_KEY = 'uam.m3.coach';
/** 이미 봤나(저장소를 못 읽으면 안 본 것으로) */
export function coachSeen(): boolean { try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return false; } }
</script>

<template>
  <div class="co-scrim m3-hud">
    <div ref="box" class="co" role="dialog" aria-modal="true" aria-labelledby="co-t" aria-describedby="co-d">
      <p id="co-t" class="co-t">{{ m3.coachTitle }}</p>
      <ol class="co-dots" :aria-label="m3.coachStep(step + 1, m3.coachSteps.length)">
        <li v-for="(_, i) in m3.coachSteps" :key="i" :class="{ on: i === step }" aria-hidden="true"></li>
      </ol>
      <div class="co-pic" aria-hidden="true">
        <span v-if="step === 0" class="co-tap">👆</span>
        <span v-else-if="step === 1" class="co-next">▶</span>
        <span v-else class="co-drag">↔</span>
      </div>
      <p id="co-d" class="co-d">{{ m3.coachSteps[step] }}</p>
      <div class="co-row">
        <button ref="main" type="button" class="co-go" @click="next">{{ step < m3.coachSteps.length - 1 ? m3.coachNext : m3.coachOk }}</button>
        <button v-if="step < m3.coachSteps.length - 1" type="button" class="co-skip" @click="finish">{{ m3.coachOk }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.co-scrim{position:absolute;inset:0;z-index:30;display:grid;place-items:center;padding:16px;background:rgba(44,34,56,.35)}
.co{width:min(360px,100%);display:grid;justify-items:center;gap:12px;padding:22px 20px 18px;border-radius:24px;border:1.5px solid #C9A24A;background:#FFF9EE;color:#4A3526;
  box-shadow:0 24px 60px -24px rgba(44,34,56,.6);text-align:center}
.co-t{margin:0;font:700 17px/1.3 var(--mc-serif,'Noto Serif KR',serif)}
.co-dots{display:flex;gap:8px;margin:0;padding:0;list-style:none}
.co-dots li{width:9px;height:9px;border-radius:50%;background:#E3CD95}.co-dots li.on{background:#A0496B;transform:scale(1.2)}
.co-pic{width:84px;height:84px;display:grid;place-items:center;border-radius:50%;background:#FDF0DC;font:700 36px/1 var(--font-sans);color:#A0496B}
.co-tap{animation:co-tap 1.2s ease-in-out infinite}.co-drag{animation:co-drag 1.6s ease-in-out infinite}
@keyframes co-tap{0%,100%{transform:translateY(0)}50%{transform:translateY(6px) scale(.92)}}
@keyframes co-drag{0%,100%{transform:translateX(-10px)}50%{transform:translateX(10px)}}
.co-d{margin:0;font:700 19px/1.45 var(--font-sans)}
.co-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.co-go,.co-skip{min-height:48px;padding:10px 22px;border-radius:999px;cursor:pointer;font:700 16px/1 var(--font-sans);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.co-go{border:0;background:#A0496B;color:#FFFBF7;box-shadow:0 3px 0 #6E2B47}
.co-skip{border:1.5px solid #C9A24A;background:#FFF9EE;color:#4A3526;box-shadow:0 3px 0 #D9C08A}
.co-go:active,.co-skip:active{transform:translateY(3px);box-shadow:none}
.co :focus-visible{outline:3px solid #6E3550;outline-offset:3px}
@media (prefers-reduced-motion:reduce){.co *{animation:none!important;transition:none!important}}
</style>
