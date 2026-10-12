<script setup lang="ts">
// [음악](D42 B, SD_02 §17-15): 누르면 재생, 한 번 더 누르면 정지. 메뉴 줄(MuseumBar)이 사라지면(로그아웃 · 보호자 셸 밖) 멈춘다.
import { onBeforeUnmount } from 'vue';
import { failed, playing, stop, toggle } from './bgm';
import { sc } from './copy';

onBeforeUnmount(stop);
</script>

<template>
  <span class="music">
    <button class="mbar-pill music-btn" type="button" :aria-pressed="playing" :aria-label="sc.musicLabel" @click="toggle">
      <span aria-hidden="true">♪</span><span class="full"> {{ playing ? sc.musicStop : sc.music }}</span>
    </button>
    <span v-if="failed" class="music-fail" role="status">{{ sc.musicFail }}</span>
  </span>
</template>

<style scoped>
.music{position:relative;display:inline-flex}
.mbar-pill{display:inline-flex;align-items:center;gap:4px;min-height:44px;min-width:44px;justify-content:center;padding:8px 14px;border:1px solid var(--color-hairline);border-radius:var(--r-pill);
  background:var(--color-canvas);color:var(--color-ink);font:600 14px/1 var(--font-sans);cursor:pointer;white-space:nowrap}
.mbar-pill:hover{background:var(--color-surface-soft)}
.music-btn[aria-pressed="true"]{background:var(--color-block-lilac);border-color:var(--color-accent-magenta)}
.music-fail{position:absolute;top:calc(100% + 6px);right:0;z-index:43;white-space:nowrap;padding:6px 10px;border-radius:10px;background:var(--color-canvas);
  box-shadow:0 4px 12px rgba(74,52,65,.2);font:400 13px/1.3 var(--font-sans)}
@media (max-width:420px){.mbar-pill{padding:8px 10px}.full{display:none}}
</style>
