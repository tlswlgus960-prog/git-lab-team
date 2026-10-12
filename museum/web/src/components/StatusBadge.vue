<script setup lang="ts">
// C4 상태 배지(T039, SD_02 §3-4). 작품 상태 또는 단계 작업 상태 한 단어. 색이 아니라 문구와 점 모양(스타일가이드 .status).
import { computed } from 'vue';
import { ko } from '@/copy/ko';

const props = withDefaults(defineProps<{ state: string; kind?: 'artwork' | 'stage' }>(), { kind: 'artwork' });
const text = computed(() => {
  // 작품 배지는 보호자 말(D34 ④, SD_02 §17-8), 단계 배지는 운영용 그대로
  const dict: Record<string, string> = props.kind === 'stage' ? ko.stage : ko.guardian.chip;
  return dict[props.state] ?? props.state;
});
const quiet = computed(() => ['received', 'queued', 'cancelled'].includes(props.state));
</script>

<template>
  <span class="status" :class="{ 'is-quiet': quiet }" :data-state="state"><span class="dot" aria-hidden="true"></span>{{ text }}</span>
</template>
