<script setup lang="ts">
// 벽 색 고르기(D31 ①, SD_02 §17-6): 연한 색 6개 + 직접 고르기 + 처음 색으로. 글자 대비 4.5:1이 안 되면 밝게 보정하고 알린다.
import { ref } from 'vue';
import { ko } from '@/copy/ko';
import { WALL_PRESETS, readableWall } from './prefs';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [hex: string]; reset: []; close: [] }>();
const adjusted = ref(false);
function pick(hex: string) { const r = readableWall(hex); adjusted.value = r.adjusted; emit('update:modelValue', r.hex); }
function onCustom(e: Event) { pick((e.target as HTMLInputElement).value); }
</script>

<template>
  <div class="wp" role="dialog" aria-labelledby="wp-h" @keydown.esc.stop="emit('close')">
    <p id="wp-h" class="wp-h">{{ ko.walk.wallTitle }}</p>
    <ul class="wp-list">
      <li v-for="p in WALL_PRESETS" :key="p.key">
        <button type="button" class="sw" :style="{ background: p.hex }" :aria-pressed="props.modelValue.toUpperCase() === p.hex" @click="pick(p.hex)">
          <span>{{ ko.walk.wallNames[p.key] }}</span>
        </button>
      </li>
    </ul>
    <div class="wp-row">
      <label class="custom">{{ ko.walk.wallCustom }} <input type="color" :value="props.modelValue" @change="onCustom"></label>
      <button type="button" class="btn btn-tertiary" @click="adjusted = false; emit('reset')">{{ ko.walk.wallReset }}</button>
      <button type="button" class="btn btn-secondary" @click="emit('close')">{{ ko.walk.close }}</button>
    </div>
    <p v-if="adjusted" class="t-body-sm" role="status">{{ ko.walk.wallAdjusted }}</p>
  </div>
</template>

<style scoped>
.wp{position:absolute;top:calc(100% + 8px);right:0;z-index:30;width:min(340px,calc(100vw - 32px));background:var(--color-canvas);border:1px solid var(--color-hairline);
  border-radius:var(--r-lg);padding:var(--s-md);box-shadow:var(--elev-3);display:grid;gap:var(--s-sm);color:var(--color-ink)}
.wp-h{font:700 16px/1.3 var(--font-sans)}
.wp-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.sw{width:100%;min-height:52px;border:1px solid var(--color-hairline);border-radius:var(--r-md);cursor:pointer;display:grid;place-items:end start;padding:6px 8px;color:var(--color-ink);font:500 13px/1.2 var(--font-sans)}
.sw[aria-pressed="true"]{box-shadow:0 0 0 2px var(--color-ink)}
.wp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.custom{display:inline-flex;align-items:center;gap:8px;font:500 15px/1.2 var(--font-sans)}
.custom input{width:44px;height:36px;border:1px solid var(--color-hairline);border-radius:var(--r-sm);padding:2px;background:none}
</style>
