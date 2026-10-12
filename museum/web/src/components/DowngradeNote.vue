<script setup lang="ts">
// C6 낮춤 안내(T079, SD_02 §3-4 · UX3, BR-FBK-03). S4·S5 전용 — 전시(S8)에는 쓰지 않는다(D3).
// 테두리 없는 안내 블록(§3-5). 숨기지 않고, 점수를 말하지 않는다.
import { computed } from 'vue';
import { ko } from '@/copy/ko';

const props = defineProps<{ path: string }>();
const pair = computed(() => ko.downgrade[props.path] ?? null);
</script>

<template>
  <p v-if="pair" class="downgrade t-body" role="note">{{ ko.downgradeNote(pair[0], pair[1]) }}</p>
</template>
