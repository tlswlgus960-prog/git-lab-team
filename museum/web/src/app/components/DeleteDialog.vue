<script setup lang="ts">
// S9 삭제 확인과 진행(T101, SD_02 §12, UC7 BF1~BF4·A3·E5, G18·G19, D21·D22 ④). 대화상자 — S4 상세(작품)·S1(아이)에서 연다.
// 확인: 지워지는 것·남는 것(통계 숫자)·되돌릴 수 없음. 삭제하면 202 → 삭제 진행을 폴링해 접수 → 멈춤 대기(G19 보류) → 파일 삭제 → 삭제했어요.
// 끝내 실패한 파일(삭제 미완료)도 보호자에게는 "삭제했어요"(S10에만 집계). 기다리지 않고 목록으로 가도 삭제는 계속된다.
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import { usePolling } from '@/composables/usePolling';
import { ko, problemCopy } from '@/copy/ko';

const props = withDefaults(defineProps<{ kind: 'artwork' | 'child'; id: string; alias?: string; count?: number }>(), { alias: '', count: 0 });
const emit = defineEmits<{ close: []; done: [] }>();
const router = useRouter();
const phase = ref<'confirm' | 'sending' | 'progress'>('confirm');
const state = ref<string>('accepted');
const block = ref<Notice | null>(null);
const box = ref<HTMLElement | null>(null);
const base = computed(() => `/v1/${props.kind === 'artwork' ? 'artworks' : 'children'}/${encodeURIComponent(props.id)}`);
const hold = computed<Notice | null>(() => (state.value === 'waiting_stop'
  ? { ...problemCopy({ gate: 'G19', reason: 'waiting_stop' }), actions: [ko.del.toList], gate: 'G19', fields: [] } : null));

onMounted(() => nextTick(() => box.value?.focus()));

async function tick(): Promise<boolean> {
  const r = await api.get<{ state: string }>(`${base.value}/deletion`);
  state.value = r.state;
  if (r.state === 'done') { emit('done'); if (props.kind === 'artwork') { poll.stop(); emit('close'); void router.push({ path: '/app/works', query: { deleted: '1' } }); } } // 끝나면 목록에서 "지웠어요"
  return r.state !== 'done';
}
const poll = usePolling(tick);

async function remove() {
  if (phase.value === 'sending') return;
  phase.value = 'sending'; block.value = null;
  try {
    await api.del(base.value);
    phase.value = 'progress'; state.value = 'accepted';
    if (await tick().catch(() => true)) poll.start();
  } catch (e) {
    phase.value = 'confirm';
    const err = e instanceof ApiError ? e : new ApiError(0, null);
    // 착수 실패(503 not_saved 등)는 G18 "삭제되지 않았어요 - 아무것도 바뀌지 않았어요"
    block.value = err.status === 404 ? toBlock(err) : { ...problemCopy({ gate: 'G18', reason: 'deletion_not_saved' }), actions: [...problemCopy({ gate: 'G18', reason: 'deletion_not_saved' }).actions], gate: 'G18', fields: [] };
  }
}
async function toList() { poll.stop(); emit('close'); await router.push(props.kind === 'artwork' ? { path: '/app/works', query: state.value === 'done' ? { deleted: '1' } : {} } : '/app/children'); }
function onBlock(label: string) { if (label === ko.del.toList || label === '목록으로') void toList(); else void remove(); }
</script>

<template>
  <section ref="box" class="gblock is-final dlg stack-sm" role="alertdialog" aria-labelledby="dl-t" tabindex="-1">
    <template v-if="phase !== 'progress'">
      <p id="dl-t" class="head">{{ kind === 'artwork' ? ko.del.artworkTitle : ko.del.title }}</p>
      <ul class="items">
        <template v-if="kind === 'artwork'"><li v-for="t in ko.del.artworkItems" :key="t">{{ t }}</li></template>
        <li v-else>{{ ko.del.childItems(alias, count) }}</li>
      </ul>
      <p class="t-body-sm">{{ ko.del.keeps }}</p>
      <BlockNotice v-if="block" :notice="block" @action="onBlock" />
      <div class="acts">
        <button class="btn btn-primary" type="button" :aria-disabled="phase === 'sending' ? 'true' : undefined" @click="remove">{{ ko.del.confirm }}</button>
        <button class="btn btn-secondary" type="button" @click="emit('close')">{{ ko.del.cancel }}</button>
      </div>
    </template>
    <template v-else>
      <p id="dl-t" class="head" aria-live="polite">{{ ko.del.progress[state] ?? '' }}</p>
      <BlockNotice v-if="hold" :notice="hold" @action="onBlock" />
      <p v-if="state !== 'done'" class="t-body-sm">{{ ko.del.noWait }}</p>
      <div class="acts"><button class="btn btn-secondary" type="button" @click="toList">{{ ko.del.toList }}</button></div>
    </template>
  </section>
</template>

<style scoped>
.dlg{max-width:640px}
.stack-sm{display:grid;gap:var(--s-sm)}
.items{margin:0;padding-left:1.2em;font:330 16px/1.45 var(--font-sans)}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
</style>
