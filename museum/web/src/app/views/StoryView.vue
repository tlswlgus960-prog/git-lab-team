<script setup lang="ts">
// S6 작품 이야기(T095, SD_02 §9 · §17-14 D46): 올린 작품은 고정 — 이야기는 올릴 때 함께 적고, 여기서는 보기만 한다.
// 흰 표 대신 금빛 액자 + 명패(제목 · 그린 날 · 나이) + 아이의 한마디 · 부모 감상. 설명은 큐레이션(CaptionPanel), 가족 댓글은 걸린 뒤 7일.
import { computed, onMounted, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import BlockNotice from '@/components/BlockNotice.vue';
import ArtFrame from '@/components/ArtFrame.vue';
import CommentPanel from '@/components/CommentPanel.vue';
import { ko } from '@/copy/ko';
import { type BlockNotice as Notice } from '@/api/client';
import { blockOf, loadArtwork, type ArtworkDetail } from '../artwork';
import { koDate } from '../localDate';
import CaptionPanel from './CaptionPanel.vue';

const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const a = ref<ArtworkDetail | null>(null);
const block = ref<Notice | null>(null);
const s = computed(() => a.value?.story ?? {});
const photo = computed(() => (a.value as { photoUrl?: string | null } | null)?.photoUrl ?? a.value?.originalUrl ?? null);
// D46 ⑩: 명패도 보호자가 적은 날짜 · 나이만(자동으로 채운 값은 빼고)
const st = computed(() => s.value as typeof s.value & { madeOnAuto?: boolean; ageAuto?: boolean });
const plaque = computed(() => [s.value.madeOn && !st.value.madeOnAuto ? koDate(s.value.madeOn) : '', s.value.ageAtMaking == null || st.value.ageAuto ? '' : ko.story.ageLine(s.value.ageAtMaking)].filter(Boolean).join(' · '));

async function load() {
  try { a.value = await loadArtwork(id); block.value = null; } catch (e) { block.value = blockOf(e); }
}
onMounted(load);
async function onBlock(label: string) {
  if (label === '목록으로') await router.push('/app/works');
  else await load();
}
</script>

<template>
  <main class="container page stack sv">
    <BlockNotice v-if="block && !a" :notice="block" @action="onBlock" />
    <template v-if="a">
      <section class="sv-wall" aria-label="작품 이야기">
        <figure class="sv-art" :style="{ viewTransitionName: `art-${a.id}` }">
          <ArtFrame size="lg" variant="gold" :src="photo" :alt="s.title || ko.list.untitled" />
          <figcaption class="sv-plaque">
            <h1 class="sv-title">{{ s.title || ko.list.untitled }}</h1>
            <p v-if="plaque" class="sv-meta">{{ plaque }}</p>
          </figcaption>
        </figure>
        <div class="sv-words">
          <blockquote v-if="s.childWords" class="sv-quote"><p>“{{ s.childWords }}”</p><footer>{{ ko.up2.words }}</footer></blockquote>
          <div v-if="s.guardianNote" class="sv-note"><h2>{{ ko.up2.note }}</h2><p>{{ s.guardianNote }}</p></div>
          <p class="sv-lock" role="note">🔒 {{ ko.up2.lockNote }}</p>
        </div>
      </section>
      <CaptionPanel :artwork="a" />
      <section class="card sv-cm"><CommentPanel :artwork-id="id" /></section><!-- D46 ④ 가족 코멘트 -->
    </template>
  </main>
</template>

<style scoped>
.sv{max-width:1040px}
.sv-wall{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:clamp(18px,4vw,48px);align-items:center;
  padding:clamp(18px,4vw,40px);border-radius:24px;background:linear-gradient(180deg,#fbf5ea,#f4ead8);box-shadow:inset 0 0 0 1px rgba(201,165,82,.35)}
@media (max-width:760px){.sv-wall{grid-template-columns:1fr}}
.sv-art{margin:0;display:grid;gap:14px;justify-items:center;min-width:0;container-type:inline-size}
/* 액자가 칸 폭을 넘어 글 칸을 덮지 않게: 액자를 늘리지 않고(빈 금색 판이 생김) 그림을 칸 폭 - 매트 · 테 만큼으로 줄인다 */
.sv-art :deep(.mat img){max-width:calc(100cqi - 110px);height:auto;max-height:var(--art-h)}
.sv-words{min-width:0}
.sv-plaque{background:linear-gradient(180deg,#e9d18f,#c9a552);border-radius:6px;padding:8px 16px;text-align:center;box-shadow:0 6px 14px -8px rgba(90,62,30,.6);max-width:100%}
.sv-title{margin:0;font:700 clamp(18px,2.4vw,22px)/1.3 var(--mc-serif,serif);color:#3a2a1f;word-break:keep-all;overflow-wrap:anywhere}
.sv-meta{margin:2px 0 0;font:600 13px/1.3 var(--font-sans);color:#4a3526}
.sv-words{display:grid;gap:14px}
.sv-quote{margin:0;font:600 clamp(18px,2.2vw,22px)/1.55 var(--mc-serif,serif);color:#4a3526;word-break:keep-all}
.sv-quote p{margin:0;white-space:pre-wrap}
.sv-quote footer{margin-top:4px;font:500 13px/1.3 var(--font-sans);color:#7a6555}
.sv-note h2{margin:0 0 4px;font:700 14px/1.3 var(--font-sans);color:#7a6555}
.sv-note p{margin:0;white-space:pre-wrap;font:500 15px/1.6 var(--font-sans);color:var(--color-ink)}
.sv-lock{margin:0;font:500 13px/1.45 var(--font-sans);color:#7a6555;word-break:keep-all}
.sv-cm{max-width:none}
</style>
