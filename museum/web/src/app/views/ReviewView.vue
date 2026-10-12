<script setup lang="ts">
// S5 결과 확인(T094, SD_02 §8, UC4 BF3~BF5·A1·A2·A5·A6·E7, G9·G10·G3, BR-APR-02·06, EXT2).
// 선택지는 API가 준 것만(choices + unavailableChoices, 비활성은 C3). 원본-결과 나란히(C5), 낮춤 안내(C6)는 숨기지 않는다.
// 다시 찍기는 확인 창 뒤 결정 → S2(아이 미리 선택). 결정 응답의 artwork는 retake면 null(계약 73cd625).
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import DowngradeNote from '@/components/DowngradeNote.vue';
import JourneyRail from '@/components/JourneyRail.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import SideBySide from '@/components/SideBySide.vue';
import { ko } from '@/copy/ko';
import { DECISION_ORDER, blockOf, loadArtwork, notDeliveredBlock, railOf, resultImage, routeFor, type ArtworkDetail } from '../artwork';

const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const a = ref<ArtworkDetail | null>(null);
const busy = ref(false);
const block = ref<Notice | null>(null);
const asking = ref(false);
const dialogEl = ref<HTMLElement | null>(null);

const rail = computed(() => (a.value ? railOf(a.value.state) : null));
const g9 = computed(() => (a.value?.state === 'failed' ? notDeliveredBlock(a.value) : null));
const img = computed(() => (a.value ? resultImage(a.value) : { still: null, video: null }));
const resultLabel = computed(() => ko.review.result(ko.kind[a.value?.result?.kind ?? 'frame'] ?? ''));

type Opt = { code: string; ok: boolean; reason: string };
const options = computed<Opt[]>(() => {
  if (!a.value) return [];
  const off = new Map((a.value.unavailableChoices ?? []).map((u) => [u.choice, u.reason]));
  return DECISION_ORDER.filter((c) => a.value!.choices.includes(c) || off.has(c))
    .map((c) => ({ code: c, ok: a.value!.choices.includes(c), reason: off.has(c) ? ko.review.unavailable[off.get(c)!] ?? '' : '' }));
});

async function load() {
  try {
    const d = await loadArtwork(id);
    if (d.state !== 'awaiting_review' && d.state !== 'failed') { await router.replace(routeFor(d)); return; }
    a.value = d; block.value = null;
  } catch (e) { block.value = blockOf(e); }
}
onMounted(load);

async function decide(code: string) {
  if (busy.value || !a.value) return;
  if (code === 'retake' && !asking.value) { asking.value = true; await nextTick(); dialogEl.value?.focus(); return; }
  asking.value = false;
  busy.value = true; block.value = null;
  try {
    const out = await api.post<{ artwork: ArtworkDetail | null; alreadyDecided: boolean; retake?: { childId?: string } }>(
      `/v1/artworks/${encodeURIComponent(id)}/decision`, { body: { decision: code } });
    if (code === 'retake') {
      await router.push({ path: '/app/upload', query: { child: out.retake?.childId ?? a.value.childId, retakeOf: id } });
    } else if (code === 'use_lower') {
      await router.push({ path: `/app/artworks/${id}`, query: { started: '1' } });
    } else {
      // D49 보강(SD_02 §17-9): 바꿔 건 그림이 벽에 걸리는 장면으로(이야기는 올릴 때 이미 적었고 고정 — D46)
      await router.push({ path: '/app', query: { child: out.artwork?.childId ?? a.value.childId, hung: id } });
    }
  } catch (e) {
    block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null));
    await load();
  } finally { busy.value = false; }
}
async function onBlock(label: string) {
  if (label === '목록으로') await router.push('/app/works');
  else if (label === '다시 저장') await load();
}
</script>

<template>
  <main class="container page stack">
    <template v-if="a && rail">
      <JourneyRail :current="rail.current" :variant="rail.variant" :gate="rail.gate" :blocked-label="rail.blockedLabel" />
      <h1 class="t-headline">{{ a.story?.title || ko.list.untitled }}</h1>
      <BlockNotice v-if="g9" :notice="g9" />
      <!-- 처리하지 못함: 결과가 없으니 원본만(결과 자리를 "불러올 수 없음"으로 꾸미지 않는다, 원칙 3) -->
      <SideBySide v-if="a.state === 'failed'" :original-url="null" :still="a.originalUrl ?? null" :result-label="ko.review.original" :show-original="false" @reload="load" />
      <SideBySide v-else :original-url="a.originalUrl ?? null" :still="img.still" :video="img.video" :result-label="resultLabel" @reload="load" />
      <DowngradeNote v-if="a.downgrade" :path="a.downgrade" />
    </template>
    <BlockNotice v-if="block" :notice="block" @action="onBlock" />

    <section v-if="a" class="stack-sm" aria-labelledby="rv-how">
      <h2 id="rv-how" class="t-card-title">{{ ko.confirm.howTitle }}</h2>
      <div class="acts">
        <template v-for="o in options" :key="o.code">
          <ReasonButton v-if="o.ok" :label="ko.review.decision[o.code] ?? o.code" :variant="o.code === 'like' ? 'primary' : 'secondary'"
            :disabled="busy" :reason="busy ? ko.upload.sending : ''" @click="decide(o.code)" />
          <ReasonButton v-else :label="ko.review.decision[o.code] ?? o.code" disabled :reason="o.reason" variant="secondary" />
        </template>
      </div>
      <p v-if="a.choices.includes('use_lower')" class="t-body-sm">{{ ko.review.afterLower }}</p>
    </section>

    <section v-if="asking" ref="dialogEl" class="gblock is-final" role="alertdialog" aria-labelledby="rt-t" aria-describedby="rt-b" tabindex="-1">
      <p id="rt-t" class="head">{{ ko.review.retakeTitle }}</p>
      <p id="rt-b">{{ ko.review.retakeBody }}</p>
      <div class="acts">
        <button class="btn btn-primary" type="button" @click="decide('retake')">{{ ko.review.decision.retake }}</button>
        <button class="btn btn-secondary" type="button" @click="asking = false">{{ ko.review.cancel }}</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.stack-sm{display:grid;gap:var(--s-sm)}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
</style>
