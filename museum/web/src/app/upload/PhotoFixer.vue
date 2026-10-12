<script setup lang="ts">
// 모서리 고치기 편집판(D35 ①② 올리기 전 · D46): 네 모서리 끌기(처음 값 = 자동 찾기 추정) · 90° 돌리기 · 원래대로 · 이대로 쓰기.
// 올리기 전에만 쓴다 — 브라우저가 편 판(JPEG 0.92, 긴 변 최대 2400px)을 만들어 돌려준다(emit done). 잘린 부분은 서버로 가지 않는다.
// (D39 올린 뒤 사진 고치기는 D46으로 폐기)
import { computed, nextTick, onMounted, ref } from 'vue';
import { ko } from '@/copy/ko';
import { warpQuad } from './autocrop';

const props = defineProps<{ src: string; initial?: [number, number][] | null }>();
const emit = defineEmits<{ close: []; done: [blob: Blob, quad: [number, number][], rot: number] }>();
type P = [number, number];
const img = ref<HTMLImageElement | null>(null);
const W = ref(0); const H = ref(0);
const quad = ref<P[]>([]);
const rot = ref(0); // 0 · 90 · 180 · 270
const sel = ref(0);
const busy = ref(false); const msg = ref('');
const preview = ref<HTMLCanvasElement | null>(null);
const box = ref<HTMLElement | null>(null);
const dialog = ref<HTMLElement | null>(null);

onMounted(async () => {
  const r = await fetch(props.src);
  const bm = await createImageBitmap(await r.blob(), { imageOrientation: 'from-image' }); // 사진 방향 정보(EXIF) 먼저
  const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d')!.drawImage(bm, 0, 0);
  const im = new Image(); im.src = c.toDataURL('image/jpeg', 0.95); await im.decode(); img.value = im;
  W.value = im.naturalWidth; H.value = im.naturalHeight;
  // 자동 펴기가 찾은 네 모서리가 있으면 그것부터, 없으면 사진 전체(추정 사각형으로 시작하면 그대로 저장했을 때 그림이 잘린다)
  quad.value = props.initial ? props.initial.map((p) => [p[0], p[1]] as P) : [[0, 0], [W.value, 0], [W.value, H.value], [0, H.value]];
  await nextTick(); draw(); dialog.value?.querySelector<HTMLElement>('button')?.focus();
});
const pts = computed(() => quad.value.map(([x, y]) => `${x},${y}`).join(' '));
function draw() {
  if (!img.value || !preview.value) return;
  const flat = warpQuad(img.value, quad.value, 1200) as HTMLCanvasElement;
  const c = preview.value, turn = rot.value % 180 !== 0;
  c.width = turn ? flat.height : flat.width; c.height = turn ? flat.width : flat.height;
  const g = c.getContext('2d')!; g.save(); g.translate(c.width / 2, c.height / 2); g.rotate((rot.value * Math.PI) / 180); g.drawImage(flat, -flat.width / 2, -flat.height / 2); g.restore();
}
let dragging = -1;
function toImg(e: PointerEvent): P {
  const r = box.value!.getBoundingClientRect();
  return [Math.max(0, Math.min(W.value, ((e.clientX - r.left) / r.width) * W.value)), Math.max(0, Math.min(H.value, ((e.clientY - r.top) / r.height) * H.value))];
}
function down(i: number, e: PointerEvent) { dragging = i; sel.value = i; (e.target as Element).setPointerCapture(e.pointerId); }
function move(e: PointerEvent) { if (dragging < 0) return; quad.value[dragging] = toImg(e); }
function up() { if (dragging >= 0) { dragging = -1; draw(); } }
function key(i: number, e: KeyboardEvent) {
  const s = (e.shiftKey ? 10 : 1) * (W.value / 400);
  const d: Record<string, P> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] };
  const v = d[e.key]; if (!v) return;
  e.preventDefault(); const [x, y] = quad.value[i]!;
  quad.value[i] = [Math.max(0, Math.min(W.value, x + v[0])), Math.max(0, Math.min(H.value, y + v[1]))]; draw();
}
function turn(d: number) { rot.value = (rot.value + d + 360) % 360; draw(); }
function reset() { quad.value = [[0, 0], [W.value, 0], [W.value, H.value], [0, H.value]]; rot.value = 0; draw(); }
async function save() {
  if (!img.value || busy.value) return;
  busy.value = true; msg.value = '';
  try {
    const flat = warpQuad(img.value, quad.value, 2400) as HTMLCanvasElement;
    const c = document.createElement('canvas'), t = rot.value % 180 !== 0;
    c.width = t ? flat.height : flat.width; c.height = t ? flat.width : flat.height;
    const g = c.getContext('2d')!; g.translate(c.width / 2, c.height / 2); g.rotate((rot.value * Math.PI) / 180); g.drawImage(flat, -flat.width / 2, -flat.height / 2);
    const blob = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('blob'))), 'image/jpeg', 0.92));
    emit('done', blob, quad.value.map((p) => [p[0], p[1]] as [number, number]), rot.value);
  } catch { msg.value = ko.up2.fixFail; }
  busy.value = false;
}
function trap(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); emit('close'); } }
</script>

<template>
  <Teleport to="body"><!-- 화면 틀(움직임 · 변형)의 쌓임 맥락 밖 — 고정 메뉴 줄 위에 뜬다 -->
  <div class="fx-scrim" @click.self="emit('close')">
    <div ref="dialog" class="fx" role="dialog" aria-modal="true" aria-labelledby="fx-t" @keydown="trap">
      <h2 id="fx-t" class="fx-t">{{ ko.up2.fix }}</h2>
      <p class="fx-hint">{{ ko.up2.fixHint }}</p>
      <div class="fx-body">
        <div v-if="img" ref="box" class="fx-photo" :style="{ aspectRatio: `${W} / ${H}` }" @pointermove="move" @pointerup="up" @pointercancel="up">
          <img :src="img.src" alt="" draggable="false">
          <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true"><polygon :points="pts" /></svg>
          <button v-for="(p, i) in quad" :key="i" class="fx-h" :class="{ on: sel === i }" type="button" :style="{ left: `${(p[0] / W) * 100}%`, top: `${(p[1] / H) * 100}%` }"
            :aria-label="ko.fix.corner[i]" @pointerdown="down(i, $event)" @keydown="key(i, $event)" @focus="sel = i"></button>
        </div>
        <div v-else class="fx-photo fx-load">{{ ko.save.busy }}</div>
        <div class="fx-side">
          <p class="fx-cap">{{ ko.fix.preview }}</p>
          <canvas ref="preview" class="fx-prev" role="img" :aria-label="ko.fix.preview"></canvas>
        </div>
      </div>
      <div class="fx-acts">
        <button class="btn btn-secondary" type="button" @click="turn(-90)" :aria-label="ko.fix.left">↺ <span class="fx-long">{{ ko.fix.left }}</span><span class="fx-short">{{ ko.up2.left }}</span></button>
        <button class="btn btn-secondary" type="button" @click="turn(90)" :aria-label="ko.fix.right">↻ <span class="fx-long">{{ ko.fix.right }}</span><span class="fx-short">{{ ko.up2.right }}</span></button>
        <button class="btn btn-tertiary" type="button" @click="reset">{{ ko.fix.reset }}</button>
        <span class="sp"></span>
        <button class="btn btn-secondary" type="button" @click="emit('close')">{{ ko.walk.close }}</button>
        <button class="btn btn-primary" type="button" :disabled="busy || !img" @click="save">{{ busy ? ko.save.busy : ko.up2.fixUse }}</button>
      </div>
      <p class="fx-msg" role="status" aria-live="polite">{{ msg }}</p>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.fx-scrim{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:12px;background:rgba(40,26,16,.62);backdrop-filter:blur(6px);animation:fx-in var(--dur-2,480ms) var(--ease-spring,ease) both}
@keyframes fx-in{from{opacity:0}}
.fx{width:min(1040px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:linear-gradient(#fffaf0,#fbf4e6);border:2px solid #c9a24a;border-radius:20px;padding:clamp(14px,3vw,28px);display:grid;gap:12px;
  box-shadow:0 0 0 1px rgba(201,165,82,.5),0 40px 80px -30px rgba(0,0,0,.6);animation:fx-up var(--dur-3,800ms) var(--ease-spring,ease) both}
@keyframes fx-up{from{transform:translateY(24px) scale(.98);opacity:0}}
.fx-t{margin:0;font:700 22px/1.25 var(--mc-serif,serif);color:#3a2a1f}
.fx-hint{margin:0;font:500 14px/1.5 var(--font-sans);color:#5a4636}
.fx-body{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:760px){.fx-body{grid-template-columns:1fr}}
.fx-photo{position:relative;width:100%;max-height:62vh;background:#2b2019;border-radius:8px;overflow:visible;touch-action:none;user-select:none;margin-inline:auto}
.fx-photo img{width:100%;height:100%;object-fit:contain;display:block;border-radius:8px}
.fx-photo svg{position:absolute;inset:0;width:100%;height:100%}
.fx-photo polygon{fill:rgba(230,203,134,.18);stroke:#e6cb86;stroke-width:0.4%;vector-effect:non-scaling-stroke}
.fx-load{display:grid;place-items:center;aspect-ratio:4/3;color:#fff}
.fx-h{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:3px solid #fff;background:#a0496b;box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:grab;touch-action:none}
.fx-h.on{outline:3px solid #e6cb86;outline-offset:2px}
.fx-h:focus-visible{outline:3px solid #fff;outline-offset:3px}
.fx-side{display:grid;gap:6px;justify-items:center}
.fx-cap{margin:0;font:600 13px/1.2 var(--font-sans);color:#5a4636}
.fx-prev{max-width:100%;max-height:40vh;background:#fffeef;padding:10px;border-radius:2px;box-shadow:0 0 0 8px #d8b766,0 20px 30px -18px rgba(0,0,0,.6)}
.fx-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.fx-acts .sp{flex:1}
.fx-acts .btn{min-height:44px}
.fx-short{display:none}
@media (max-width:760px){.fx-short{display:inline}}
/* 휴대폰: 버튼 줄을 판 아래에 붙여 첫 화면에서 [돌리기] · [이대로 쓰기]가 보이게 */
@media (max-width:760px){.fx-photo{max-height:48vh}.fx-prev{max-height:22vh}
  .fx-acts{position:sticky;bottom:calc(-1 * clamp(14px,3vw,28px));margin:0 calc(-1 * clamp(14px,3vw,28px));padding:10px clamp(14px,3vw,28px);background:#fbf6ee;box-shadow:0 -8px 16px -12px rgba(0,0,0,.35)}
  .fx-acts .sp{display:none}.fx-acts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.fx-acts .btn{white-space:nowrap;padding-inline:8px;font-size:14px}
  .fx-acts .btn:last-child{grid-column:span 2}.fx-long{display:none}}
.fx-msg{margin:0;min-height:1.3em;font:500 14px/1.3 var(--font-sans);color:#8a2b2b}
</style>
