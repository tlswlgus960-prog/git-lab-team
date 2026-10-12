<script setup lang="ts">
// [들려주기](D42 A, SD_02 §17-15): 누르면 읽고, 다시 누르면 멈춤. 카드가 사라지거나 읽을 문장이 바뀌면(다른 작품) 멈춘다.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { canSpeak, speak, speakingOwner, stopSpeaking } from './speech';
import { sc } from './copy';

const props = defineProps<{ parts: string[]; title: string }>();
const me = Symbol('speak');
const ok = ref(true);
const on = computed(() => speakingOwner.value === me);
onMounted(() => { ok.value = canSpeak(); });
function toggle() { if (on.value) stopSpeaking(me); else speak(me, props.parts); }
watch(() => props.parts.join('\n'), () => stopSpeaking(me));
onBeforeUnmount(() => stopSpeaking(me));
</script>

<template>
  <button v-if="ok" class="speak" type="button" :aria-pressed="on" :aria-label="on ? sc.speakStopLabel(title) : sc.speakLabel(title)" @click="toggle">
    <span aria-hidden="true">{{ on ? '⏹' : '🔊' }}</span> {{ on ? sc.speakStop : sc.speak }}
  </button>
  <p v-else class="speak-none">{{ sc.speakNone }}</p>
</template>

<style scoped>
.speak{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:8px 16px;border:1px solid var(--color-hairline);border-radius:var(--r-pill,999px);
  background:var(--color-canvas);color:var(--color-ink);font:600 15px/1 var(--font-sans);cursor:pointer;justify-self:start}
.speak:hover{background:var(--color-surface-soft)}
.speak[aria-pressed="true"]{background:var(--color-primary);color:var(--color-on-primary);border-color:var(--color-primary)}
.speak-none{font:330 13px/1.4 var(--font-sans)}
</style>
