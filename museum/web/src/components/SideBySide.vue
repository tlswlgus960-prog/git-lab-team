<script setup lang="ts">
// C5 원본-결과 비교(T092, SD_02 §3-4 · UX4, BR-EXH-03, §17). 결과는 늘 정지 상태로 먼저 보이고,
// 재생은 누를 때만(다시 누르면 정지). 좁은 화면에서는 위아래로 쌓는다.
// 파일을 못 읽으면 그 자리에만 "지금은 불러올 수 없어요 · 다시 불러오기"(§17 규칙 1) — 결과를 다시 만들지 않는다.
// 2.5D 시차(WebGL)는 아직 없다 — 모델이 켜진 뒤 붙인다(T092 남은 몫). 그때까지 2.5D는 잘라 낸 그림 정지 화면.
import { ref, watch } from 'vue';
import { ko } from '@/copy/ko';
import { reducedMotion } from '@/composables/usePolling';

const props = withDefaults(defineProps<{
  originalUrl: string | null; still: string | null; video?: string | null; resultLabel: string; showOriginal?: boolean;
}>(), { video: null, showOriginal: true });
const emit = defineEmits<{ reload: [] }>();

const playing = ref(false);
const videoEl = ref<HTMLVideoElement | null>(null);
const broken = ref({ original: false, result: false });
watch(() => [props.originalUrl, props.still, props.video], () => { broken.value = { original: false, result: false }; playing.value = false; });

function toggle() {
  const v = videoEl.value;
  if (!v) return;
  if (playing.value) { v.pause(); playing.value = false; } else { void v.play().catch(() => { playing.value = false; }); playing.value = true; }
}
</script>

<template>
  <div class="sbs" :class="{ single: !showOriginal }">
    <figure v-if="showOriginal" class="pane">
      <figcaption class="t-body-sm"><b>{{ ko.review.original }}</b> - {{ ko.review.originalSub }}</figcaption>
      <div class="frame">
        <img v-if="originalUrl && !broken.original" :src="originalUrl" :alt="ko.review.original" @error="broken.original = true">
        <div v-else class="fail t-body-sm" role="status">
          {{ ko.fail.file }} <button class="btn btn-tertiary" type="button" @click="emit('reload')">{{ ko.fail.fileRetry }}</button>
        </div>
      </div>
    </figure>
    <figure class="pane">
      <figcaption class="t-body-sm"><b>{{ resultLabel }}</b></figcaption>
      <div class="frame">
        <template v-if="!broken.result">
          <video v-if="video" ref="videoEl" :src="video" :poster="still ?? undefined" playsinline loop muted preload="metadata"
            :aria-label="resultLabel" @error="broken.result = true" @ended="playing = false" />
          <img v-else-if="still" :src="still" :alt="resultLabel" @error="broken.result = true">
        </template>
        <div v-if="broken.result || (!video && !still)" class="fail t-body-sm" role="status">
          {{ ko.fail.file }} <button class="btn btn-tertiary" type="button" @click="emit('reload')">{{ ko.fail.fileRetry }}</button>
        </div>
      </div>
      <!-- 움직임 줄이기면 재생 토글 없이 정지 화면 + 원본(§17) -->
      <button v-if="video && !broken.result && !reducedMotion()" class="btn btn-secondary" type="button" :aria-pressed="playing" @click="toggle">
        {{ playing ? ko.review.pause : ko.review.play }}
      </button>
    </figure>
  </div>
</template>

<style scoped>
.sbs{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-md)}
.sbs.single{grid-template-columns:1fr}
@media (max-width:768px){.sbs{grid-template-columns:1fr}}
.pane{margin:0;display:grid;gap:var(--s-sm);align-content:start}
.frame{aspect-ratio:4/3;border-radius:var(--r-md);background:var(--color-surface-soft);display:grid;place-items:center;overflow:hidden}
.frame img,.frame video{width:100%;height:100%;object-fit:contain}
.fail{padding:var(--s-md);text-align:center}
</style>
