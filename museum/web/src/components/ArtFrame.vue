<script setup lang="ts">
// 액자(SD_02 §17-4, D26 ⑥ — 색 틀 v2). 흰 매트 + 빨간 가는 안쪽 선 + 옅은 그림자. 작품이 주인공.
// 그림은 잘라 내지 않는다(object-fit: contain — "그림이 잘려 보여요" 해결), 액자는 그림 비율을 따르고 높이만 맞춘다(같은 크기 — BR-EXH-02).
// 파일을 못 읽으면 액자 안에만 §17 전역 실패 문구. src가 없으면 빈 액자(점선 — 빈 상태).
// variant(D30 시안, SD_02 §17-5): mat = 지금(흰 매트 + 빨간 선) · bw = 흑백 액자(검은 테 + 흰 매트, 시안 A) · gold = 금빛 액자(시안 B).
import { ref, watch } from 'vue';
import { ko } from '@/copy/ko';

const props = withDefaults(defineProps<{ src?: string | null; video?: string | null; playing?: boolean; alt?: string; size?: 'sm' | 'md' | 'lg'; variant?: 'mat' | 'bw' | 'gold'; lazy?: boolean; priority?: boolean }>(),
  { src: null, video: null, playing: false, alt: '', size: 'md', variant: 'mat', lazy: false, priority: false });
const emit = defineEmits<{ reload: [] }>();
const broken = ref(false);
const videoEl = ref<HTMLVideoElement | null>(null);
watch(() => props.src, () => { broken.value = false; });
watch(() => props.playing, (p) => {
  const v = videoEl.value;
  if (!v) return;
  if (p) void v.play().catch(() => undefined); else v.pause();
});
</script>

<template>
  <div class="artframe" :class="[`is-${size}`, `v-${variant}`, { empty: !src }]">
    <div class="mat">
      <template v-if="src && !broken">
        <video v-if="video" ref="videoEl" :src="video" :poster="src" playsinline loop muted preload="metadata" :aria-label="alt" @error="broken = true" />
        <img v-else :src="src" :alt="alt" :loading="lazy ? 'lazy' : undefined" :fetchpriority="priority ? 'high' : undefined" @error="broken = true">
      </template>
      <div v-else-if="src && broken" class="fail t-body-sm" role="status">
        {{ ko.fail.file }} <button class="btn btn-tertiary" type="button" @click.stop="emit('reload')">{{ ko.fail.fileRetry }}</button>
      </div>
      <div v-else class="blank" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.artframe{position:relative;display:inline-flex;max-width:100%}
.mat{background:#fff;padding:14px;display:grid;place-items:center;box-shadow:inset 0 0 0 1px var(--color-accent-magenta),0 18px 30px -16px rgba(110,53,80,.22)}
.is-sm .mat{padding:10px}
.is-lg .mat{padding:clamp(18px,3vw,36px)}
.mat img,.mat video{display:block;height:var(--art-h,200px);width:auto;max-width:min(calc(100vw - 96px),var(--art-max-w,340px));object-fit:contain}
.is-sm{--art-h:150px;--art-max-w:240px}
.is-lg{--art-h:min(58vh,500px);--art-max-w:min(calc(100vw - 96px),680px)}
@media (max-width:560px){.is-sm{--art-h:130px;--art-max-w:200px}.is-md{--art-h:160px}.is-lg{--art-h:min(46vh,360px)}}
.fail{height:var(--art-h,200px);width:calc(var(--art-h,200px) * 1.2);display:grid;place-items:center;text-align:center;padding:var(--s-sm)}
.empty .mat{background:transparent;box-shadow:none;border:1px dashed var(--color-accent-magenta)}
.blank{height:var(--art-h,200px);width:calc(var(--art-h,200px) * .8)}
/* 흑백 액자(시안 A) — 검은 테 + 흰 매트 */
.v-bw{padding:clamp(6px,.9vw,10px);background:#161616;box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 16px 26px -14px rgba(0,0,0,.45)}
.v-bw .mat{box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
/* 금빛 액자(시안 B) — 금 그라데이션 테 + 안쪽 턱 + 아이보리 매트 */
.v-gold{padding:clamp(8px,1.1vw,13px);background:linear-gradient(135deg,#f1d98b 0%,#c9a043 38%,#8e6b22 62%,#e2c170 100%);
  box-shadow:inset 0 0 0 2px rgba(255,236,170,.55),inset 0 0 0 4px rgba(90,62,12,.35),0 18px 30px -14px rgba(0,0,0,.55)}
.v-gold .mat{background:#fffeef;box-shadow:inset 0 0 0 1px rgba(142,107,34,.45)}
.v-bw.empty,.v-gold.empty{padding:0;background:none;box-shadow:none}
</style>
