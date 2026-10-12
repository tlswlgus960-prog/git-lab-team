<script setup lang="ts">
// C7 이야기 카드(T093, SD_02 §3 C7 · UX5, BR-STY-03·04, BR-EXH-05, D6). 작품명 · 작가 줄 · 결과 종류 · 규칙 문장 해설(아이의 한마디는 원문 그대로)
// · 보호자 감상평 · AI 작성 해설을 칸을 나눠 보인다 — 한마디와 AI 문장은 절대 한 칸에 섞지 않는다.
// 모양은 S8 "작품 앞" 월 라벨(SD_02 §17-4, D26 ⑥ 색 틀 v2 — 토큰만). 뒤로가기·재생 같은 조작은 부르는 쪽(slot before/after)이 둔다.
// D42(SD_02 §17-15 A): 제목 아래 [들려주기] — 화면에 보이는 문장만 차례로 읽는다(제목 → 해설 → 감상평 → AI 해설).
import { computed } from 'vue';
import { ko } from '@/copy/ko';
import type { components } from '@/api/types.gen';
import SpeakButton from '@/app/sound/SpeakButton.vue';
import { sc } from '@/app/sound/copy';

type Item = components['schemas']['GalleryItem'];
const props = defineProps<{ item: Item; alias: string; titleId?: string }>();

const yearOf = (d: string) => d.slice(0, 4);
const monthOf = (d: string) => Number(d.slice(5, 7));
// D46 ⑩: 보호자가 비워 자동으로 채운 제목 · 날짜 · 나이는 해설에서 단정하지 않는다
type Auto = { titleAuto?: boolean; madeOnAuto?: boolean; ageAuto?: boolean; making?: boolean };
const auto = computed(() => props.item as Item & Auto);
const age = computed(() => (auto.value.ageAuto ? null : props.item.ageAtMaking ?? null));
const year = computed(() => (auto.value.madeOnAuto ? '' : yearOf(props.item.madeOn)));
const intro = computed(() => ko.museum.intro(auto.value.titleAuto ? null : props.item.title, props.alias, age.value, year.value, monthOf(props.item.madeOn), !!auto.value.making));
const artist = computed(() => ko.museum.artist(props.alias, age.value, year.value));
const readParts = computed(() => {
  const i = props.item;
  return [
    `${i.title}.`,
    intro.value,
    i.childWords ? `${ko.museum.wordsBefore}${i.childWords}${ko.museum.wordsAfter}` : '',
    ko.museum.kindLine[i.kind] ?? '',
    i.guardianNote ? `${ko.museum.guardianNote}. ${i.guardianNote}` : '',
    i.aiCaption?.body ? `${sc.aiPrefix} ${i.aiCaption.body}` : '',
  ];
});
</script>

<template>
  <slot name="before" />
  <p class="wl-eyebrow">{{ ko.museum.label }}</p>
  <h1 :id="titleId" class="wl-title">{{ item.title }}</h1>
  <SpeakButton :parts="readParts" :title="item.title" />
  <p class="wl-artist">{{ artist }}</p>
  <p class="wl-kind">{{ ko.museum.kind[item.kind] }}</p>
  <p class="wl-desc">
    {{ intro }}
    <template v-if="item.childWords">{{ ko.museum.wordsBefore }}<span class="wl-words">{{ item.childWords }}</span>{{ ko.museum.wordsAfter }}</template>
    <template v-if="ko.museum.kindLine[item.kind]">{{ ko.museum.kindLine[item.kind] }}</template>
  </p>
  <p v-if="item.backsideEstimated" class="wl-note">{{ ko.gallery.backside }}</p>
  <div v-if="item.guardianNote" class="wl-block">
    <p class="wl-h">{{ ko.museum.guardianNote }}</p>
    <p class="wl-note-text">{{ item.guardianNote }}</p>
  </div>
  <div v-if="item.aiCaption?.body" class="wl-block" data-ai="1">
    <p class="wl-h">{{ ko.museum.commentary }}</p>
    <p>{{ item.aiCaption.body }}</p>
  </div>
  <slot name="after" />
</template>

<style scoped>
.wl-eyebrow{font:600 12px/1 var(--font-sans);letter-spacing:.8px}
.wl-title{margin:0;font:750 28px/1.25 var(--font-sans);letter-spacing:-.02em;color:var(--color-accent-magenta)}
.wl-title::before{content:"「"}.wl-title::after{content:"」"}
.wl-artist{font:400 15px/1.4 var(--font-sans)}
.wl-kind{font:400 13px/1.4 var(--font-mono);letter-spacing:.3px;border-top:1px solid var(--color-accent-magenta);padding-top:var(--s-sm)}
.wl-desc{font:330 17px/1.7 var(--font-sans)}
.wl-words{font-weight:540}
.wl-note{font:330 14px/1.45 var(--font-sans)}
.wl-block{display:grid;gap:4px;border-top:1px solid var(--color-hairline);padding-top:var(--s-sm)}
.wl-h{font:600 12px/1 var(--font-sans);letter-spacing:.8px}
.wl-note-text{font:330 italic 16px/1.6 var(--font-sans)}
</style>
