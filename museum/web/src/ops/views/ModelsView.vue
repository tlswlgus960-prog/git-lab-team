<script setup lang="ts">
// S11 모델 평가와 승격(T119, SD_02 §14, UC9 BF3~BF7·A1·A2·E6·E8, G20~G22, D5, clarify 2026-09-28 비활성화).
// - 매니페스트 표(GET /v1/admin/models)와 모델 상태 표(GET /v1/ops/models, 2초 폴링·숨김 탭 정지)는 세 역할이 읽는다.
// - 지금 불러오기는 운영자·평가 담당만, M6에는 버튼 없음(기동 때 1회만). 평가·판단·승격·롤백·비활성화는 평가 담당만(§2-1).
// - 평가는 버전의 latestEvalRunId로 새로 고친 뒤에도 이어 간다(계약 보완 2026-09-29).
// - 승격은 통과 판단 + 평가 완료(eligible) + 라이선스 확인일 때만. 그 밖은 사유 달린 C3, 서버 거절(G21·G22)은 C2.
import { computed, onMounted, ref } from 'vue';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import BlockNotice from '@/components/BlockNotice.vue';
import ModelStatusChip, { type LoadStatus } from '@/components/ModelStatusChip.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { usePolling } from '@/composables/usePolling';
import { ko, problemCopy } from '@/copy/ko';
import { useSession } from '@/stores/session';
import { CHECKABLE, checkBusy, checkText, loadChecks, type ModelCheck } from '../modelCheck';

type Manifest = components['schemas']['ModelManifest'];
type Version = components['schemas']['ModelVersion'];
type EvalRun = components['schemas']['EvalRun'];

const s = useSession();
const roles = computed(() => s.staff?.roles ?? []);
const isEval = computed(() => roles.value.includes('evaluator') || roles.value.includes('operator')); // 평가·승격 조작 — 운영자는 모든 권한(SD_02 §2-1, 2026-09-30)
const canWarm = computed(() => roles.value.includes('evaluator') || roles.value.includes('operator'));

const manifest = ref<Manifest[] | null>(null);
const loads = ref<LoadStatus[] | null>(null);
const open = ref<string | null>(null);
const runs = ref<Record<string, EvalRun>>({});
const reportOpen = ref<string | null>(null);
const verdict = ref<Record<string, 'pass' | 'hold' | ''>>({});
const rationale = ref<Record<string, string>>({});
const reason = ref('');
const confirmOff = ref(false);
const busy = ref(false);
const block = ref<Notice | null>(null);

const byState = (m: Manifest, st: string) => (m.versions ?? []).filter((v) => v.releaseState === st);
const active = (m: Manifest) => byState(m, 'active')[0] ?? null;
const rollbackCand = (m: Manifest) => byState(m, 'rollback_candidate')[0] ?? null;
const loadOf = (id: string) => loads.value?.find((x) => x.modelId === id) ?? null;
const opened = computed(() => manifest.value?.find((m) => m.modelId === open.value) ?? null);
const hash = (v: Version | null) => (v?.weightsSha256 ? `${v.weightsSha256.slice(0, 8)}` : ko.ops.none);

async function loadManifest() {
  manifest.value = await api.get<Manifest[]>('/v1/admin/models');
  if (isEval.value) {
    const ids = manifest.value.flatMap((m) => (m.versions ?? []).map((v) => v.latestEvalRunId)).filter((x): x is string => !!x && !runs.value[x]);
    await Promise.all(ids.map(async (id) => { runs.value[id] = await api.get<EvalRun>(`/v1/admin/eval-runs/${id}`); }));
  }
}
async function tickLoads(): Promise<boolean> {
  loads.value = await api.get<{ models: LoadStatus[] }>('/v1/ops/models').then((x) => x.models).catch(() => null);
  // 마지막 점검(D20, T157) — 같은 주기로 다시 읽는다. 못 읽으면 마지막 값 유지(§17)
  checks.value = await loadChecks().catch(() => checks.value);
  // 평가 중인 기록은 같은 주기로 진행을 다시 읽는다
  if (isEval.value) {
    const live = Object.values(runs.value).filter((r) => r.id && (r.itemDone ?? 0) < (r.itemTotal ?? 0));
    await Promise.all(live.map(async (r) => { runs.value[r.id!] = await api.get<EvalRun>(`/v1/admin/eval-runs/${r.id}`); }));
  }
  return true;
}
const poll = usePolling(tickLoads, [2000]);
onMounted(async () => {
  try { await loadManifest(); } catch (e) { block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null)); }
  await tickLoads(); poll.start();
});

async function act(fn: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true; block.value = null;
  try { await fn(); await loadManifest(); }
  catch (e) { block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null)); }
  finally { busy.value = false; }
}
const warmup = (id: string) => act(() => api.post(`/v1/ops/models/${id}/warmup`));
// 점검: 버전·사진은 서버가 고른다(활성, 없으면 최근 후보). 결과는 폴링으로 "마지막 점검" 칸에(SD_02 §14-3)
const checks = ref<ModelCheck[]>([]);
const checkOf = (id: string) => checks.value.find((c) => c.modelId === id) ?? null;
const runCheck = (id: string) => act(async () => {
  const c = await api.post<ModelCheck>(`/v1/ops/models/${id}/check`);
  checks.value = [c, ...checks.value.filter((x) => x.modelId !== id)];
});
const evaluate = (m: Manifest, v: Version) => act(async () => {
  const r = await api.post<EvalRun>(`/v1/admin/models/${m.modelId}/evaluate`, { body: { versionId: v.id } });
  if (r.id) runs.value[r.id] = r;
});
const judge = (runId: string) => act(async () => {
  runs.value[runId] = await api.patch<EvalRun>(`/v1/admin/eval-runs/${runId}`, { body: { verdict: verdict.value[runId], rationale: rationale.value[runId] } });
});
const promote = (m: Manifest, v: Version) => act(() => api.post(`/v1/admin/models/${m.modelId}/promote`, { body: { versionId: v.id, evalRunId: v.latestEvalRunId } }));
const rollback = (m: Manifest) => act(async () => { await api.post(`/v1/admin/models/${m.modelId}/rollback`, { body: { reason: reason.value.trim() } }); reason.value = ''; });
const deactivate = (m: Manifest) => act(async () => { await api.post(`/v1/admin/models/${m.modelId}/deactivate`, { body: { reason: reason.value.trim() } }); reason.value = ''; confirmOff.value = false; });

function promoteWhy(v: Version): string {
  const r = v.latestEvalRunId ? runs.value[v.latestEvalRunId] : null;
  if (!r) return ko.ops.evalNone;
  if (!v.licenseConfirmed) return problemCopy({ gate: 'G22', reason: 'license_unconfirmed' }).reason;
  if (!r.eligible || r.verdict !== 'pass') return ko.ops.notEligible;
  return busy.value ? ko.upload.sending : '';
}
function judgeWhy(runId: string): string {
  if (!verdict.value[runId]) return ko.ops.pickVerdict;
  if (!(rationale.value[runId] ?? '').trim()) return ko.ops.needRationale;
  return busy.value ? ko.upload.sending : '';
}
const candidates = (m: Manifest) => byState(m, 'candidate');
</script>

<template>
  <main class="container page stack">
    <p v-if="!isEval" class="t-body-sm">{{ ko.ops.readOnly }}</p>
    <BlockNotice v-if="block" :notice="block" @action="block = null" />

    <!-- 매니페스트 -->
    <div v-if="manifest" class="table-wrap" tabindex="0" role="region" :aria-label="ko.shell.menu.models">
      <table class="plain">
        <thead><tr><th>{{ ko.ops.colModel }}</th><th>{{ ko.ops.colActive }}</th><th>{{ ko.ops.colRollback }}</th><th>{{ ko.ops.colCandidate }}</th><th>{{ ko.ops.colLicense }}</th><th>{{ ko.ops.colHash }}</th></tr></thead>
        <tbody>
          <tr v-for="m in manifest" :key="m.modelId" :class="{ sel: open === m.modelId }">
            <td><button class="linkish" type="button" :aria-expanded="open === m.modelId" @click="open = open === m.modelId ? null : m.modelId!">{{ ko.ops.longName[m.modelId ?? ''] ?? m.modelId }}</button></td>
            <td>{{ active(m)?.version ?? ko.ops.none }}</td>
            <td>{{ rollbackCand(m)?.version ?? ko.ops.none }}</td>
            <td>{{ candidates(m).map((v) => v.version).join(', ') || ko.ops.none }}</td>
            <td>{{ (active(m) ?? candidates(m).at(-1)) ? ((active(m) ?? candidates(m).at(-1))!.licenseConfirmed ? ko.ops.licenseOk : ko.ops.licenseNo) : ko.ops.none }}</td>
            <td class="mono">{{ hash(active(m) ?? candidates(m).at(-1) ?? null) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 모델 상태 -->
    <section class="stack-sm" aria-labelledby="md-state">
      <h2 id="md-state" class="t-card-title">{{ ko.ops.statusTitle }}</h2>
      <p class="t-body-sm">{{ ko.ops.checkNotPromotion }}</p>
      <div class="table-wrap" tabindex="0" role="region" :aria-label="ko.ops.statusTitle">
        <table class="plain">
          <thead><tr><th>{{ ko.ops.colModel }}</th><th>{{ ko.ops.colDevice }}</th><th>{{ ko.ops.colLoad }}</th><th>{{ ko.ops.colQueue }}</th><th>{{ ko.ops.colCheck }}</th><th>{{ ko.ops.colAction }}</th></tr></thead>
          <tbody>
            <tr v-for="id in ['M1', 'M2', 'M3', 'M5', 'M6', 'M7']" :key="id">
              <td>{{ ko.ops.longName[id] }}</td>
              <td>{{ loadOf(id)?.execDevice ? loadOf(id)!.execDevice!.toUpperCase() : '' }}</td>
              <td><ModelStatusChip :model-id="id" :status="loads ? loadOf(id) : null" :exposed="manifest?.find((m) => m.modelId === id)?.exposed ?? false" /></td>
              <td class="num">{{ (loadOf(id) as { queue?: { waiting?: number } } | null)?.queue?.waiting ?? '' }}</td>
              <td class="t-body-sm" :data-check="checkOf(id)?.status ?? 'none'">{{ CHECKABLE.includes(id) ? checkText(checkOf(id)) : '' }}</td>
              <td class="acts">
                <button v-if="canWarm && id !== 'M6' && ['not_loaded', 'failed'].includes(loadOf(id)?.load?.state ?? '')" class="btn btn-secondary btn-sm" type="button"
                  :disabled="busy" @click="warmup(id)">{{ ko.ops.warmup }}</button>
                <ReasonButton v-if="canWarm && CHECKABLE.includes(id)" :label="ko.ops.check" variant="secondary"
                  :disabled="checkBusy(checkOf(id)) || busy" :reason="checkBusy(checkOf(id)) ? ko.ops.checking : busy ? ko.upload.sending : ''" @click="runCheck(id)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 모델별 평가·승격(평가 담당) -->
    <section v-if="opened && isEval" class="stack" :aria-label="ko.ops.longName[opened.modelId ?? '']">
      <article v-for="v in candidates(opened)" :key="v.id" class="card stack-sm">
        <h2 class="t-card-title">{{ ko.ops.evalTitle(ko.ops.longName[opened.modelId ?? ''] ?? '', v.version) }}</h2>
        <template v-if="v.latestEvalRunId && runs[v.latestEvalRunId]">
          <p class="t-body">{{ ko.ops.evalProgress(runs[v.latestEvalRunId]!.itemDone ?? 0, runs[v.latestEvalRunId]!.itemTotal ?? 0, runs[v.latestEvalRunId]!.incompleteCount ?? 0) }}
            <span v-if="runs[v.latestEvalRunId]!.verdict"> · {{ ko.ops.verdict[runs[v.latestEvalRunId]!.verdict!] }}</span></p>
        </template>
        <p v-else class="t-body-sm">{{ ko.ops.evalNone }}</p>
        <div class="acts">
          <button class="btn btn-secondary" type="button" :disabled="busy" @click="evaluate(opened, v)">{{ ko.ops.evalRequest }}</button>
          <button v-if="v.latestEvalRunId" class="btn btn-secondary" type="button" :aria-expanded="reportOpen === v.latestEvalRunId"
            @click="reportOpen = reportOpen === v.latestEvalRunId ? null : v.latestEvalRunId!">{{ ko.ops.report }}</button>
        </div>

        <div v-if="reportOpen && reportOpen === v.latestEvalRunId && runs[reportOpen]" class="table-wrap" tabindex="0" role="region" :aria-label="ko.ops.colItem">
          <table class="plain">
            <thead><tr><th>{{ ko.ops.colItem }}</th><th>{{ ko.ops.colStatus }}</th><th>{{ ko.ops.colExpected }}</th><th>{{ ko.ops.colActual }}</th><th>{{ ko.ops.colDowngradeReason }}</th><th>{{ ko.ops.colMisclass }}</th><th>{{ ko.ops.colTime }}</th></tr></thead>
            <tbody>
              <tr v-for="r in runs[reportOpen]!.results ?? []" :key="r.evalItemId">
                <td>{{ r.evalItemId }}</td><td>{{ r.status }}</td><td>{{ ko.kind[r.expectedPath ?? ''] ?? r.expectedPath }}</td><td>{{ ko.kind[r.actualPath ?? ''] ?? r.actualPath }}</td>
                <td>{{ r.downgradeReason }}</td><td>{{ r.misclassCode }}</td><td class="num">{{ r.durationMs == null ? '' : `${r.durationMs}ms` }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <fieldset v-if="v.latestEvalRunId" class="stack-sm judge">
          <legend class="t-body"><b>{{ ko.ops.judge }}</b></legend>
          <div class="acts" role="radiogroup">
            <button v-for="k in ['pass', 'hold']" :key="k" class="chip-opt" type="button" role="radio"
              :aria-pressed="verdict[v.latestEvalRunId] === k" :aria-checked="verdict[v.latestEvalRunId] === k"
              @click="verdict[v.latestEvalRunId!] = k as 'pass' | 'hold'">{{ ko.ops.verdict[k] }}</button>
          </div>
          <label class="field"><span>{{ ko.ops.rationale }}</span>
            <textarea v-model="rationale[v.latestEvalRunId]" class="input" rows="2" maxlength="2000"></textarea></label>
          <div><ReasonButton :label="ko.ops.judge" variant="secondary" :disabled="!!judgeWhy(v.latestEvalRunId)" :reason="judgeWhy(v.latestEvalRunId)" @click="judge(v.latestEvalRunId!)" /></div>
        </fieldset>

        <div><ReasonButton :label="ko.ops.promote" :disabled="!!promoteWhy(v)" :reason="promoteWhy(v)" @click="promote(opened, v)" /></div>
      </article>

      <article v-if="active(opened)" class="card stack-sm">
        <h2 class="t-card-title">{{ ko.ops.colActive }} {{ active(opened)!.version }}</h2>
        <label class="field"><span>{{ ko.ops.reason }}</span><input v-model="reason" class="input" maxlength="500"></label>
        <div class="acts">
          <ReasonButton v-if="rollbackCand(opened)" :label="ko.ops.rollback" variant="secondary" :disabled="!reason.trim() || busy" :reason="reason.trim() ? '' : ko.ops.needReason" @click="rollback(opened)" />
          <template v-else>
            <ReasonButton :label="ko.ops.rollback" variant="secondary" disabled :reason="ko.ops.noRollback" />
            <ReasonButton :label="ko.ops.deactivate" variant="secondary" :disabled="!reason.trim() || busy" :reason="reason.trim() ? '' : ko.ops.needReason" @click="confirmOff = true" />
          </template>
        </div>
        <section v-if="confirmOff" class="gblock is-final" role="alertdialog" aria-labelledby="off-t">
          <p id="off-t" class="head">{{ ko.ops.deactivateConfirm }}</p>
          <div class="acts">
            <button class="btn btn-primary" type="button" @click="deactivate(opened)">{{ ko.ops.deactivate }}</button>
            <button class="btn btn-secondary" type="button" @click="confirmOff = false">{{ ko.review.cancel }}</button>
          </div>
        </section>
      </article>
    </section>
  </main>
</template>

<style scoped>
.stack-sm{display:grid;gap:var(--s-sm)}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm);align-items:center}
.table-wrap{overflow-x:auto}
table.plain{width:100%;border-collapse:collapse;font:330 16px/1.45 var(--font-sans)}
table.plain th,table.plain td{text-align:left;padding:var(--s-sm) var(--s-sm) var(--s-sm) 0;border-bottom:1px solid var(--color-hairline-soft);vertical-align:middle}
table.plain thead th{font:400 12px/1 var(--font-mono);letter-spacing:.6px;text-transform:uppercase}
tr.sel td{font-weight:540}
.linkish{border:0;background:none;padding:0;font:inherit;color:var(--color-ink);text-decoration:underline;text-underline-offset:4px;cursor:pointer}
.mono,.num{font-variant-numeric:tabular-nums;font-family:var(--font-mono);font-size:14px}
.btn-sm{min-height:44px;font-size:16px;padding:6px 14px}
fieldset{border:0;margin:0;padding:0}
.judge .field span{font:330 16px/1.45 var(--font-sans)}
</style>
