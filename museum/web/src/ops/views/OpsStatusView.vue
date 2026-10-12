<script setup lang="ts">
// S10 서비스 상태와 모델별 지표(T112, SD_02 §13, UC8 BF1~BF7·A6·E1·E4·E5, BR-OPS-02~04, D21).
// 세 역할이 읽고, 결과 미도달 추적 탭은 운영자에게만 그린다(§2-1). 가족 사진·이야기로 가는 경로가 없다(BR-ACC-03).
// 10초마다 다시 읽고, API가 답하지 않으면 마지막 값과 시각을 두고 "갱신 불가"(§17 규칙 2). 분모 0은 "해당 없음".
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '@/api/client';
import type { components } from '@/api/types.gen';
import ModelStatusChip, { type LoadStatus } from '@/components/ModelStatusChip.vue';
import { usePolling } from '@/composables/usePolling';
import { ko } from '@/copy/ko';
import { useSession } from '@/stores/session';
import { CHECKABLE, checkText, loadChecks, type ModelCheck } from '../modelCheck';

type Metrics = components['schemas']['Metrics'];
type Manifest = components['schemas']['ModelManifest'];
type Unreached = components['schemas']['UnreachedItem'];

const s = useSession();
const isOperator = computed(() => (s.staff?.roles ?? []).includes('operator'));
const alive = ref<boolean | null>(null);
const readyState = ref<'ready' | 'not_ready' | null>(null);
const loads = ref<LoadStatus[] | null>(null);
const manifest = ref<Manifest[]>([]);
const metrics = ref<Metrics | null>(null);
const unreached = ref<Unreached[]>([]);
const period = ref<'d7' | 'd30' | 'all'>('d7');
const tab = ref<'models' | 'causes' | 'unreached'>('models');
const staleAt = ref<string | null>(null);
const lastOk = ref<Date | null>(null);
const checks = ref<ModelCheck[]>([]); // 마지막 점검(D20) — 읽기만, 점검 실행은 S11

const MODELS = ['M1', 'M2', 'M3', 'M5', 'M6', 'M7'];
const loadOf = (id: string) => loads.value?.find((m) => m.modelId === id) ?? null;
const groupOf = (id: string) => manifest.value.find((m) => m.modelId === id)?.servingGroup ?? '';
const exposedOf = (id: string) => manifest.value.find((m) => m.modelId === id)?.exposed ?? false;
const someNotReady = computed(() => MODELS.some((id) => id !== 'M6' && id !== 'M7' && loadOf(id)?.load?.state !== 'ready'));
const readyText = computed(() => (readyState.value === 'not_ready' ? ko.ops.readyNo : someNotReady.value ? ko.ops.readySome : ko.ops.readyAll));
function impact(id: string): string {
  const l = loadOf(id);
  if (l?.load?.state === 'ready') return id === 'M5' && l.execDevice === 'cpu' ? ko.ops.impact.cpu ?? '' : '';
  if (id === 'M7' && exposedOf(id)) return '';
  return ko.ops.impact[id] ?? '';
}

const rate = (v: number | null | undefined) => (v == null ? ko.ops.na : v.toFixed(2));
const fromOf = (p: string) => (p === 'all' ? undefined : new Date(Date.now() - (p === 'd7' ? 7 : 30) * 86400000).toISOString());
const infraTotal = computed(() => Object.values(metrics.value?.causes?.infraFailure ?? {}).reduce((a, b) => a + (b ?? 0), 0));
const timeText = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

async function tick(): Promise<boolean> {
  const r = await fetch('/ready', { headers: { Accept: 'application/json' } }).catch(() => null);
  alive.value = !!r;
  readyState.value = r ? ((await r.json().catch(() => null)) as { status?: 'ready' | 'not_ready' } | null)?.status ?? null : null;
  try {
    const [l, m, man, u] = await Promise.all([
      api.get<{ models: LoadStatus[] }>('/v1/ops/models').then((x) => x.models).catch(() => null),
      api.get<Metrics>('/v1/admin/metrics', { query: { from: fromOf(period.value) } }),
      api.get<Manifest[]>('/v1/admin/models'),
      isOperator.value ? api.get<Unreached[]>('/v1/admin/unreached') : Promise.resolve([] as Unreached[]),
    ]);
    loads.value = l; metrics.value = m; manifest.value = man; unreached.value = u;
    checks.value = await loadChecks().catch(() => checks.value);
    lastOk.value = new Date(); staleAt.value = null;
  } catch {
    staleAt.value = lastOk.value ? timeText(lastOk.value) : '-';
  }
  return true;
}
const poll = usePolling(tick, [10000]);
onMounted(async () => { await tick(); poll.start(); });
watch(period, () => void tick());
</script>

<template>
  <main class="container page stack">
    <div class="summary tile" role="status">
      <span><b>{{ ko.ops.alive }}</b> {{ alive === null ? '' : alive ? ko.ops.aliveOk : ko.ops.aliveNo }}</span>
      <span><b>{{ ko.ops.ready }}</b> {{ readyState ? readyText : '' }}</span>
      <label><b>{{ ko.ops.period }}</b>
        <select v-model="period" class="input input-sm">
          <option v-for="(label, k) in ko.ops.periods" :key="k" :value="k">{{ label }}</option>
        </select>
      </label>
      <span v-if="staleAt" class="t-body-sm">{{ ko.fail.opsStale(staleAt) }}</span>
    </div>

    <section class="stack-sm" aria-labelledby="st-ready">
      <h2 id="st-ready" class="t-card-title">{{ ko.ops.readyTitle }}</h2>
      <div class="table-wrap" tabindex="0" role="region" :aria-label="ko.ops.readyTitle">
        <table class="plain">
          <thead><tr><th>{{ ko.ops.colModel }}</th><th>{{ ko.ops.colGroup }}</th><th>{{ ko.ops.colState }}</th><th>{{ ko.ops.colImpact }}</th><th>{{ ko.ops.colCheck }}</th></tr></thead>
          <tbody>
            <tr v-for="id in MODELS" :key="id">
              <td>{{ ko.ops.shortName[id] }}</td>
              <td>{{ ko.ops.group[groupOf(id)] ?? '' }}</td>
              <td><ModelStatusChip :model-id="id" :status="loads ? loadOf(id) : null" :exposed="exposedOf(id)" /></td>
              <td class="t-body-sm">{{ impact(id) }}</td>
              <td class="t-body-sm">{{ CHECKABLE.includes(id) ? checkText(checks.find((c) => c.modelId === id)) : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="metrics" class="stack-sm" aria-labelledby="st-metrics">
      <h2 id="st-metrics" class="t-card-title">{{ ko.ops.metricsTitle }}</h2>
      <div class="table-wrap" tabindex="0" role="region" :aria-label="ko.ops.metricsTitle">
        <table class="plain">
          <tbody>
            <tr><th scope="row">{{ ko.ops.firstApproval }}</th><td class="num">{{ rate(metrics.service?.firstApprovalRate) }}</td></tr>
            <tr><th scope="row">{{ ko.ops.modifyRate }}</th><td class="num">{{ rate(metrics.service?.suggestionModifyRate) }}</td></tr>
            <tr><th scope="row">{{ ko.ops.unreached }}</th><td class="num">{{ metrics.service?.unreachedCount ?? 0 }}</td></tr>
            <tr><th scope="row">{{ ko.ops.delIncomplete }}</th><td class="num">{{ metrics.service?.deletionIncompleteCount ?? 0 }}</td></tr>
            <tr><th scope="row">{{ ko.ops.captionFail }}</th><td class="num">{{ rate(metrics.service?.captionRuleFailRate) }}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="tabs" role="tablist">
        <button v-for="k in (isOperator ? ['models', 'causes', 'unreached'] : ['models', 'causes'])" :key="k" class="tab" role="tab" type="button"
          :aria-selected="tab === k" @click="tab = k as typeof tab">{{ ko.ops.tabs[k] }}</button>
      </div>

      <div v-if="tab === 'models'" class="stack-sm" role="tabpanel">
        <div class="table-wrap" tabindex="0" role="region" :aria-label="ko.ops.tabs.models">
          <table class="plain">
            <thead><tr><th>{{ ko.ops.colModel }}</th><th>{{ ko.ops.colVersion }}</th><th>{{ ko.ops.colAttempts }}</th><th>{{ ko.ops.colDowngrade }}</th><th>{{ ko.ops.colP95 }}</th><th>{{ ko.ops.colRetry }}</th></tr></thead>
            <tbody>
              <tr v-for="(m, i) in metrics.models ?? []" :key="i">
                <td>{{ ko.ops.shortName[m.modelId ?? ''] ?? m.modelId }}</td><td>{{ m.modelVersion }}</td><td class="num">{{ m.attempts ?? 0 }}</td>
                <td class="num">{{ rate(m.downgradeRate) }}</td><td class="num">{{ m.p95Ms == null ? ko.ops.na : `${m.p95Ms}ms` }}</td><td class="num">{{ rate(m.retryRate) }}</td>
              </tr>
              <tr v-if="!(metrics.models ?? []).length"><td colspan="6" class="t-body-sm">{{ ko.ops.na }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="table-wrap" tabindex="0" role="region" :aria-label="ko.ops.colWaiting">
          <table class="plain">
            <thead><tr><th>{{ ko.ops.colGroup }}</th><th>{{ ko.ops.colWaiting }}</th><th>{{ ko.ops.colOldest }}</th></tr></thead>
            <tbody>
              <tr v-for="(q, i) in metrics.queues ?? []" :key="i">
                <td>{{ ko.ops.group[q.servingGroup ?? ''] ?? q.servingGroup }}</td><td class="num">{{ q.waiting ?? 0 }}</td>
                <td class="num">{{ q.oldestWaitSeconds == null ? ko.ops.na : `${q.oldestWaitSeconds}s` }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="(metrics.external ?? []).length" class="table-wrap" tabindex="0" role="region" :aria-label="ko.ops.colCalls">
          <table class="plain">
            <thead><tr><th>{{ ko.ops.colFunction }}</th><th>{{ ko.ops.colCalls }}</th><th>{{ ko.ops.colRejected }}</th></tr></thead>
            <tbody><tr v-for="(x, i) in metrics.external" :key="i"><td>{{ x.function }}</td><td class="num">{{ x.calls ?? 0 }}</td><td class="num">{{ x.rejected ?? 0 }}</td></tr></tbody>
          </table>
        </div>
      </div>

      <div v-else-if="tab === 'causes'" class="table-wrap" tabindex="0" :aria-label="ko.ops.tabs.causes" role="tabpanel">
        <table class="plain">
          <tbody>
            <tr><th scope="row">{{ ko.ops.causes.guardianChoice }}</th><td class="num">{{ metrics.causes?.guardianChoice ?? 0 }}</td></tr>
            <tr><th scope="row">{{ ko.ops.causes.modelDowngrade }}</th><td class="num">{{ metrics.causes?.modelDowngrade ?? 0 }}</td></tr>
            <tr><th scope="row">{{ ko.ops.causes.guardianSwitch }}</th><td class="num">{{ metrics.causes?.guardianSwitch ?? 0 }}</td></tr>
            <tr><th scope="row">{{ ko.ops.causes.infraFailure }}</th><td class="num">{{ infraTotal }}
              <span v-for="(n, k) in metrics.causes?.infraFailure ?? {}" :key="k" class="t-body-sm"> · {{ ko.ops.errorClass[k] ?? k }} {{ n }}</span></td></tr>
            <tr><th scope="row">{{ ko.ops.causes.unreached }}</th><td class="num">{{ metrics.causes?.unreached ?? 0 }}</td></tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="tab === 'unreached' && isOperator" class="stack-sm" role="tabpanel">
        <div class="table-wrap" tabindex="0" role="region" :aria-label="ko.ops.tabs.unreached">
          <table class="plain">
            <thead><tr><th>{{ ko.ops.colJob }}</th><th>{{ ko.ops.colModelVersion }}</th><th>{{ ko.ops.colErrorClass }}</th><th>{{ ko.ops.colAttempts }}</th></tr></thead>
            <tbody>
              <tr v-for="u in unreached" :key="u.stageJobId"><td>{{ u.stageJobId }}</td><td>{{ u.modelId }} {{ u.modelVersion }}</td><td>{{ ko.ops.errorClass[u.errorClass ?? ''] ?? u.errorClass }}</td><td class="num">{{ u.attempt }}</td></tr>
              <tr v-if="!unreached.length"><td colspan="4" class="t-body-sm">0</td></tr>
            </tbody>
          </table>
        </div>
        <p class="t-body-sm">{{ ko.ops.noFamilyPath }}</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.summary{display:flex;flex-wrap:wrap;gap:var(--s-md);align-items:center;font:330 16px/1.45 var(--font-sans)}
.summary b{font-weight:540;margin-right:6px}
.input-sm{min-height:40px;padding:6px 10px;width:auto;display:inline-block}
.stack-sm{display:grid;gap:var(--s-sm)}
.table-wrap{overflow-x:auto}
table.plain{width:100%;border-collapse:collapse;font:330 16px/1.45 var(--font-sans)}
table.plain th,table.plain td{text-align:left;padding:var(--s-sm) var(--s-sm) var(--s-sm) 0;border-bottom:1px solid var(--color-hairline-soft);vertical-align:middle}
table.plain thead th{font:400 12px/1 var(--font-mono);letter-spacing:.6px;text-transform:uppercase}
table.plain th[scope="row"]{font-weight:540}
.num{font-variant-numeric:tabular-nums}
</style>
