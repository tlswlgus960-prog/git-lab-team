<script setup lang="ts">
// 방문자 · 견본 크게 보기(D40 §17-13 F · D48 §17-17) — 그림 · 제목(견본은 + 규칙 해설)만. 한마디 · 감상평 · 그린 날 · 저장하기 없음.
// (가족은 walk/ArtViewer.vue를 그대로 쓴다.) Esc · [닫기] · 바깥 누름으로 닫고, 초점은 부르는 쪽이 돌려준다.
import { nextTick, onMounted, ref } from 'vue';
import ArtFrame from '@/components/ArtFrame.vue';
import SpeakButton from '@/app/sound/SpeakButton.vue';
import { reducedMotion } from '@/composables/usePolling';
import type { MuseumItem } from './layout';
import { m3 } from './copy';

const props = defineProps<{ item: MuseumItem; alias: string }>();
const emit = defineEmits<{ close: [] }>();
const playing = ref(false);
/** [들려주기](§17-15 A): 방문자 = 제목만, 견본 = 제목 + 해설 */
const title = () => props.item.title ?? m3.untitled;
const parts = () => (props.item.caption ? [title(), props.item.caption] : [title()]);
const closeBtn = ref<HTMLButtonElement | null>(null);
onMounted(async () => { await nextTick(); closeBtn.value?.focus(); });
function trap(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); emit('close'); return; }
  if (e.key !== 'Tab') return;
  const box = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button, [href]');
  const first = box[0]; const last = box[box.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
}
</script>

<template>
  <div class="vw-scrim" @click.self="emit('close')">
    <div class="vw" role="dialog" aria-modal="true" aria-labelledby="vw-title" @keydown="trap">
      <button ref="closeBtn" class="vw-close" type="button" @click="emit('close')">{{ m3.close }} <span aria-hidden="true">✕</span></button>
      <figure class="vw-art"><ArtFrame size="lg" variant="gold" :src="props.item.imageUrl" :video="props.item.kind === 'animated' ? props.item.videoUrl ?? null : null" :playing="playing" :alt="props.item.title ?? m3.untitled" /></figure>
      <button v-if="props.item.kind === 'animated' && props.item.videoUrl && !reducedMotion()" class="btn btn-primary" type="button" :aria-pressed="playing" @click="playing = !playing">
        {{ playing ? m3.stop : m3.play }}
      </button>
      <h2 id="vw-title">{{ props.item.title ?? m3.untitled }}</h2>
      <p v-if="props.item.caption" class="vw-cap">{{ props.item.caption }}</p>
      <SpeakButton :parts="parts()" :title="title()" />
      <p>{{ m3.title(props.alias) }}</p>
    </div>
  </div>
</template>

<style scoped>
.vw-scrim{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:16px;overflow-y:auto;background:rgba(44,34,56,.55)}
.vw{position:relative;box-sizing:border-box;width:min(760px,100%);min-width:0;max-height:calc(100dvh - 32px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;display:grid;justify-items:center;gap:12px;padding:clamp(16px,3vw,32px);
  border-radius:24px;background:#FFF6EA;color:#6E3550;box-shadow:0 16px 48px rgba(110,53,80,.14)}
/* 그림 칸 = 컨테이너: 액자는 칸 너비에 맞춘다(매트 여백 36×2 + 금테 ≈ 110px). .artframe 너비는 건드리지 않는다(금테만 늘어나지 않게) */
.vw > *{min-width:0;max-width:100%}
.vw-art{margin:0;width:100%;container-type:inline-size;display:grid;justify-items:center}
.vw-art :deep(.is-lg){--art-h:min(50vh,420px)}
.vw-art :deep(.mat img),.vw-art :deep(.mat video){max-width:calc(100cqi - 110px);height:auto;max-height:var(--art-h)}
.vw-close{justify-self:end;min-height:44px;padding:8px 14px;border:1px solid #EBD5D6;border-radius:999px;background:rgba(255,251,247,.9);color:#6E3550;font:600 15px/1 var(--font-sans);cursor:pointer}
.vw h2{margin:0;font:700 22px/1.35 var(--font-sans);text-align:center}
.vw p{margin:0;font:500 14px/1.4 var(--font-sans)}
.vw .vw-cap{max-width:52ch;padding:12px 16px;border-radius:14px;background:#FFFBF7;border:1px solid #EBD5D6;font:500 16px/1.6 var(--mc-serif,'Noto Serif KR',serif);text-align:center}
</style>
