<script setup lang="ts">
// 저장하기 버튼(D37, SD_02 §17-10) — 크게 보기(ArtViewer) · 작품 앞(MuseumView) 공통.
import { ref } from 'vue';
import type { components } from '@/api/types.gen';
import { ko } from '@/copy/ko';
import { animationMp4, deliver, fileName, framedPng, type SaveMeta } from '@/app/save';

type Item = components['schemas']['GalleryItem'];
const props = defineProps<{ item: Item; alias: string; still: string | null }>();
const busy = ref<'' | 'png' | 'mp4'>('');
const msg = ref('');
let t: ReturnType<typeof setTimeout> | undefined;
const meta = (): SaveMeta => ({ title: props.item.title, madeOn: props.item.madeOn ?? null, ageAtMaking: props.item.ageAtMaking ?? null, alias: props.alias });

async function run(kind: 'png' | 'mp4') {
  if (busy.value) return;
  busy.value = kind; msg.value = ko.save.busy; clearTimeout(t);
  try {
    const blob = kind === 'png' ? await framedPng(props.still!, meta()) : await animationMp4(props.item.primaryUrl!);
    const r = await deliver(blob, fileName(meta(), kind));
    msg.value = r === 'cancelled' ? '' : ko.save.done;
  } catch { msg.value = ko.save.fail; }
  busy.value = '';
  if (msg.value === ko.save.done) t = setTimeout(() => { msg.value = ''; }, 3000);
}
</script>

<template>
  <div class="save">
    <button v-if="props.still" class="btn btn-secondary" type="button" :disabled="!!busy" @click="run('png')">
      <span aria-hidden="true">⤓</span> {{ busy === 'png' ? ko.save.busy : ko.save.framed }}
    </button>
    <button v-if="props.item.kind === 'animated' && props.item.primaryUrl" class="btn btn-secondary" type="button" :disabled="!!busy" @click="run('mp4')">
      <span aria-hidden="true">⤓</span> {{ busy === 'mp4' ? ko.save.busy : ko.save.moving }}
    </button>
    <p class="save-msg" role="status" aria-live="polite">{{ busy ? '' : msg }}</p>
  </div>
</template>

<style scoped>
.save{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.save .btn{min-height:44px}
.save-msg{flex-basis:100%;font:500 14px/1.4 var(--font-sans);color:var(--color-ink);min-height:1.4em;margin:0}
</style>
