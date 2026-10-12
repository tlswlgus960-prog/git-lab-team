<script setup lang="ts">
// C11 작품 영역 자르기(D32, SD_02 §5·§3 C11, UC2 A10). 미리보기 위 사각형 — 처음엔 사진 전체, 손대지 않아도 된다.
// 핸들 8개와 "네모 옮기기"는 모두 초점을 받는 버튼: 끌기(마우스·터치) 또는 화살표 1%·Shift 10%.
// 좌표는 사진 원래 픽셀(W×H). 실제 자르기는 올릴 때 UploadView가 한다.
import { computed, onBeforeUnmount, ref } from 'vue';
import { drag, HANDLES, keyStep, type Handle, type Rect } from '@/app/crop';
import { ko } from '@/copy/ko';

const props = defineProps<{ src: string; width: number; height: number }>();
const rect = defineModel<Rect>({ required: true });

const box = ref<HTMLElement | null>(null);
let active: { h: Handle; px: number; py: number; start: Rect; scale: number; id: number } | null = null;

const pct = (v: number, t: number) => `${(v / t) * 100}%`;
const frame = computed(() => ({ left: pct(rect.value.x, props.width), top: pct(rect.value.y, props.height),
  width: pct(rect.value.w, props.width), height: pct(rect.value.h, props.height) }));

function down(h: Handle, ev: PointerEvent) {
  const el = box.value; if (!el) return;
  ev.preventDefault(); ev.stopPropagation();
  (ev.target as Element).setPointerCapture?.(ev.pointerId);
  active = { h, px: ev.clientX, py: ev.clientY, start: { ...rect.value }, scale: props.width / el.getBoundingClientRect().width, id: ev.pointerId };
}
function move(ev: PointerEvent) {
  if (!active || ev.pointerId !== active.id) return;
  const dx = (ev.clientX - active.px) * active.scale, dy = (ev.clientY - active.py) * active.scale;
  rect.value = drag(active.start, active.h, dx, dy, props.width, props.height);
}
function up(ev: PointerEvent) { if (active && ev.pointerId === active.id) active = null; }
function key(h: Handle, ev: KeyboardEvent) {
  const d = keyStep(ev.key, ev.shiftKey, props.width, props.height);
  if (!d) return;
  ev.preventDefault();
  rect.value = drag(rect.value, h, d[0], d[1], props.width, props.height);
}
onBeforeUnmount(() => { active = null; });
</script>

<template>
  <div ref="box" class="crop" @pointermove="move" @pointerup="up" @pointercancel="up">
    <img :src="src" alt="" class="crop-img" draggable="false">
    <div class="crop-rect" :style="frame">
      <button type="button" class="crop-move" :aria-label="ko.upload.crop.handle.move"
              @pointerdown="down('move', $event)" @keydown="key('move', $event)" />
      <button v-for="h in HANDLES" :key="h" type="button" :class="['crop-h', `h-${h}`]" :aria-label="ko.upload.crop.handle[h]"
              @pointerdown="down(h, $event)" @keydown="key(h, $event)" />
    </div>
  </div>
</template>

<style scoped>
.crop{position:relative;display:inline-block;max-width:100%;touch-action:none;user-select:none;line-height:0;overflow:hidden;border-radius:var(--r-md)}
.crop-img{display:block;max-width:100%;max-height:420px;border-radius:var(--r-md)}
.crop-rect{position:absolute;box-shadow:0 0 0 9999px color-mix(in srgb,var(--color-ink) 50%,transparent);outline:2px solid var(--color-canvas)}
.crop-move{position:absolute;inset:0;width:100%;height:100%;background:transparent;border:0;cursor:move;padding:0}
.crop-h{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;background:transparent;border:0;padding:0}
.crop-h::after{content:'';position:absolute;left:14px;top:14px;width:16px;height:16px;background:var(--color-canvas);border:2px solid var(--color-ink);border-radius:50%}
.crop-move:focus-visible,.crop-h:focus-visible{outline:3px solid var(--color-canvas);outline-offset:-3px}
.crop-h:focus-visible::after{background:var(--color-ink)}
.h-nw{left:0;top:0;cursor:nwse-resize}.h-n{left:50%;top:0;cursor:ns-resize}.h-ne{left:100%;top:0;cursor:nesw-resize}
.h-e{left:100%;top:50%;cursor:ew-resize}.h-se{left:100%;top:100%;cursor:nwse-resize}.h-s{left:50%;top:100%;cursor:ns-resize}
.h-sw{left:0;top:100%;cursor:nesw-resize}.h-w{left:0;top:50%;cursor:ew-resize}
</style>
