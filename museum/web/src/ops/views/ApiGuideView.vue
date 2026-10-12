<script setup lang="ts">
// S12 API활용 메뉴(T125, SD_02 §15, UC11 BF2~BF6·A1·A4·A5·E2~E4, BR-API-07~09, G23·G25). 운영자·연동 개발만(§2-1).
// - 엔드포인트: GET /v1/admin/api-guide/spec의 4묶음을 경로 표로. 버전 대조가 어긋나면 경고(차단 아님). 명세를 못 읽으면 마지막 확인 명세와 시각.
// - 가이드라인·매뉴얼: docs/B/B_API활용_가이드라인_매뉴얼.md 본문(apiGuideContent.ts).
// - 시험 호출: 평가 묶음 작품만 고르는 드롭다운(파일 업로드 칸 없음). 202 → 상태 폴링 → H16 응답. 거절(G23·G25·G24·G2)은 C2.
import { computed, onMounted, ref } from 'vue';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import BlockNotice from '@/components/BlockNotice.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { usePolling } from '@/composables/usePolling';
import { ko } from '@/copy/ko';
import { GUIDELINE, MANUAL } from '../apiGuideContent';

type EvalItem = components['schemas']['EvalItem'];
interface Op { summary?: string }
interface Spec { paths?: Record<string, Record<string, Op>> }
interface Guide { groups?: { name?: string; spec?: Spec }[]; versionCheck?: { modelId?: string; specVersion?: string | null; activeVersion?: string | null; match?: boolean }[]; fetchedAt?: string | null; stale?: boolean }
interface ExtJob { jobId: string; function: string; status: string; outcome?: string | null; model?: { id?: string; version?: string }; durationMs?: number | null }

const tab = ref<'endpoints' | 'guideline' | 'manual'>('endpoints');
const guide = ref<Guide | null>(null);
const items = ref<EvalItem[] | null>(null);
const fn = ref<'segment' | 'classify' | 'pose' | 'relief'>('segment');
const itemId = ref('');
const job = ref<ExtJob | null>(null);
const busy = ref(false);
const block = ref<Notice | null>(null);

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const rows = computed(() => (guide.value?.groups ?? []).flatMap((g) => Object.entries(g.spec?.paths ?? {}).flatMap(([p, ops]) =>
  Object.entries(ops).filter(([m]) => METHODS.includes(m)).map(([m, op]) => ({
    group: g.name ?? '', path: `${m.toUpperCase()} ${p}`,
    tier: (op.summary ?? '').startsWith('(P0.5)') ? ko.apiGuide.p05 : p.endsWith('/pose') ? ko.apiGuide.internalKey : ko.apiGuide.p0,
  })))));
const mismatch = computed(() => (guide.value?.versionCheck ?? []).filter((v) => v.match === false));
const photoItems = computed(() => (items.value ?? []).filter((i) => i.kind !== 'caption_input'));
const why = computed(() => (!itemId.value ? ko.apiGuide.pickItem : busy.value ? ko.upload.sending : ''));
const when = (iso?: string | null) => (iso ? iso.slice(0, 19).replace('T', ' ') : '-');

/** **굵게**와 `코드`만 나눠 그린다(v-html 없이) */
function parts(line: string): { t: string; k: '' | 'b' | 'c' }[] {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean)
    .map((x) => (x.startsWith('**') ? { t: x.slice(2, -2), k: 'b' as const } : x.startsWith('`') ? { t: x.slice(1, -1), k: 'c' as const } : { t: x, k: '' as const }));
}

async function loadGuide() {
  try { guide.value = await api.get<Guide>('/v1/admin/api-guide/spec'); block.value = null; }
  catch (e) { block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null)); }
}
onMounted(async () => {
  await loadGuide();
  items.value = await api.get<EvalItem[]>('/v1/admin/eval-items').catch(() => []);
});

const poll = usePolling(async () => {
  if (!job.value) return false;
  job.value = await api.get<ExtJob>(`/v1/admin/api-guide/test-call/${job.value.jobId}`);
  return job.value.status === 'queued' || job.value.status === 'running';
});
async function call() {
  if (why.value) return;
  busy.value = true; block.value = null; job.value = null;
  try {
    job.value = await api.post<ExtJob>('/v1/admin/api-guide/test-call', { body: { function: fn.value, evalItemId: itemId.value } });
    poll.restart();
  } catch (e) { block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null)); }
  finally { busy.value = false; }
}
</script>

<template>
  <main class="container page stack">
    <div class="tabs" role="tablist">
      <button v-for="k in ['endpoints', 'guideline', 'manual']" :key="k" class="tab" role="tab" type="button" :aria-selected="tab === k"
        @click="tab = k as typeof tab">{{ ko.apiGuide.tabs[k] }}</button>
    </div>
    <BlockNotice v-if="block" :notice="block" @action="block = null" />

    <section v-if="tab === 'endpoints'" class="stack" role="tabpanel">
      <div class="tile row-acts" role="status">
        <span v-if="guide && !mismatch.length">{{ ko.apiGuide.versionOk }}</span>
        <span v-for="v in mismatch" :key="v.modelId" class="warn">{{ ko.apiGuide.versionBad(v.modelId ?? '', v.specVersion ?? '-', v.activeVersion ?? '-') }}</span>
        <span v-if="guide?.stale" class="t-body-sm">{{ ko.apiGuide.stale(when(guide.fetchedAt)) }}</span>
        <button class="btn btn-secondary btn-sm" type="button" @click="loadGuide">{{ ko.apiGuide.reload }}</button>
      </div>
      <div class="table-wrap" tabindex="0" role="region" :aria-label="ko.apiGuide.tabs.endpoints">
        <table class="plain">
          <thead><tr><th>{{ ko.apiGuide.colGroup }}</th><th>{{ ko.apiGuide.colPath }}</th><th>{{ ko.apiGuide.colTier }}</th></tr></thead>
          <tbody><tr v-for="r in rows" :key="r.group + r.path"><td>{{ r.group }}</td><td class="mono">{{ r.path }}</td><td>{{ r.tier }}</td></tr></tbody>
        </table>
      </div>

      <form class="card stack-sm" novalidate @submit.prevent="call">
        <h2 class="t-card-title">{{ ko.apiGuide.testTitle(fn) }}</h2>
        <div class="row-acts">
          <label class="field"><span>{{ ko.apiGuide.fn }}</span>
            <select v-model="fn" class="input"><option v-for="f in ['segment', 'classify', 'pose', 'relief']" :key="f" :value="f">{{ f }}</option></select></label>
          <label class="field"><span>{{ ko.apiGuide.input }}</span>
            <select v-model="itemId" class="input">
              <option value="" disabled>{{ photoItems.length ? ko.apiGuide.pickItem : ko.apiGuide.noItems }}</option>
              <option v-for="i in photoItems" :key="i.id" :value="i.id">{{ i.id }} - {{ i.kind }}</option>
            </select></label>
        </div>
        <div><ReasonButton :label="ko.apiGuide.call" :disabled="!!why" :reason="why" @click="call" /></div>
        <div v-if="job" class="table-wrap" tabindex="0" role="region" :aria-label="ko.apiGuide.call" aria-live="polite">
          <table class="plain">
            <thead><tr><th>{{ ko.apiGuide.colState }}</th><th>{{ ko.apiGuide.colOutcome }}</th><th>{{ ko.apiGuide.colModel }}</th><th>{{ ko.apiGuide.colTime }}</th></tr></thead>
            <tbody><tr>
              <td>{{ (ko.stage as Record<string, string>)[job.status] ?? job.status }}</td>
              <td>{{ job.outcome ? (ko.ops.errorClass[job.outcome] ?? job.outcome) : '' }}</td>
              <td class="mono">{{ job.model?.id }} {{ job.model?.version }}</td>
              <td class="num">{{ job.durationMs == null ? '' : `${job.durationMs}ms` }}</td>
            </tr></tbody>
          </table>
        </div>
        <p class="t-body-sm">{{ ko.apiGuide.noFamily }}</p>
      </form>
    </section>

    <section v-else class="card" role="tabpanel">
      <ol class="guide">
        <li v-for="(line, i) in (tab === 'guideline' ? GUIDELINE : MANUAL)" :key="i">
          <template v-for="(p, j) in parts(line)" :key="j"><b v-if="p.k === 'b'">{{ p.t }}</b><code v-else-if="p.k === 'c'">{{ p.t }}</code><template v-else>{{ p.t }}</template></template>
        </li>
      </ol>
    </section>
  </main>
</template>

<style scoped>
.stack-sm{display:grid;gap:var(--s-sm)}
.row-acts{display:flex;flex-wrap:wrap;gap:var(--s-md);align-items:center}
.row-acts .field{min-width:200px}
.warn{font-weight:540;border:2px solid var(--color-ink);border-radius:var(--r-sm);padding:2px 8px}
.table-wrap{overflow-x:auto}
table.plain{width:100%;border-collapse:collapse;font:330 16px/1.45 var(--font-sans)}
table.plain th,table.plain td{text-align:left;padding:var(--s-sm) var(--s-sm) var(--s-sm) 0;border-bottom:1px solid var(--color-hairline-soft);vertical-align:middle}
table.plain th{font:400 12px/1 var(--font-mono);letter-spacing:.6px;text-transform:uppercase}
.mono{font-family:var(--font-mono);font-size:14px}
.num{font-variant-numeric:tabular-nums}
.btn-sm{min-height:44px;font-size:16px;padding:6px 14px}
.guide{margin:0;padding-left:1.4em;display:grid;gap:var(--s-sm);font:330 16px/1.55 var(--font-sans)}
.guide code{font-family:var(--font-mono);font-size:14px;background:var(--color-surface-soft);padding:1px 4px;border-radius:4px}
</style>
