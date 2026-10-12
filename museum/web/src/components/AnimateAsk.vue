<script setup lang="ts">
// 움직임 질문(D49, SD_02 §17-9): 판정이 움직임을 제안한 그림이면 한 번 더 묻는다 — "애니메이션으로 만드시겠습니까?" [예] · [아니오].
// 대상 = 그림(making 아님) · suggestion animated · choices에 animated · 아직 확정 안 함. 판정이 아직이면 "살펴보는 중" 상태 카드(미술관)나 작은 줄(상세)로 최대 30초.
// [예] → POST confirm animated(원본 액자는 그대로 걸림, 확인 뒤 [좋아요]로 바꿔 건다) · [아니오] → 이 기기에서 그 작품은 다시 묻지 않는다.
// overlay = 걸리는 장면 뒤 가운데 대화상자: 부모가 장면 끝(ready)을 알려야 보인다 · 첫 버튼 초점 · Tab 가두기 · Esc = 나중에(기억 안 함) · 닫히면 원래 초점.
// 인라인(작품 상세) = 작은 구역(heading). 어떤 길로 닫혀도 emit('closed').
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { api, ApiError } from '@/api/client';
import { ko } from '@/copy/ko';

interface Detail { suggestion?: string | null; confirmedKind?: string | null; choices?: string[]; making?: boolean }
const props = withDefaults(defineProps<{ artworkId: string; overlay?: boolean; ready?: boolean }>(), { overlay: false, ready: true });
const emit = defineEmits<{ closed: []; started: [] }>();
const KEY = `uam.animAsk.${props.artworkId}`;
const WAIT_MS = 30000;
const uid = useId();
const qId = `aa-q-${uid}`;
const verdict = ref<'wait' | 'yes' | 'no'>('wait');
const phase = ref<'ask' | 'started' | 'closed'>('ask');
const busy = ref(false);
const msg = ref('');
const box = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let alive = true;
let back: HTMLElement | null = null;
const t0 = Date.now();

/** 보일 때: 부모가 준비됐고(장면 끝) · 닫히지 않았고 · 판정 기다림(작은 글자) 또는 대상 */
const show = computed(() => props.ready && phase.value !== 'closed' && verdict.value !== 'no');
const said = () => { try { return localStorage.getItem(KEY) !== null; } catch { return false; } };
const remember = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* 저장소 없음 — 다시 물을 수 있다 */ } };
function canAnimate(d: Detail): 'yes' | 'no' | 'wait' {
  if (d.making || d.confirmedKind || !(d.choices ?? []).includes('animated')) return 'no';
  if (d.suggestion == null) return 'wait';
  return d.suggestion === 'animated' ? 'yes' : 'no';
}

async function check() {
  if (!alive) return;
  let d: Detail;
  try { d = await api.get<Detail>(`/v1/artworks/${encodeURIComponent(props.artworkId)}`); } catch { return close(); }
  const v = canAnimate(d);
  if (v === 'wait' && Date.now() - t0 > WAIT_MS) return close();
  verdict.value = v;
  if (v === 'no') return close();
  if (v === 'wait') timer = setTimeout(check, 3000);
}
function close() {
  if (phase.value === 'closed') return;
  phase.value = 'closed'; verdict.value = 'no';
  if (props.overlay) back?.focus?.({ preventScroll: true });
  emit('closed');
}
async function yes() {
  if (busy.value) return;
  busy.value = true; msg.value = '';
  try {
    await api.post(`/v1/artworks/${encodeURIComponent(props.artworkId)}/confirm`, { body: { kind: 'animated' } });
    remember('yes'); phase.value = 'started'; emit('started');
    await nextTick(); focusFirst();
  } catch (e) {
    // 409 = 그 사이 이미 확정됨(다른 보호자 · 다른 탭) → 다시 읽고 닫는다(이미 시작했으면 시작 화면이 알린다)
    if (e instanceof ApiError && e.status === 409) { emit('started'); close(); }
    else msg.value = ko.animAsk.fail;
  } finally { busy.value = false; }
}
function no() { remember('no'); close(); }

// 대화상자(overlay)일 때만: 초점 · 가두기 · Esc
const buttons = () => [...(box.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
function focusFirst() { buttons()[0]?.focus({ preventScroll: true }); }
function onKey(e: KeyboardEvent) {
  if (!props.overlay || !show.value || verdict.value !== 'yes') return; // 대화상자일 때만(판정 기다리는 작은 알약은 문서 Tab을 막지 않는다)
  if (e.key === 'Escape') { e.preventDefault(); close(); return; } // 나중에 — 기억하지 않는다
  if (e.key !== 'Tab') return;
  const b = buttons(); if (!b.length) { e.preventDefault(); return; }
  const i = b.indexOf(document.activeElement as HTMLElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); b[b.length - 1]!.focus(); }
  else if (!e.shiftKey && i === b.length - 1) { e.preventDefault(); b[0]!.focus(); }
  else if (i < 0) { e.preventDefault(); b[0]!.focus(); }
}
watch(() => show.value && verdict.value === 'yes', async (on) => {
  if (!on || !props.overlay) return;
  back = document.activeElement as HTMLElement | null;
  await nextTick(); focusFirst();
});
onMounted(() => { document.addEventListener('keydown', onKey); if (said()) close(); else void check(); });
onBeforeUnmount(() => { alive = false; if (timer) clearTimeout(timer); document.removeEventListener('keydown', onKey); });
</script>

<template>
  <template v-if="show">
    <!-- 판정 전: 작은 글자만(대화상자 아님) -->
    <p v-if="verdict === 'wait' && !overlay" class="aa-wait" role="status" aria-live="polite">🔎 {{ ko.animAsk.judging }}</p>
    <!-- 미술관: 질문 카드가 뜰 자리에 같은 모양의 상태 카드(떠 있다 사라지는 알약 = 토스트는 쓰지 않는다). 판정이 오면 그 자리에서 질문으로 바뀐다 -->
    <div v-else-if="verdict === 'wait'" class="aa-float">
      <section class="aa aa-status" role="status" aria-live="polite">
        <p class="aa-spark" aria-hidden="true">🔎</p>
        <p class="aa-q">{{ ko.animAsk.judging }}</p>
        <div class="aa-acts one"><button class="btn btn-secondary aa-btn" type="button" @click="close">{{ ko.animAsk.later }}</button></div>
      </section>
    </div>
    <div v-else :class="overlay ? 'aa-scrim' : 'aa-inline'">
      <section ref="box" class="aa" :role="overlay ? 'dialog' : 'region'" :aria-modal="overlay ? 'true' : undefined" :aria-labelledby="qId">
        <template v-if="phase === 'ask'">
          <p class="aa-spark" aria-hidden="true">✨🎞️</p>
          <h2 :id="qId" class="aa-q">{{ ko.animAsk.q }}</h2>
          <p class="aa-small">{{ ko.animAsk.hint }}</p>
          <div class="aa-acts">
            <button class="btn btn-primary aa-btn" type="button" :disabled="busy" @click="yes">{{ ko.animAsk.yes }}</button>
            <button class="btn btn-primary aa-btn" type="button" :disabled="busy" @click="no">{{ ko.animAsk.no }}</button>
          </div>
          <p class="aa-msg" role="status" aria-live="polite">{{ msg }}</p>
        </template>
        <template v-else>
          <h2 :id="qId" class="aa-q">{{ ko.animAsk.started }}</h2>
          <p class="aa-small">{{ ko.animAsk.startedHint }}</p>
          <div class="aa-acts one"><button class="btn btn-secondary aa-btn" type="button" @click="close">{{ ko.animAsk.close }}</button></div>
        </template>
      </section>
    </div>
  </template>
</template>

<style scoped>
.aa-scrim{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(60,44,30,.28);animation:aa-in .45s cubic-bezier(.32,.72,0,1) both}
.aa-inline{margin-top:12px}
/* D53 게임 틀 패널(game.css .g-panel과 같은 모양) */
.aa{background:radial-gradient(120% 80% at 50% 0%,rgba(255,255,255,.7),rgba(255,255,255,0) 60%),linear-gradient(#fffaf0,#fbf4e6);border:2px solid #c9a24a;border-radius:20px;padding:22px 20px;max-width:380px;width:100%;margin:0 auto;text-align:center;display:grid;gap:10px;
  box-shadow:inset 0 0 0 5px #fbf4e6,inset 0 0 0 6px rgba(201,162,74,.75),0 24px 48px -28px rgba(90,62,20,.45),0 8px 18px -12px rgba(90,62,20,.25)}
.aa-scrim .aa{animation:aa-pop .55s cubic-bezier(.32,.72,0,1) both}
.aa-spark{margin:0;font-size:30px;line-height:1}
.aa-q{margin:0;font:700 20px/1.35 var(--mc-serif,serif);color:#4a3526;word-break:keep-all;overflow-wrap:anywhere}
.aa-small{margin:0;font:500 13px/1.45 var(--font-sans);color:#7a6555;word-break:keep-all}
.aa-acts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}
.aa-acts.one{grid-template-columns:1fr}
.aa-btn{min-height:52px;font-size:17px}
.aa-msg{margin:0;min-height:1.2em;font:500 13px/1.3 var(--font-sans);color:#8a2b2b}
.aa-wait{margin:12px 0 0;font:500 13px/1.4 var(--font-sans);color:#7a6555}
.aa-float{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;pointer-events:none}
.aa-float .aa{pointer-events:auto}
.aa-status .aa-q{font-size:18px}
@keyframes aa-in{from{opacity:0}to{opacity:1}}
@keyframes aa-pop{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.aa-scrim,.aa-scrim .aa{animation:none}}
</style>
