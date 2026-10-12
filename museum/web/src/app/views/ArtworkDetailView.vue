<script setup lang="ts">
// S4 진행 상세(T080, SD_02 §7-2·§7-4, UC3). 단계별 상태·다시 시도 횟수·낮춤 안내(C6)·모델 준비 대기(오류 아님)·G9 처리하지 못함.
// 전이 중 상태(received·judging·processing)일 때만 폴링하고, 다른 상태가 되면 그 화면으로 가는 버튼을 보인다.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import DowngradeNote from '@/components/DowngradeNote.vue';
import JourneyRail from '@/components/JourneyRail.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import ArtFrame from '@/components/ArtFrame.vue';
import CommentPanel from '@/components/CommentPanel.vue';
import AnimateAsk from '@/components/AnimateAsk.vue';
import { usePolling } from '@/composables/usePolling';
import { ko } from '@/copy/ko';
import NoticeBlock from '../components/NoticeBlock.vue';
import DeleteDialog from '../components/DeleteDialog.vue';
import { MOVING_STATES, blockOf, loadArtwork, nextActionLabel, notDeliveredBlock, railOf, routeFor, type ArtworkDetail } from '../artwork';

const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const a = ref<ArtworkDetail | null>(null);
const block = ref<Notice | null>(null);
const started = route.query.started === '1';
const deleting = ref(false);


const rail = computed(() => (a.value ? railOf(a.value.state) : null));
const g9 = computed(() => (a.value?.state === 'failed' ? notDeliveredBlock(a.value) : null));
const waitingQueue = computed(() => a.value?.state === 'processing' && a.value.stages.some((s) => s.status === 'waiting') && !a.value.stages.some((s) => s.status === 'running'));
const next = computed(() => (a.value ? nextActionLabel(a.value.state) : ''));
// 걸린 채 다시 만드는 중(D34 ② · D49 [예] 뒤): 단계 표는 숨기므로(D34 ④) 지금 무엇을 하는지 한 줄로 알린다
// 걸린 채(exhibited) 다시 만드는 중이면 진행 줄은 "걸었어요"에 두고 [전시 보기]도 남긴다(원본 액자는 그대로 걸려 있음)
const hungNow = computed(() => !!a.value?.exhibited && a.value.state === 'processing');
const askOpen = ref(false); // 질문 카드가 "만들기 시작했어요"를 보이는 동안 같은 말을 두 번 하지 않는다
const remaking = computed(() => {
  if (a.value?.state !== 'processing' || askOpen.value) return '';
  const what = ko.kind[a.value.confirmedKind ?? 'animated'] ?? '';
  if (waitingQueue.value) return ko.animAsk.remakeQueued(what);
  return a.value.stages.some((s) => s.status === 'retrying') ? ko.animAsk.remakeRetry(what) : ko.animAsk.remaking(what);
});
const shownRail = computed(() => (hungNow.value ? { current: 'exhibited', variant: 'default' as const, gate: null } : rail.value));
const nextShown = computed(() => (hungNow.value ? nextActionLabel('exhibited') : next.value));

async function load(): Promise<boolean> {
  a.value = await loadArtwork(id);
  block.value = null;
  return MOVING_STATES.includes(a.value.state);
}
const poll = usePolling(load);
async function first() {
  try { if (await load()) poll.start(); } catch (e) { block.value = blockOf(e); }
}
onMounted(first);

function onBlock(label: string) {
  if (label === ko.list.toReview && a.value) void router.push(routeFor(a.value));
  else void router.push('/app/works');
}
function stageNote(s: ArtworkDetail['stages'][number]): string {
  if (s.waitingForModel) return s.etaSeconds ? `${ko.wait.model} - ${ko.wait.modelEta(Math.ceil(s.etaSeconds))}` : ko.wait.model;
  if ((s.attempt ?? 0) > 1 && (s.status === 'retrying' || s.status === 'failed')) return ko.list.retried((s.attempt ?? 1) - 1);
  return '';
}
</script>

<template>
  <main class="container page stack">
    <RouterLink class="t-body-sm" to="/app/works">{{ ko.list.backToList }}</RouterLink>
    <BlockNotice v-if="block" :notice="block" @action="onBlock" />
    <!-- D38 작업대: 큰 액자(수장고 액자에서 이어지는 공유 요소) + 작업 카드 -->
    <div v-if="a && rail" class="bench">
    <figure class="bench-art" :style="{ viewTransitionName: `art-${a.id}` }">
      <ArtFrame v-tilt size="lg" variant="gold" :src="(a as { photoUrl?: string | null }).photoUrl ?? a.originalUrl ?? null" :alt="a.story?.title || ko.list.untitled" />
      <p class="bench-lock">🔒 {{ ko.up2.lockNote }}</p><!-- D46: 올린 작품은 전부 고정 · 삭제만 -->
    </figure>
    <section class="card stack bench-card">
      <JourneyRail :current="shownRail!.current" :variant="waitingQueue && !hungNow ? 'waiting' : shownRail!.variant" :gate="shownRail!.gate" :blocked-label="rail.blockedLabel" />
      <NoticeBlock v-if="started" :title="ko.confirm.started"><p>{{ ko.rail.leaveOk }}</p></NoticeBlock>
      <NoticeBlock v-if="remaking && !started" :title="remaking"><p>{{ ko.animAsk.remakeHint }}</p></NoticeBlock>
      <h1 class="t-headline">{{ ko.list.detailTitle(a.story?.title || ko.list.untitled) }}</h1>

      <!-- 모델 단계 표는 보호자에게 보이지 않는다(D34 ④, SD_02 §17-8) — 운영 화면에서 본다 -->

      <DowngradeNote v-if="a.downgrade" :path="a.downgrade" />
      <BlockNotice v-if="g9" :notice="g9" @action="onBlock" />
      <div class="acts">
        <RouterLink v-if="nextShown && !g9" class="btn btn-primary" :to="a.state === 'exhibited' || hungNow ? `/app/museum/${a.childId}` : routeFor(a)">{{ nextShown }}</RouterLink>
        <button v-if="!deleting" class="btn btn-secondary" type="button" @click="deleting = true; poll.stop()">{{ ko.del.artwork }}</button>
      </div>
      <AnimateAsk v-if="!deleting" :artwork-id="id" @started="askOpen = true; first()" @closed="askOpen = false" /><!-- D49 움직임 질문(삭제 확인 중엔 숨김) -->
      <DeleteDialog v-if="deleting" kind="artwork" :id="id" @close="deleting = false" />
      <CommentPanel :artwork-id="id" /><!-- D46 ④ 가족 코멘트 -->
    </section>
    </div>
  </main>
</template>

<style scoped>
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
/* D38 작업대 */
.bench{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,1fr);gap:clamp(18px,4vw,48px);align-items:center;min-height:calc(100dvh - 220px)}
@media (max-width:860px){.bench{grid-template-columns:1fr;min-height:0}}
.bench-art{margin:0;display:grid;justify-items:center;gap:12px}
.bench-art :deep(.is-lg){--art-h:min(52vh,460px)}
.bench-lock{margin:0;font:600 13px/1.4 var(--font-sans);color:#7a4a1f;background:#fff4df;border-radius:10px;padding:6px 12px}
.bench-card{align-self:center}
.table-wrap{overflow-x:auto}
table.plain{width:100%;border-collapse:collapse;font:330 16px/1.45 var(--font-sans)}
table.plain th,table.plain td{text-align:left;padding:var(--s-sm) var(--s-sm) var(--s-sm) 0;border-bottom:1px solid var(--color-hairline-soft);vertical-align:middle}
table.plain th{font:400 12px/1 var(--font-mono);letter-spacing:.6px;text-transform:uppercase}
</style>
