<script setup lang="ts">
// S3 판정 제안 확정(T067, SD_02 §6, UC2 BF5~BF8·A1~A4, G7·G8·G17, BR-SUG-02·03·05).
// - 선택지는 API가 준 것만(choices + unavailableChoices), 같은 크기·같은 무게, 기본 선택 없음(UX2). 제안과 달라도 경고 없음.
// - 제안은 문구만(점수 없음). 판정 중이면 "살펴보는 중", 모델 적재 대기면 오류가 아닌 안내 — 그래도 직접 고를 수 있다(A3).
// - 판정 모델이 비활성이라 판정 단계가 없으면 G7 블록 없이 "제안을 준비하지 못했어요"만(SD_02 §6-2, 2026-09-29).
// - 비활성 선택지는 C3 비활성 버튼. 확정이 409 model_disabled(G8)로 거절되면 블록을 보이고 선택지를 다시 불러온다.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import JourneyRail from '@/components/JourneyRail.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { usePolling } from '@/composables/usePolling';
import { ko, problemCopy } from '@/copy/ko';
import { CONFIRM_STATES, KIND_ORDER, blockOf, loadArtwork, routeFor, type ArtworkDetail } from '../artwork';

const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const a = ref<ArtworkDetail | null>(null);
const picked = ref<string | null>(null);
const busy = ref(false);
const block = ref<Notice | null>(null);
const optsEl = ref<HTMLElement | null>(null);

const judgeStage = computed(() => a.value?.stages.find((s) => s.stage === 'judge') ?? null);
const judging = computed(() => !!a.value && a.value.suggestion == null && (a.value.state === 'received' || a.value.state === 'judging'));
const modelWait = computed(() => a.value?.stages.find((s) => (s.stage === 'split' || s.stage === 'judge') && s.waitingForModel) ?? null);
/** 판정 소진(G7) — 판정 단계가 있었는데 제안이 없다. 판정 단계가 아예 없으면(모델 비활성) 블록 없음 */
const g7 = computed<Notice | null>(() => (a.value?.suggestion === 'none' && judgeStage.value
  ? { variant: 'block', gate: 'G7', summary: ko.confirm.noSuggestion, reason: ko.confirm.g7Reason, releaser: ko.confirm.g7Releaser, self: true, actions: [], fields: [] }
  : null));
const splitFailed = computed(() => !!a.value && !a.value.cutoutUrl && a.value.stages.some((s) => s.stage === 'split' && (s.status === 'done' || s.status === 'failed')));

type Opt = { kind: string; ok: boolean; reason: string };
const options = computed<Opt[]>(() => {
  if (!a.value) return [];
  const off = new Map((a.value.unavailableChoices ?? []).map((u) => [u.choice, u.reason]));
  return KIND_ORDER.filter((k) => a.value!.choices.includes(k) || off.has(k))
    .map((k) => ({ kind: k, ok: a.value!.choices.includes(k), reason: off.has(k) ? ko.review.unavailable[off.get(k)!] ?? '' : '' }));
});
const why = computed(() => (!picked.value ? ko.confirm.pickOne : busy.value ? ko.upload.sending : ''));

async function load(): Promise<boolean> {
  const d = await loadArtwork(id);
  // 이미 확정했거나 확정 단계를 지났으면 그 상태 화면으로(UC3 A9의 반대 방향)
  if (!CONFIRM_STATES.includes(d.state) || d.confirmedKind) { await router.replace(routeFor(d)); return false; }
  a.value = d;
  if (picked.value && !d.choices.includes(picked.value)) picked.value = null;
  return judging.value;
}
const poll = usePolling(load);
async function first() {
  try { if (await load()) poll.start(); } catch (e) { block.value = blockOf(e); }
}
onMounted(first);

function choose(o: Opt) { if (o.ok) picked.value = o.kind; }
function disabledBlock(o: Opt) {
  const c = problemCopy({ gate: 'G8', reason: 'model_disabled' }); // 해제 주체 평가 담당(clarify 2026-09-28)
  block.value = { ...c, reason: o.reason || c.reason, actions: [], gate: 'G8', fields: [] };
}

async function submit() {
  if (why.value || !picked.value) return;
  busy.value = true; block.value = null;
  try {
    await api.post(`/v1/artworks/${encodeURIComponent(id)}/confirm`, { body: { kind: picked.value } });
    poll.stop();
    await router.push({ path: `/app/artworks/${id}`, query: { started: '1' } });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, null);
    block.value = toBlock(err);
    if (err.reason === 'model_disabled' || err.reason === 'sculpture_not_exposed') { picked.value = null; await load().catch(() => undefined); }
    else if (err.reason === 'already_processing' || err.reason === 'deleting') poll.stop();
  } finally { busy.value = false; }
}
async function onBlock(label: string) {
  if (label === ko.list.toReview && a.value) await router.push(`/app/artworks/${id}/review`);
  else if (label === '목록으로') await router.push('/app/works');
  else optsEl.value?.querySelector<HTMLElement>('button')?.focus();
}
</script>

<template>
  <main class="container page stack">
    <JourneyRail current="awaiting_confirm" />
    <BlockNotice v-if="block" :notice="block" @action="onBlock" />
    <template v-if="a">
      <div class="two">
        <figure class="pane">
          <figcaption class="t-body-sm"><b>{{ splitFailed ? ko.confirm.originalFallback : ko.confirm.cutout }}</b></figcaption>
          <div class="frame">
            <img v-if="a.cutoutUrl || a.originalUrl" :src="(a.cutoutUrl || a.originalUrl)!" :alt="ko.confirm.cutout">
            <p v-else class="t-body-sm">{{ ko.fail.file }}</p>
          </div>
        </figure>
        <section class="tile stack-sm" aria-labelledby="cf-sugg" aria-live="polite">
          <p id="cf-sugg" class="t-eyebrow">{{ ko.confirm.suggestionTitle }}</p>
          <p v-if="modelWait" class="t-body">{{ ko.wait.model }}<template v-if="modelWait.etaSeconds"> - {{ ko.wait.modelEta(Math.ceil(modelWait.etaSeconds)) }}</template></p>
          <p v-else-if="judging" class="t-body">{{ ko.confirm.judging }}</p>
          <p v-else-if="a.suggestion && a.suggestion !== 'none'" class="quote">{{ ko.confirm.suggestion[a.suggestion] }}</p>
          <p v-else class="t-body">{{ ko.confirm.noSuggestion }}</p>
        </section>
      </div>

      <BlockNotice v-if="g7" :notice="g7" />
      <p v-if="g7" class="t-body-sm">{{ ko.confirm.g7Next }}</p>

      <section class="stack-sm" aria-labelledby="cf-how">
        <h2 id="cf-how" class="t-card-title">{{ ko.confirm.howTitle }}</h2>
        <div ref="optsEl" class="suggest opts" role="group" :aria-label="ko.confirm.howTitle">
          <template v-for="o in options" :key="o.kind">
            <button v-if="o.ok" class="chip-opt" type="button" :aria-pressed="picked === o.kind" @click="choose(o)">{{ ko.kind[o.kind] }}</button>
            <ReasonButton v-else class="chip-opt" :label="ko.kind[o.kind] ?? o.kind" disabled :reason="o.reason" variant="secondary" @blocked="disabledBlock(o)" />
          </template>
        </div>
      </section>

      <div class="acts">
        <ReasonButton :label="ko.confirm.submit" :disabled="!!why" :reason="why" @click="submit" @blocked="optsEl?.querySelector('button')?.focus()" />
        <RouterLink class="btn btn-secondary" to="/app/works">{{ ko.confirm.later }}</RouterLink>
      </div>
    </template>
  </main>
</template>

<style scoped>
.two{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-md)}
@media (max-width:768px){.two{grid-template-columns:1fr}}
.pane{margin:0;display:grid;gap:var(--s-sm);align-content:start}
.frame{aspect-ratio:4/3;border-radius:var(--r-md);background:var(--color-surface-soft);display:grid;place-items:center;overflow:hidden}
.frame img{width:100%;height:100%;object-fit:contain}
.stack-sm{display:grid;gap:var(--s-sm);align-content:start}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
/* UX2 같은 크기: 쓸 수 있는 칸·비활성 칸 모두 같은 칩, 줄마다 같은 폭·같은 높이(SD_02 §3-5 S3 선택지) */
.opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));grid-auto-rows:1fr}
.opts .chip-opt{width:100%;justify-content:center;text-align:center;word-break:keep-all}
</style>
