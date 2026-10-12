<script setup lang="ts">
// C8 전시 조건 체크(T093, SD_02 §3-4 · UX1, G12). 두 줄: 결과 확인 완료 · 제목-그린 날-나이 저장. 둘 다면 전시에 걸린다.
// 보호자에게 G번호 · [X]를 보이지 않는다(D34 ④, SD_02 §17-8) — ✓ / ○, 게이트는 data-gate에만.
import { ko } from '@/copy/ko';

defineProps<{ reviewed: boolean; storyDone: boolean }>();
</script>

<template>
  <section class="tile stack-sm" aria-labelledby="ex-cond">
    <p id="ex-cond" class="t-body" data-gate="G12"><b>{{ ko.story.exhibitTitle }}</b></p>
    <ul class="cond">
      <li :data-done="reviewed"><span aria-hidden="true" class="mk">{{ reviewed ? '✓' : '○' }}</span> {{ ko.story.condReview }}<span class="sr"> - {{ reviewed ? ko.guardian.done : ko.guardian.notYet }}</span></li>
      <li :data-done="storyDone"><span aria-hidden="true" class="mk">{{ storyDone ? '✓' : '○' }}</span> {{ ko.story.condStory }}<span class="sr"> - {{ storyDone ? ko.guardian.done : ko.guardian.notYet }}</span></li>
    </ul>
    <p class="t-body-sm">{{ ko.story.condNote }}</p>
  </section>
</template>

<style scoped>
.stack-sm{display:grid;gap:var(--s-xs)}
.cond{list-style:none;margin:0;padding:0;display:grid;gap:4px;font:330 16px/1.45 var(--font-sans)}
.cond .mk{display:inline-block;width:1.2em;font-weight:700}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style>
