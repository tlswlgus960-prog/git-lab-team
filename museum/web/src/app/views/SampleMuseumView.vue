<script setup lang="ts">
// 견본 미술관 /app/sample(D48 ①, SD_02 §17-17) — 로그인 없이 · 서버 호출 없이 걷는 견본 아이 "견본이"의 미술관.
// 아이 미술관(D40)과 같은 장면(Scene): 캐릭터가 걸어 들어옴 · 방 버튼 줄 · 미니맵. 크게 보기 = 그림 · 제목 · 규칙 해설만(저장 · 올리기 · 이웃 없음).
// 위 띠: "견본 미술관이에요 — 우리 아이 그림으로 만들어 볼까요?" + [카카오로 시작하기](로그인, next=/app). [밖으로] = 입장 화면(/app/welcome).
import { computed, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import Scene from '../museum3d/Scene.vue';
import Viewer from '../museum3d/Viewer.vue';
import Exterior from '../museum3d/Exterior.vue';
import { buildMuseumLayout, type MuseumItem } from '../museum3d/layout';
import { buildSampleInput } from '../museum3d/sample';
import { m3 } from '../museum3d/copy';

const router = useRouter();
const input = buildSampleInput();
const layout = computed(() => buildMuseumLayout(input));
const viewing = ref<MuseumItem | null>(null);
let opener: HTMLElement | null = null;
const login = { path: '/app/login', query: { next: '/app' } };

function open(item: MuseumItem) { opener = document.activeElement as HTMLElement | null; viewing.value = item; }
async function close() { viewing.value = null; await nextTick(); opener?.focus({ preventScroll: true }); }
/** 견본도 바깥 광장에서 시작(D52 C): [들어가기] · [카카오로 시작하기]. 안의 [밖으로] = 광장 */
const outside = ref(true);
const scene = ref<InstanceType<typeof Scene> | null>(null);
const outsideActions = [{ key: 'enter', label: m3.enter, primary: true }, { key: 'start', label: m3.sampleStart, to: login }];
function onOutside(key: string) { if (key === 'enter') { outside.value = false; void nextTick(() => scene.value?.walkIn()); } }
function exit() { outside.value = true; }
void router;
</script>

<template>
  <main class="sm">
    <h1 class="sm-sr">{{ m3.title(input.childAlias) }}</h1>
    <div class="sm-band" role="note">
      <p>{{ m3.sampleBanner }}</p>
      <RouterLink class="sm-go" :to="login">{{ m3.sampleStart }}</RouterLink>
    </div>
    <div class="sm-stage">
      <Scene ref="scene" :layout="layout" :character="input.character" :color="input.color" :paused="!!viewing || outside" :auto-walk-in="false" :exit-label="m3.sampleExitLabel" @open="open" @exit="exit">
        <p class="sm-note">{{ m3.sampleNote }}</p>
      </Scene>
      <Exterior v-if="outside" :alias="input.childAlias" :museum-style="input.museumStyle" :tint="layout.color" :actions="outsideActions" @action="onOutside" />
    </div>
    <Viewer v-if="viewing" :item="viewing" :alias="input.childAlias" @close="close" />
  </main>
</template>

<style scoped>
.sm{display:flex;flex-direction:column;width:100%;max-width:100vw;height:100dvh;min-height:520px;overflow:hidden;background:#F7F3EC}
.sm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;margin:0}
.sm-band{flex:none;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 14px;padding:8px 16px;background:#FFF6E4;border-bottom:1px solid #E3CD95;color:#4A3526}
.sm-band p{margin:0;font:600 15px/1.4 var(--mc-serif,'Noto Serif KR',serif);text-align:center}
.sm-go{display:inline-flex;align-items:center;min-height:40px;padding:6px 16px;border-radius:999px;background:#FEE500;color:#191600;font:700 14px/1 var(--font-sans);text-decoration:none;
  box-shadow:0 3px 0 #D9C300;transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.sm-go:active{transform:translateY(3px);box-shadow:0 0 0 #D9C300}
.sm-go:focus-visible{outline:2px solid #6E3550;outline-offset:3px}
.sm-stage{position:relative;flex:1;min-height:0}
.sm-note{position:absolute;right:14px;top:66px;z-index:7;margin:0;padding:4px 10px;border-radius:999px;background:rgba(255,251,247,.8);color:#6E3550;font:500 12px/1.3 var(--font-sans)}
@media (max-width:600px){.sm-note{display:none}}
@media (prefers-reduced-motion:reduce){.sm-go{transition:none}}
</style>
