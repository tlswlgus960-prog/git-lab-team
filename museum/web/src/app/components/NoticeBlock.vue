<script setup lang="ts">
// 안내 블록 — 막힘이 아닌 알림(SD_02 "안내" 블록: 메일함 확인, 같은 별칭 A5). 사라지지 않고, 나타나면 제목으로 포커스를 옮긴다.
// 모양은 C6 낮춤 안내와 같은 "테두리 없는 안내 블록"(§3-5 토큰 사상)을 쓴다.
import { nextTick, onMounted, ref } from 'vue';

defineProps<{ title: string }>();
const head = ref<HTMLElement | null>(null);
onMounted(() => nextTick(() => head.value?.focus()));
</script>

<template>
  <section class="downgrade notice-block" role="status">
    <p ref="head" class="head t-body" tabindex="-1"><b>{{ title }}</b></p>
    <div class="t-body-sm"><slot /></div>
    <div v-if="$slots.actions" class="acts"><slot name="actions" /></div>
  </section>
</template>

<style scoped>
.notice-block{display:grid;gap:var(--s-sm)}
.notice-block b{font-weight:540}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
</style>
