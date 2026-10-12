<script setup lang="ts">
// 미니맵(D40, SD_02 §17-13 C) — 오른쪽 아래. 미술관 평면도 · 방 · 작품 점 · 지금 위치 · 시야 부채꼴.
// 작은 안내도를 누르면 그곳으로 걸어간다(팀장 요구 2026-09-30 — 손가락만으로), 귀퉁이 [크게] 버튼 = 큰 안내도(§17-13 C "누르면 크게").
// 큰 안내도의 점을 누르면 그 작품 앞으로, 전시실 목록 버튼은 키보드 · 화면 읽기로도 닿는다.
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { canStand, yawOf, type MuseumLayout, type Pose } from './layout';
import { m3 } from './copy';

const props = defineProps<{ layout: MuseumLayout; cam: Pose }>();
const emit = defineEmits<{ go: [pose: Pose] }>();
const open = ref(false);
const openBtn = ref<HTMLButtonElement | null>(null);
const closeBtn = ref<HTMLButtonElement | null>(null);

const vb = computed(() => { const b = props.layout.bounds; return `${b.x0 - 0.6} ${-(b.z1 + 0.6)} ${b.x1 - b.x0 + 1.2} ${b.z1 - b.z0 + 1.2}`; });
const dots = computed(() => [
  ...props.layout.frames.map((f) => ({ key: f.key, x: f.x, z: f.z, pose: f.pose, solid: false })),
  ...props.layout.pedestals.filter((p) => p.item).map((p) => ({ key: p.key, x: p.x, z: p.z, pose: p.pose, solid: true })),
  ...props.layout.plinths.filter((p) => p.item).map((p) => ({ key: p.key, x: p.x, z: p.z, pose: p.pose, solid: true })),
]);
const cone = computed(() => {
  const c = props.cam; const y = (c.yaw * Math.PI) / 180; const L = 4.2; const a = 0.55;
  const pt = (t: number) => [c.x - Math.sin(y + t) * L, -(c.z + Math.cos(y + t) * L)] as const;
  const [l, r] = [pt(a), pt(-a)];
  return { x: c.x, y: -c.z, d: `M${c.x} ${-c.z} L${l[0]} ${l[1]} L${r[0]} ${r[1]} Z` };
});

const box = ref<HTMLElement | null>(null);
/** 큰 안내도가 열린 동안: Tab은 안에서만 돌고, 초점이 어디 있든 Esc로 닫는다(문서 전체에서 듣는다) */
function onDocKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void hide(); return; }
  if (e.key !== 'Tab' || !box.value) return;
  const f = [...box.value.querySelectorAll<HTMLElement>('button, [href]')];
  const first = f[0]; const last = f[f.length - 1];
  if (!box.value.contains(document.activeElement)) { e.preventDefault(); first?.focus(); return; }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
}
async function show() { open.value = true; document.addEventListener('keydown', onDocKey, true); await nextTick(); closeBtn.value?.focus(); }
async function hide() { open.value = false; document.removeEventListener('keydown', onDocKey, true); await nextTick(); openBtn.value?.focus(); }
onBeforeUnmount(() => document.removeEventListener('keydown', onDocKey, true));
function go(p: Pose) { if (open.value) void hide(); emit('go', p); }
/** 작은 안내도 누름 → 그 자리(작품 점 가까이면 그 작품 앞, 방 안 빈 곳이면 그 자리, 벽이면 그 방 문턱) */
function tapSmall(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement; const r = svg.getBoundingClientRect(); const b = props.layout.bounds;
  const vw = b.x1 - b.x0 + 1.2; const vh = b.z1 - b.z0 + 1.2; const k = Math.min(r.width / vw, r.height / vh); if (!k) return;
  const x = b.x0 - 0.6 + (e.clientX - r.left - (r.width - vw * k) / 2) / k;
  const z = -(-(b.z1 + 0.6) + (e.clientY - r.top - (r.height - vh * k) / 2) / k);
  const dot = dots.value.map((d) => ({ d, n: Math.hypot(d.x - x, d.z - z) })).sort((p, q) => p.n - q.n)[0];
  if (dot && dot.n < 1.2) { emit('go', dot.d.pose); return; }
  if (canStand(props.layout, x, z)) { emit('go', { x, z, yaw: yawOf(x - props.cam.x, z - props.cam.z) }); return; }
  const room = props.layout.rooms.find((q) => x >= q.rect.x0 && x <= q.rect.x1 && z >= q.rect.z0 && z <= q.rect.z1);
  if (room) emit('go', room.entry);
}
</script>

<template>
  <div class="mm m3-hud">
    <div class="mm-small">
      <svg :viewBox="vb" preserveAspectRatio="xMidYMid meet" aria-hidden="true" @click="tapSmall">
        <rect :x="layout.hall.x0" :y="-layout.hall.z1" :width="layout.hall.x1 - layout.hall.x0" :height="layout.hall.z1 - layout.lobby.z0" class="mm-hall" />
        <rect v-for="r in layout.rooms" :key="r.index" :x="r.rect.x0" :y="-r.rect.z1" :width="r.rect.x1 - r.rect.x0" :height="r.rect.z1 - r.rect.z0" class="mm-room" />
        <circle v-for="d in dots" :key="d.key" :cx="d.x" :cy="-d.z" r=".45" :class="d.solid ? 'mm-dot solid' : 'mm-dot'" />
        <path :d="cone.d" class="mm-cone" /><circle :cx="cone.x" :cy="cone.y" r=".7" class="mm-me" />
      </svg>
      <button ref="openBtn" class="mm-grow" type="button" :aria-label="m3.map" :title="m3.map" @click="show">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
      </button>
    </div>

    <div v-if="open" class="mm-scrim" @click.self="hide">
      <div ref="box" class="mm-box" role="dialog" aria-modal="true" aria-labelledby="mm-title">
        <h2 id="mm-title">{{ m3.mapTitle }}</h2>
        <svg class="mm-big" :viewBox="vb" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect :x="layout.hall.x0" :y="-layout.hall.z1" :width="layout.hall.x1 - layout.hall.x0" :height="layout.hall.z1 - layout.lobby.z0" class="mm-hall" />
          <g v-for="r in layout.rooms" :key="r.index">
            <rect :x="r.rect.x0" :y="-r.rect.z1" :width="r.rect.x1 - r.rect.x0" :height="r.rect.z1 - r.rect.z0" class="mm-room" @click="go(r.entry)" />
            <text :x="r.center.x" :y="-r.center.z + 0.25" text-anchor="middle" class="mm-t">{{ r.label }}</text>
          </g>
          <circle v-for="d in dots" :key="d.key" :cx="d.x" :cy="-d.z" r=".55" :class="d.solid ? 'mm-dot solid hit' : 'mm-dot hit'" @click="go(d.pose)" />
          <text x="0" :y="-(layout.lobby.z0 + 0.9)" text-anchor="middle" class="mm-t">{{ m3.lobby }}</text>
          <path :d="cone.d" class="mm-cone" /><circle :cx="cone.x" :cy="cone.y" r=".8" class="mm-me" />
        </svg>
        <p class="mm-note">{{ m3.mapNote }}</p>
        <nav :aria-label="m3.mapRooms">
          <ul class="mm-list">
            <li><button type="button" @click="go(layout.start)">{{ m3.lobby }}</button></li>
            <li v-for="r in layout.rooms" :key="r.index"><button type="button" @click="go(r.entry)">{{ m3.roomCount(r.label, r.count) }}</button></li>
          </ul>
        </nav>
        <button ref="closeBtn" class="mm-close" type="button" @click="hide">{{ m3.close }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm{position:absolute;right:14px;bottom:14px;z-index:8}
.mm-small{position:relative;display:block;width:150px;height:150px;padding:8px;border-radius:20px;cursor:pointer;background:rgba(255,251,247,.86);
  box-shadow:0 0 0 1px rgba(255,255,255,.7),0 16px 36px -20px rgba(74,52,65,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.mm-small > svg{width:100%;height:100%;display:block}
.mm-grow{position:absolute;top:4px;left:4px;width:40px;height:40px;display:grid;place-items:center;border:1.5px solid #C9A24A;border-radius:999px;cursor:pointer;background:#FFF9EE;color:#4A3526;
  box-shadow:0 3px 0 #D9C08A,0 6px 12px -8px rgba(74,53,38,.45);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.mm-grow:hover{transform:translateY(-1px)}
.mm-grow:active{transform:translateY(3px);box-shadow:0 0 0 #D9C08A;transition-duration:.05s}
@media (prefers-reduced-motion:reduce){.mm-grow{transition:none}.mm-grow:hover{transform:none}}
.mm-grow svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@media (max-width:600px){.mm-small{width:112px;height:112px}}
.mm-hall{fill:#F6EFE4;stroke:#C9A552;stroke-width:.12}
.mm-room{fill:#FFFBF4;stroke:#C9A552;stroke-width:.12}
.mm-dot{fill:#A0496B}.mm-dot.solid{fill:#4A8FC0}
.mm-dot.hit,.mm-big .mm-room{cursor:pointer}
.mm-cone{fill:#A0496B;opacity:.22}
.mm-me{fill:#6E3550;stroke:#fff;stroke-width:.25}
.mm-t{font:700 .72px/1 var(--font-sans);fill:#6E3550;pointer-events:none}
.mm-scrim{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(44,34,56,.45)}
.mm-box{width:min(560px,100%);max-height:calc(100dvh - 32px);overflow:auto;display:grid;gap:12px;padding:20px;border-radius:24px;background:#FFFBF7;color:#6E3550;box-shadow:0 24px 60px -24px rgba(44,34,56,.6)}
.mm-box h2{margin:0;font:700 20px/1.3 var(--font-sans)}
.mm-big{width:100%;height:auto;max-height:52dvh}
.mm-note{margin:0;font:500 13px/1.5 var(--font-sans)}
.mm-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.mm-list button{min-height:44px;padding:8px 14px;border:1px solid #EBD5D6;border-radius:999px;background:#fff;color:#6E3550;font:600 14px/1.2 var(--font-sans);cursor:pointer}
.mm-close{justify-self:end;min-height:44px;padding:10px 18px;border:0;border-radius:999px;background:#A0496B;color:#FFFBF7;font:700 14px/1 var(--font-sans);cursor:pointer}
.mm :focus-visible{outline:2px solid #6E3550;outline-offset:3px}
</style>
