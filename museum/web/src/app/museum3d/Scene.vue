<script setup lang="ts">
// 아이 미술관 1인칭 장면(D40 → D52, SD_02 §17-13 · §17-18) — layout.ts가 정한 자리를 CSS perspective · preserve-3d 면으로 세운다. 3D 엔진 · 소리 없음.
// 조작(D52 B, 누르기만으로): 아래 가운데 [◀ 앞 작품] · [다음 작품 ▶] · 작품 · 받침대 · 문 한 번 누르기 = 그 앞으로(가까우면 크게 보기) · 방 버튼 줄 · 미니맵.
//   덤: 끌기 = 둘러보기 · 바닥 두 번 누르기 · W A S D · 방향키 · 휠 · Space = 캐릭터 점프(카메라도 살짝). 조이스틱 없음. 움직임 줄이기면 걷지 않고 바로 옮김.
// D41 hall3d/engine.ts는 곧은 홀 하나만 다뤄(방 · 문 · 길 찾기 · 바닥 누르기 없음) 따로 두되, 1m = 100px · 눈높이 · 걷는 속도 · 가까움 2.5m · 끌기 방향 · 조이스틱은 맞췄다.
// 카메라는 반응형 상태가 아니라 매 프레임 world transform만 바꾼다(transform만 움직임). 미니맵 · 위치 글자는 0.1초마다만 갱신.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import CharacterAvatar from '@/app/character/CharacterAvatar.vue';
import { DEFAULT_COLOR, DEFAULT_KIND, isColor, isKind } from '@/app/character/names';
import { reducedMotion } from '@/composables/usePolling';
import Minimap from './Minimap.vue';
import Coach, { coachSeen } from './Coach.vue';
import Mural from './Mural.vue';
import { m3 } from './copy';
import {
  areaOf, canStand, clampMove, clampPitch, floorAt, isNear, nearestTarget, pathTo, perspectiveFor, planeStyle, planeTf, PLINTH_H, screenToFloor, yawOf, WALL_H,
  type MuseumItem, type MuseumLayout, type Pose, type Vec,
} from './layout';

/** companion = 화면 아래 가운데 아이 캐릭터(D44, 방문자는 끔) · hang = 걸리는 장면으로 시작할 작품 id(D44 ④) */
const props = withDefaults(defineProps<{ layout: MuseumLayout; character?: string | null; color?: string | null; paused?: boolean; companion?: boolean; hang?: string | null; exitLabel?: string; openAfterHang?: boolean;
  /** 올라오자마자 걸어 들어오기(바깥 광장이 있으면 false — 부르는 쪽이 walkIn()) · 친구 초대 버튼(가족만) · 첫 안내 */
  autoWalkIn?: boolean; invite?: boolean; coach?: boolean }>(), {
  character: null, color: null, paused: false, companion: true, hang: null, exitLabel: undefined, openAfterHang: true, autoWalkIn: true, invite: false, coach: true,
});
/** hangDone = 걸리는 장면이 끝남(액자가 벽에 · 반짝 끝, 움직임 줄이기면 바로) — 움직이게 물어보기(AnimateAsk)가 이때 나온다 */
const emit = defineEmits<{ open: [item: MuseumItem]; exit: []; hangDone: [id: string] }>();

// D45(§17-13 I) 어지럽지 않게: 걷기 1.4m/s · Shift 1.6배 · 가속 · 감속 0.35초 · 끌기 감도 낮게 + 관성 · 휠 한 칸 0.4m · 머리 흔들림 거의 없음
const WALK = 1.4; const RUN = 1.6; const TURN = 55; const DRAG = 0.14; const EASE_S = 0.35; const WHEEL_M = 0.4; const BOB_PX = 0.8;
const kind = computed(() => (isKind(props.character) ? props.character : DEFAULT_KIND));
const tint = computed(() => (isColor(props.color) ? props.color : DEFAULT_COLOR));
/** 키 이름(E · WASD · Shift · Space)을 숨길 때: 굵은 포인터(손가락) 또는 좁은 화면(600px 이하) — 좁은 데스크톱 창도 누르기 말만 */
const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
const touch = mq('(hover: none), (pointer: coarse)') || mq('(max-width: 600px)');
const keyHints: readonly string[] = m3.keys;
const meSize = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches ? 86 : 110;

// ---------- 장면 요소(한 번 계산) ----------
interface Target extends Vec { key: string; item: MuseumItem; pose: Pose }
/** 방 문 위 인방: 아래쪽을 반원으로 뚫어 아치 문(§17-13 H 고전 · 밝게). clip-path라 뚫린 곳은 누름도 통과한다 */
function archClip(w: number, h: number): string {
  const W = w * 100; const H = h * 100; const r = W / 2; const pts = ['0 0', `${W}px 0`, `${W}px ${H}px`];
  for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI; pts.push(`${(r + r * Math.cos(a)).toFixed(1)}px ${(H - r * Math.sin(a)).toFixed(1)}px`); }
  pts.push(`0 ${H}px`);
  return `polygon(${pts.join(',')})`;
}
/** 두 번 누르기로 그 앞에 서는 자리(액자 · 진열대 · 받침대 — 빈 받침대도) */
const poseOf = computed(() => new Map<string, Pose>([
  ...props.layout.frames.map((f) => [f.key, f.pose] as const), ...props.layout.pedestals.map((p) => [p.key, p.pose] as const),
  ...props.layout.plinths.map((p) => [p.key, p.pose] as const),
  ...props.layout.rooms.map((r) => [`r${r.index}-label`, r.entry] as const)]));
const planes = computed(() => [
  // 문 위 방 이름판을 누르면 그 방 문턱으로(D52 B "문 한 번 누르기")
  ...props.layout.planes.map((p) => ({ p, tk: /^r\d+-label$/.test(p.key) ? p.key : '' })),
  ...props.layout.pedestals.flatMap((d) => d.planes.map((p) => ({ p, tk: d.key }))),
  ...props.layout.plinths.flatMap((d) => d.planes.map((p) => ({ p, tk: d.key }))),
].map(({ p, tk }) => ({ key: p.key, tk, cls: p.cls.split(' ').map((c) => `pl-${c}`), text: p.text ?? '',
  style: p.cls.includes('lintel') ? { ...planeStyle(p), clipPath: archClip(p.w, p.h), '--r': `${p.w * 50}px` } : planeStyle(p) })));
const titleOf = (it: MuseumItem) => it.title ?? m3.untitled;
/** 액자는 2배 크기로 그린 뒤 scale(.5) — 가까이 서도 아이 그림이 흐리지 않게 */
const FR_K = 2;
function frameStyle(f: { x: number; y: number; z: number; w: number; h: number; ry: number }) {
  const st = planeStyle({ ...f, w: f.w * FR_K, h: f.h * FR_K });
  return { ...st, transform: `${st.transform} scale(${1 / FR_K})` };
}
const frames = computed(() => props.layout.frames.map((f) => ({
  key: f.key, item: f.item, title: titleOf(f.item), style: frameStyle(f), t: { key: f.key, x: f.x, z: f.z, item: f.item, pose: f.pose } as Target,
})));
const pedArts = computed(() => props.layout.pedestals.filter((p) => p.item).map((p) => ({
  key: `${p.key}-art`, item: p.item!, title: titleOf(p.item!), x: p.x, y: 1.33, z: p.z, w: 0.7, h: 0.75,
  t: { key: p.key, x: p.x, z: p.z, item: p.item!, pose: p.pose } as Target,
})));
/** 가운데 홀 받침대 위 만들기 작품(배경 없는 모습 = cutout, 없으면 사진) · 위 스포트라이트 */
const plArts = computed(() => props.layout.plinths.filter((p) => p.item).map((p) => ({
  key: `${p.key}-art`, item: p.item!, title: titleOf(p.item!), x: p.x, y: PLINTH_H + 0.5, z: p.z, w: 0.9, h: 1,
  t: { key: p.key, x: p.x, z: p.z, item: p.item!, pose: p.pose } as Target,
})));
const beams = computed(() => props.layout.plinths.map((p) => ({ key: `${p.key}-beam`, x: p.x, z: p.z, y: (PLINTH_H + WALL_H) / 2, w: 1.6, h: WALL_H - PLINTH_H })));
const statues = computed(() => props.layout.statues.map((s) => {
  // 층계참 동상(D52) = 캐릭터 약 1.8m + 둥근 대리석 받침 1.2m(폭 1.6m) — 받침 포함 약 3m
  const size = s.kind === 'character' ? { w: 1.9, h: 3.0 } : s.kind === 'art' ? { w: 0.7, h: 1.55 } : { w: 0.8, h: 1.3 };
  return { ...s, ...size, y: size.h / 2 };
}));
/** 카메라를 향해 도는 판. 그림이 흐려지지 않게 BB_K배 크게 그린 뒤 scale(1/BB_K)로 줄인다(안쪽은 zoom) */
const BB_K = 3;
const bbStyle = (b: { w: number; h: number }, k = BB_K) => ({ width: `${b.w * 100 * k}px`, height: `${b.h * 100 * k}px`, margin: `${-b.h * 50 * k}px 0 0 ${-b.w * 50 * k}px` });
const zStyle = (b: { w: number; h: number }) => ({ zoom: BB_K, width: `${b.w * 100}px`, height: `${b.h * 100}px` });
const murals = computed(() => props.layout.murals.map((m) => ({ ...m, style: planeStyle(m) })));
const targets = computed<Target[]>(() => [...frames.value.map((f) => f.t), ...pedArts.value.map((p) => p.t), ...plArts.value.map((p) => p.t)]);

// ---------- 카메라 ----------
const vp = ref<HTMLElement | null>(null);
const world = ref<HTMLElement | null>(null);
const cam = { ...props.layout.start, pitch: props.layout.start.pitch ?? 0 };
const view = shallowRef<Pose>({ ...props.layout.start });
const nearKey = ref<string | null>(null);
const near = computed(() => targets.value.find((t) => t.key === nearKey.value) ?? null);
const area = computed(() => areaOf(props.layout, view.value));
const where = computed(() => { const a = area.value; return a === 'lobby' ? m3.lobby : a === 'hall' ? m3.hall : props.layout.rooms[a]?.label ?? m3.hall; });
/** 아래 큰 방 버튼 줄(팀장 요구 2026-09-30): 로비 · 가운데 홀 · 방마다 — 누르면 그 방 문턱으로 걸어가 안을 본다 */
const bar = computed(() => [
  { key: 'lobby', label: m3.lobby, pose: props.layout.start, here: area.value === 'lobby' },
  { key: 'hall', label: m3.hall, pose: props.layout.hallEntry, here: area.value === 'hall' },
  ...props.layout.rooms.map((r) => ({ key: `r${r.index}`, label: r.label, pose: r.entry, here: area.value === r.index })),
]);
let P = 800;
let bbs: { el: HTMLElement; x: number; y: number; z: number; k: number }[] = [];

function measure() {
  const el = vp.value; if (!el) return;
  const w = el.clientWidth || 800; const h = el.clientHeight || 600;
  P = perspectiveFor(w, h); // 화각 65°(D45)
  el.style.perspective = `${P.toFixed(1)}px`;
  render();
}
function render() {
  const w = world.value; if (!w) return;
  w.style.transform = `translateZ(${(P - 1).toFixed(1)}px) rotateX(${cam.pitch.toFixed(2)}deg) rotateY(${(-cam.yaw).toFixed(2)}deg) translate3d(${(-cam.x * 100).toFixed(1)}px,${(floorAt(cam.z) * 100 + bobY + hopY).toFixed(2)}px,${(cam.z * 100).toFixed(1)}px)`;
  for (const b of bbs) b.el.style.transform = `${planeTf({ x: b.x, y: b.y, z: b.z, ry: Math.round((Math.atan2(cam.x - b.x, -(cam.z - b.z)) * 180) / Math.PI) })}${b.k !== 1 ? ` scale(${(1 / b.k).toFixed(4)})` : ''}`;
}
let lastPub = 0;
function publish(force = false) {
  const t = performance.now(); if (!force && t - lastPub < 100) return; lastPub = t;
  view.value = { x: cam.x, z: cam.z, yaw: cam.yaw };
}
function sense() {
  const n = nearestTarget(cam, targets.value);
  if ((n?.key ?? null) !== nearKey.value) nearKey.value = n?.key ?? null;
}

// ---------- 자동 걷기 ----------
let tween: { pts: Vec[]; cum: number[]; total: number; dur: number; t0: number; yaw0: number; yaw1: number; pitch0: number; pitch1: number } | null = null;
let tweenDone: (() => void) | null = null;
/** 자동 걷기를 멈춘다(끝남 · 손으로 움직임) — 기다리던 쪽에 알린다 */
function stopTween() { tween = null; const d = tweenDone; tweenDone = null; d?.(); }
function startPath(pts: Vec[], yaw: number, pitch = 0): Promise<void> {
  stopTween();
  const from = { x: cam.x, z: cam.z };
  if (reducedMotion()) { const last = pts[pts.length - 1]!; cam.x = last.x; cam.z = last.z; cam.yaw = yaw; cam.pitch = pitch; render(); sense(); publish(true); return Promise.resolve(); }
  const all = [from, ...pts]; const cum = [0];
  for (let i = 1; i < all.length; i++) cum.push(cum[i - 1]! + Math.hypot(all[i]!.x - all[i - 1]!.x, all[i]!.z - all[i - 1]!.z));
  const total = cum[cum.length - 1]!;
  let y1 = yaw; while (y1 - cam.yaw > 180) y1 -= 360; while (y1 - cam.yaw < -180) y1 += 360;
  const dur = Math.min(3200, Math.max(700, (total / 2.6) * 1000 + Math.abs(y1 - cam.yaw) * 3));
  tween = { pts: all, cum, total, dur, t0: performance.now(), yaw0: cam.yaw, yaw1: y1, pitch0: cam.pitch, pitch1: pitch };
  const done = new Promise<void>((r) => { tweenDone = r; });
  kick();
  return done;
}
/** 그 자리 · 그 방향으로 걸어간다(방이 다르면 문을 지나서) */
function goTo(pose: Pose): Promise<void> { return startPath(pathTo(props.layout, cam, pose), pose.yaw, pose.pitch ?? 0); }
/** 방 버튼: 작게 점프하고 그 방 문턱으로(D44) */
function goRoom(pose: Pose) { hop(); void goTo(pose); }
function goToPoint(p: Vec) {
  const pts = pathTo(props.layout, cam, p); const prev = pts.length > 1 ? pts[pts.length - 2]! : { x: cam.x, z: cam.z };
  void startPath(pts, Math.hypot(p.x - prev.x, p.z - prev.z) > 0.2 ? yawOf(p.x - prev.x, p.z - prev.z) : cam.yaw);
}
function stepTween(t: number) {
  const a = tween!; const k = Math.max(0, Math.min(1, (t - a.t0) / a.dur)); const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
  const s = a.total * e; let i = 1; while (i < a.cum.length - 1 && a.cum[i]! < s) i++;
  const p0 = a.pts[i - 1]!; const p1 = a.pts[i]!; const seg = a.cum[i]! - a.cum[i - 1]!; const u = seg > 1e-6 ? (s - a.cum[i - 1]!) / seg : 1;
  cam.x = p0.x + (p1.x - p0.x) * u; cam.z = p0.z + (p1.z - p0.z) * u;
  cam.yaw = a.yaw0 + (a.yaw1 - a.yaw0) * e; cam.pitch = a.pitch0 + (a.pitch1 - a.pitch0) * e;
  if (k >= 1) stopTween();
}

// ---------- 매 프레임(움직일 때만 돈다) ----------
const keys = new Set<string>();
let raf = 0; let running = false; let last = 0;
const rafFn: (cb: FrameRequestCallback) => number = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => window.setTimeout(() => cb(performance.now()), 16);
const cancelFn: (id: number) => void = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id) => window.clearTimeout(id);
function kick() { if (running) return; running = true; last = performance.now(); raf = rafFn(tick); }
function moving() { return ['w', 's', 'a', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => keys.has(k)); }
/** 걷기 속도(앞 · 옆, m/s) — 목표 속도로 0.35초 동안 부드럽게 붙는다 */
const vel = { f: 0, r: 0 };
/** 끌기를 놓은 뒤 관성(도/초) */
const spin = { yaw: 0, pitch: 0 };
let wheelLeft = 0;
let bobT = 0; let bobY = 0;
function busy() { return !!tween || (!props.paused && moving()) || Math.hypot(vel.f, vel.r) > 0.01 || Math.abs(spin.yaw) + Math.abs(spin.pitch) > 0.5 || Math.abs(wheelLeft) > 0.005; }
function walkBy(df: number, dr: number) {
  const y = (cam.yaw * Math.PI) / 180;
  const to = { x: cam.x - Math.sin(y) * df + Math.cos(y) * dr, z: cam.z + Math.cos(y) * df + Math.sin(y) * dr };
  const p = clampMove(props.layout, cam, to); const moved = Math.hypot(p.x - cam.x, p.z - cam.z); cam.x = p.x; cam.z = p.z; return moved;
}
function tick(_ts: number) {
  const t = performance.now(); // 모든 시간은 performance.now 한 기준(rAF 시각은 환경마다 기준이 달라 걷기가 뒤로 튈 수 있음)
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t;
  const ease = 1 - Math.exp(-dt / (EASE_S / 3)); // 0.35초에 약 95%
  if (tween) stepTween(t);
  else {
    let f = 0; let r = 0;
    if (!props.paused) {
      f = (keys.has('w') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('s') || keys.has('ArrowDown') ? 1 : 0);
      r = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      cam.yaw += ((keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0)) * TURN * dt;
    }
    const m = Math.hypot(f, r); const n = Math.max(1, m); const sp = WALK * (keys.has('Shift') ? RUN : 1);
    vel.f += ((f / n) * sp - vel.f) * ease; vel.r += ((r / n) * sp - vel.r) * ease;
    if (Math.hypot(vel.f, vel.r) > 0.005) walkBy(vel.f * dt, vel.r * dt); else { vel.f = 0; vel.r = 0; }
    if (Math.abs(wheelLeft) > 0.005) { // 휠: 남은 거리를 부드럽게 걷는다
      const step = wheelLeft * (1 - Math.exp(-dt / 0.18));
      const moved = walkBy(step, 0); wheelLeft = moved < Math.abs(step) * 0.5 ? 0 : wheelLeft - step;
    } else wheelLeft = 0;
    if (!drag && Math.abs(spin.yaw) + Math.abs(spin.pitch) > 0.5) { // 관성
      cam.yaw += spin.yaw * dt; cam.pitch = clampPitch(cam.pitch + spin.pitch * dt);
      const k = Math.exp(-dt / 0.28); spin.yaw *= k; spin.pitch *= k;
    } else if (!drag) { spin.yaw = 0; spin.pitch = 0; }
  }
  const speed = tween ? 1 : Math.hypot(vel.f, vel.r) / WALK;
  if (reducedMotion() || speed < 0.05) bobY *= 0.8; else { bobT += dt * 7; bobY = Math.sin(bobT) * BOB_PX * Math.min(1, speed); }
  render(); sense(); publish();
  const w = !!tween || Math.hypot(vel.f, vel.r) > 0.2 || Math.abs(wheelLeft) > 0.05;
  if (w !== walking.value) walking.value = w;
  if (busy()) raf = rafFn(tick);
  else { running = false; bobY = 0; render(); publish(true); }
}

// ---------- 입력 ----------
const typing = (e: Event) => { const t = e.target as HTMLElement | null; return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || !!t.closest?.('[role=dialog]')); };
const MOVE_KEYS = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift'];
function onKey(e: KeyboardEvent) {
  if (props.paused || typing(e)) return;
  if (e.key === ' ' || e.code === 'Space') {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('button, a, input, textarea, select, [contenteditable]')) return;
    e.preventDefault(); jump(); return;
  }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (MOVE_KEYS.includes(k)) { keys.add(k); if (k !== 'Shift') { e.preventDefault(); stopTween(); kick(); } return; }
  if ((k === 'e' || k === 'Enter') && near.value && !(e.target as HTMLElement)?.closest?.('button,a')) { e.preventDefault(); emit('open', near.value.item); }
}
function onKeyUp(e: KeyboardEvent) { keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); }
function onBlur() { keys.clear(); }

let drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean; lx: number; ly: number; lt: number } | null = null;
let lastTap: { t: number; x: number; y: number } | null = null;
let swallowClick = false;
function onDown(e: PointerEvent) {
  if (props.paused || drag || (e.button ?? 0) > 0 || (e.target as HTMLElement).closest?.('.m3-hud')) return;
  spin.yaw = 0; spin.pitch = 0;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false, lx: e.clientX, ly: e.clientY, lt: performance.now() };
}
function onMove(e: PointerEvent) {
  const d = drag; if (!d || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x; const dy = e.clientY - d.y;
  if (!d.moved && Math.hypot(dx, dy) < 6) return;
  if (!d.moved) { d.moved = true; stopTween(); try { vp.value?.setPointerCapture(e.pointerId); } catch { /* 없어도 됨 */ } }
  cam.yaw = d.yaw - dx * DRAG; cam.pitch = clampPitch(d.pitch - dy * DRAG);
  // 관성용 속도(도/초, 부드럽게)
  const now = performance.now(); const ddt = Math.max(1, now - d.lt) / 1000;
  spin.yaw = spin.yaw * 0.6 + (-(e.clientX - d.lx) * DRAG / ddt) * 0.4; spin.pitch = spin.pitch * 0.6 + (-(e.clientY - d.ly) * DRAG / ddt) * 0.4;
  d.lx = e.clientX; d.ly = e.clientY; d.lt = now;
  render(); sense(); publish();
}
function onUp(e: PointerEvent) {
  const d = drag; if (!d || e.pointerId !== d.id) return;
  drag = null;
  if (d.moved) {
    swallowClick = true; setTimeout(() => { swallowClick = false; });
    if (reducedMotion() || performance.now() - d.lt > 80) { spin.yaw = 0; spin.pitch = 0; } // 멈췄다 놓으면 관성 없음
    spin.yaw = Math.max(-240, Math.min(240, spin.yaw)); spin.pitch = Math.max(-120, Math.min(120, spin.pitch));
    kick(); publish(true); return;
  }
  const target = e.target as HTMLElement;
  if (target.closest?.('button,a,.m3-hud')) return;
  // 받침대 · 진열대 · 문 이름판: 한 번 누르면 그 앞으로(D52 B)
  const tk = target.closest?.<HTMLElement>('[data-tk]')?.dataset.tk; const pose = tk ? poseOf.value.get(tk) : undefined;
  if (pose) { lastTap = null; void goTo(pose); return; }
  const now = performance.now();
  if (lastTap && now - lastTap.t < 360 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap = null;
    if (target.classList.contains('pl-floor') || target.classList.contains('pl-step')) floorWalk(e.clientX, e.clientY);
  }
  else lastTap = { t: now, x: e.clientX, y: e.clientY };
}
/** 휠: 천천히 앞뒤로 걷기(한 칸 약 0.4m, 부드럽게) */
function onWheel(e: WheelEvent) {
  if (props.paused) return;
  e.preventDefault();
  const notches = Math.max(-3, Math.min(3, e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100));
  stopTween(); wheelLeft = Math.max(-2, Math.min(2, wheelLeft - notches * WHEEL_M)); kick();
}
function onClickCapture(e: MouseEvent) { if (swallowClick) { e.preventDefault(); e.stopPropagation(); swallowClick = false; } }
/** 바닥 두 번 누르기 → 그 자리로(벽 여유 안으로 당겨서) */
function floorWalk(cx: number, cy: number) {
  const el = vp.value; if (!el) return;
  const r = el.getBoundingClientRect();
  const hit = screenToFloor(cam, cx - (r.left + r.width / 2), cy - (r.top + r.height / 2), P);
  if (!hit || Math.hypot(hit.x - cam.x, hit.z - cam.z) > 40) return;
  for (let i = 0; i <= 12; i++) { // 벽에 붙은 자리면 조금씩 당긴다
    const p = { x: hit.x + (cam.x - hit.x) * (i / 24), z: hit.z + (cam.z - hit.z) * (i / 24) };
    if (canStand(props.layout, p.x, p.z)) { goToPoint(p); return; }
  }
}
/** 액자 · 진열대: 가까우면 크게 보기, 멀면 그 앞으로 */
function activate(t: Target) {
  const i = props.layout.tour.findIndex((s) => s.key === t.key); if (i >= 0) tourAt.value = i;
  if (isNear(cam, t)) emit('open', t.item); else void goTo(t.pose);
}
function face(t: Target) { if (tween || drag) return; cam.yaw = yawOf(t.x - cam.x, t.z - cam.z); cam.pitch = 0; render(); sense(); publish(true); }
/** 3D 버튼에 초점이 가면 브라우저가 감싼 상자를 밀 수 있다 — 늘 제자리로 */
function noScroll(e: Event) { const el = e.currentTarget as HTMLElement | null; if (el && (el.scrollTop || el.scrollLeft)) { el.scrollTop = 0; el.scrollLeft = 0; } }

// ---------- 앞 · 다음 작품(D52 B): 방 순서 → 벽 순서, 받침대 포함. 끝에서 [다음]은 [처음으로] ----------
const tourAt = ref(-1);
const atEnd = computed(() => tourAt.value >= props.layout.tour.length - 1);
function tourGo(i: number) {
  const stop = props.layout.tour[i]; if (!stop) return;
  tourAt.value = i; void goTo(stop.pose);
}
function tourNext() { if (!props.layout.tour.length) return; tourGo(atEnd.value ? 0 : tourAt.value + 1); }
function tourPrev() { if (!props.layout.tour.length) return; tourGo(Math.max(0, tourAt.value - 1)); }

// ---------- Space = 점프(D52 C): 입력 칸 · 버튼 초점이면 무시, 움직임 줄이기면 없음. 장면이 있을 때만 듣는다 ----------
let hopY = 0; let hopT0 = 0; let hopRaf = 0;
function jump() {
  if (reducedMotion()) return;
  hop(); hopT0 = performance.now(); cancelFn(hopRaf);
  const step = () => {
    const k = (performance.now() - hopT0) / 480;
    hopY = k >= 1 ? 0 : Math.sin(Math.PI * k) * 22; render();
    if (k < 1) hopRaf = rafFn(step);
  };
  hopRaf = rafFn(step);
}

onMounted(() => {
  bbs = [...(world.value?.querySelectorAll<HTMLElement>('[data-bb]') ?? [])].map((el) => ({ el, x: Number(el.dataset.x), y: Number(el.dataset.y), z: Number(el.dataset.z), k: Number(el.dataset.k ?? BB_K) || 1 }));
  measure(); sense(); publish(true);
  vp.value?.addEventListener('wheel', onWheel, { passive: false });
  if (props.hang) void playHang(props.hang); else if (props.autoWalkIn) void walkIn();
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur); window.addEventListener('resize', measure);
});
onBeforeUnmount(() => {
  cancelFn(raf); running = false; vp.value?.removeEventListener('wheel', onWheel);
  window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); window.removeEventListener('resize', measure);
});
// ---------- 아이 캐릭터(3인칭 살짝, D44) ----------
const walking = ref(false);
const jumping = ref(false);
const entering = ref(false);
const carrying = ref<string | null>(null);
const giving = ref(false);
const sparkle = ref(false);
const pendingKey = ref<string | null>(null);
const appearKey = ref<string | null>(null);
let hopTimer = 0;
function hop() { if (reducedMotion() || !props.companion) return; jumping.value = false; clearTimeout(hopTimer); rafFn(() => { jumping.value = true; }); hopTimer = window.setTimeout(() => { jumping.value = false; }, 520); }
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** 들어올 때: 정문에서 대계단 아래까지 걸어 들어와 층계참 동상을 올려 본다 · 끝나면 처음이면 3칸 안내 */
async function walkIn() {
  const s = props.layout.start;
  if (!reducedMotion() && props.companion) {
    entering.value = true; cam.x = s.x; cam.z = 0.3; cam.yaw = s.yaw; cam.pitch = 2; render();
    await goTo(s);
    entering.value = false;
  } else { cam.x = s.x; cam.z = s.z; cam.yaw = s.yaw; cam.pitch = s.pitch ?? 0; render(); sense(); publish(true); }
  if (props.coach && !coachSeen()) showCoach.value = true;
}
const showCoach = ref(false);
/** 걸리는 장면(D44 ④): 캐릭터가 그림을 들고 그 방으로 → 벽 자리에 건다(입체는 진열대) → 금빛 반짝 → 크게 보기 */
async function playHang(id: string) {
  const t = targets.value.find((x) => x.item.id === id); if (!t) { emit('hangDone', id); return; }
  const finish = () => { emit('hangDone', id); if (props.openAfterHang) emit('open', t.item); }; // 물어보기가 기다리면 여는 것은 부르는 쪽이
  if (reducedMotion() || !props.companion) { await goTo(t.pose); finish(); return; }
  pendingKey.value = t.key; carrying.value = t.item.imageUrl ?? null;
  await wait(350);
  await goTo(t.pose);
  giving.value = true; await wait(420);
  pendingKey.value = null; appearKey.value = t.key; carrying.value = null; giving.value = false; sparkle.value = true;
  await wait(950);
  sparkle.value = false; appearKey.value = null;
  finish();
}
onBeforeUnmount(() => { clearTimeout(hopTimer); cancelFn(hopRaf); stopTween(); });
defineExpose({ goTo, playHang, walkIn, jump, tourNext, tourPrev });
</script>

<template>
  <div class="m3s" :style="{ '--tint': layout.color }" @scroll="noScroll">
    <div ref="vp" class="m3-vp" role="region" :aria-label="m3.scene(layout.alias)"
      @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @click.capture="onClickCapture" @scroll="noScroll">
      <div ref="world" class="m3-world">
        <div v-for="p in planes" :key="p.key" class="m3-pl" :class="p.cls" :style="p.style" :data-tk="p.tk || undefined" aria-hidden="true">{{ p.text }}</div>
        <div v-for="b in beams" :key="b.key" class="m3-pl m3-beam" :style="bbStyle(b, 1)" data-bb data-k="1" :data-x="b.x" :data-y="b.y" :data-z="b.z" aria-hidden="true"></div>
        <div v-for="m in murals" :key="m.key" class="m3-pl" :class="m.big ? 'mural-big' : 'mural-mini'" :style="m.style" aria-hidden="true">
          <Mural v-if="m.big" :tint="layout.color" />
        </div>
        <button v-for="f in frames" :key="f.key" type="button" class="m3-pl m3-frame" :class="{ near: nearKey === f.key, pending: pendingKey === f.key, appear: appearKey === f.key }" :style="f.style"
          :data-title="f.title" :aria-label="m3.artButton(f.title)" @click="activate(f.t)" @focus="face(f.t)">
          <img v-if="f.item.imageUrl" :src="f.item.imageUrl" alt="" draggable="false" decoding="async">
          <video v-else-if="f.item.videoUrl" :src="f.item.videoUrl" muted playsinline preload="metadata" aria-hidden="true"></video>
        </button>
        <button v-for="p in pedArts" :key="p.key" type="button" class="m3-pl m3-ped-art" :class="{ near: nearKey === p.t.key, pending: pendingKey === p.t.key, appear: appearKey === p.t.key }" :style="bbStyle(p)"
          data-bb :data-x="p.x" :data-y="p.y" :data-z="p.z" :aria-label="m3.artButton(p.title)" @click="activate(p.t)" @focus="face(p.t)">
          <span class="bb-z bb-art" :style="zStyle(p)"><img v-if="p.item.imageUrl" :src="p.item.imageUrl" alt="" draggable="false" decoding="async"><i v-else class="m3-blob" aria-hidden="true"></i></span>
        </button>
        <button v-for="p in plArts" :key="p.key" type="button" class="m3-pl m3-ped-art m3-pl-art" :class="{ near: nearKey === p.t.key, pending: pendingKey === p.t.key, appear: appearKey === p.t.key }" :style="bbStyle(p)"
          data-bb :data-x="p.x" :data-y="p.y" :data-z="p.z" :aria-label="m3.artButton(p.title)" @click="activate(p.t)" @focus="face(p.t)">
          <span class="bb-z bb-art" :style="zStyle(p)"><img v-if="p.item.imageUrl" :src="p.item.imageUrl" alt="" draggable="false" decoding="async"><i v-else class="m3-blob" aria-hidden="true"></i></span>
        </button>
        <div v-for="s in statues" :key="s.key" class="m3-pl m3-statue" :class="`st-${s.kind}`" :style="bbStyle(s)"
          data-bb :data-x="s.x" :data-y="s.y" :data-z="s.z" aria-hidden="true"><div class="bb-z bb-st" :style="zStyle(s)">
          <template v-if="s.kind === 'character'">
            <div class="st-hero"><CharacterAvatar :kind="kind" :color="tint" :size="175" /></div>
            <div class="st-cyl big"><span>{{ m3.plaque(layout.alias) }}</span></div>
          </template>
          <template v-else-if="s.kind === 'art'">
            <img class="st-mini" :src="s.item!.imageUrl!" alt="" draggable="false" decoding="async">
            <div class="st-cyl"></div>
          </template>
          <div v-else class="st-pot"></div>
        </div></div>
      </div>
    </div>

    <p class="m3-hud m3-where" aria-live="polite">{{ where }}</p>
    <RouterLink v-if="invite" class="m3-hud m3-invite" :to="{ path: '/app/family', hash: '#neighbors' }">{{ m3.invite }}</RouterLink>
    <button class="m3-hud m3-exit" type="button" :aria-label="props.exitLabel ?? m3.exitLabel" @click="emit('exit')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>{{ m3.exit }}
    </button>
    <button v-if="near" class="m3-hud m3-prompt" type="button" @click="emit('open', near.item)">
      <kbd v-if="!touch" aria-hidden="true">E</kbd><span><b>{{ titleOf(near.item) }}</b><small>{{ m3.nearOpen }}</small></span>
    </button>
    <!-- 도움말: 누르기만 적는다(D52 B). 낱말마다 줄바꿈 없이 " · "로 잇는다 -->
    <p v-if="!near" class="m3-hud m3-keys" :class="{ touch }" aria-hidden="true"><template v-for="(k, i) in keyHints" :key="k"><span v-if="i" class="sep"> · </span><span>{{ k }}</span></template></p>
    <div v-if="layout.tour.length" class="m3-hud m3-tour" role="group" :aria-label="m3.tourLabel">
      <button type="button" class="t-prev" :disabled="tourAt <= 0" @click="tourPrev"><span aria-hidden="true">◀ </span>{{ m3.prev }}</button>
      <button type="button" class="t-next" @click="tourNext">{{ atEnd ? m3.restart : m3.next }}<span v-if="!atEnd" aria-hidden="true"> ▶</span></button>
    </div>
    <p v-if="touch" class="m3-hud m3-sr">{{ m3.touchKeys }}</p>
    <nav class="m3-hud m3-bar" :aria-label="m3.roomBar">
      <button v-for="b in bar" :key="b.key" type="button" :aria-current="b.here ? 'location' : undefined" @click="goRoom(b.pose)">{{ b.label }}</button>
    </nav>
    <Minimap :layout="layout" :cam="view" @go="goTo" />
    <div v-if="companion" class="m3-me" :class="{ walking, jumping, entering }" aria-hidden="true">
      <div class="me-body">
        <span v-if="carrying !== null" class="me-carry" :class="{ give: giving }"><img v-if="carrying" :src="carrying" alt=""></span>
        <CharacterAvatar :kind="kind" :color="tint" :size="meSize" />
      </div>
      <i class="me-shadow"></i>
    </div>
    <div v-if="sparkle" class="m3-spark" aria-hidden="true"><i v-for="n in 10" :key="n" :style="{ '--a': `${n * 36}deg` }"></i></div>
    <Coach v-if="showCoach" @done="showCoach = false" />
    <slot />
  </div>
</template>

<style scoped>
.m3s{position:relative;width:100%;height:100%;overflow:hidden;background:#F7F3EC;color:#6E3550}
.m3-vp{position:absolute;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;
  background:linear-gradient(#FBF9F5,#F1ECE3)}
.m3-vp:active{cursor:grabbing}
.m3-world{position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d}
.m3-pl{position:absolute;left:0;top:0;box-sizing:border-box}

/* 바닥: 밝은 대리석 — 크림 + 연회색 1m 체크 */
.pl-floor{background:linear-gradient(135deg,rgba(255,255,255,.35),rgba(255,255,255,0) 40%,rgba(255,255,255,.25)),
  repeating-conic-gradient(#F6F1E8 0 25%,#E7E4DF 0 50%) 0 0/200px 200px}
.pl-hall{background:radial-gradient(ellipse 42% 30% at 50% 50%,rgba(255,246,214,.7),rgba(255,246,214,0) 70%) 0 0/100% 800px repeat-y,
  repeating-conic-gradient(#F6F1E8 0 25%,#E7E4DF 0 50%) 0 0/200px 200px}
.pl-lobby{background:radial-gradient(circle at 31.7% 27.8%,#EDE3D0 0 92px,#FFFFFF 93px 104px,#D9C49A 105px 110px,rgba(0,0,0,0) 111px),
  repeating-conic-gradient(#F6F1E8 0 25%,#E7E4DF 0 50%) 0 0/200px 200px}
.pl-room.pl-floor{box-shadow:inset 0 0 0 10px #EFE7DA}
/* 천장 · 천창 */
/* 천장: 크림 격자 우물반자 + 금빛 테(밝게). 가운데 홀은 자체 제작 천장화(하늘 · 구름 · 금빛 격자) — 실제 그림 · 사진 아님 */
.pl-ceil{background:repeating-linear-gradient(90deg,rgba(201,162,74,.55) 0 3px,rgba(0,0,0,0) 3px 100px),repeating-linear-gradient(0deg,rgba(201,162,74,.55) 0 3px,rgba(0,0,0,0) 3px 100px),
  radial-gradient(circle at 50% 50%,#FFFFFF,#F7F1E6 70%);background-size:100px 100px,100px 100px,100% 100%;box-shadow:inset 0 0 0 12px #EFE4CC,inset 0 0 0 15px #C9A24A}
.pl-sky{background:
  radial-gradient(ellipse 14% 7% at 38% 30%,rgba(255,255,255,.95),rgba(255,255,255,0) 70%),radial-gradient(ellipse 18% 6% at 62% 55%,rgba(255,255,255,.9),rgba(255,255,255,0) 70%),
  radial-gradient(ellipse 12% 5% at 45% 78%,rgba(255,255,255,.9),rgba(255,255,255,0) 70%),
  linear-gradient(90deg,rgba(0,0,0,0) 0 calc(25% - 8px),#C9A24A calc(25% - 8px) calc(25% - 3px),rgba(0,0,0,0) calc(25% - 3px) calc(75% + 3px),#C9A24A calc(75% + 3px) calc(75% + 8px),rgba(0,0,0,0) calc(75% + 8px)),
  linear-gradient(90deg,rgba(0,0,0,0) 25%,#DCEFFF 25% 75%,rgba(0,0,0,0) 75%),
  repeating-linear-gradient(90deg,rgba(201,162,74,.6) 0 3px,rgba(0,0,0,0) 3px 100px) 0 0/100px 100px,repeating-linear-gradient(0deg,rgba(201,162,74,.6) 0 3px,rgba(0,0,0,0) 3px 100px) 0 0/100px 100px,
  #FBF6EC;box-shadow:inset 0 0 0 12px #EFE4CC,inset 0 0 0 15px #C9A24A}
/* 벽: 흰 회반죽 + 위 금선 + 아랫단 */
/* 벽: 흰 회반죽 · 위 금빛 코니스(몰딩 띠) · 허리 금선 · 아랫단 */
.pl-wall{background:linear-gradient(to bottom,#F3E7C9 0 10px,#C9A24A 10px 14px,#FFF8E8 14px 26px,#E7D6AE 26px 30px,#C9A24A 30px 32px,rgba(0,0,0,0) 32px),
  linear-gradient(to top,#EFE6D6 0 22px,#C9A24A 22px 24px,#F6EFE2 24px 92px,#D9C08A 92px 94px,rgba(0,0,0,0) 94px),
  linear-gradient(to bottom,#FFFFFF,#FDFBF7 40%,#F7F2E9)}
.pl-lintel{background:radial-gradient(circle at 50% 100%,rgba(0,0,0,0) 0 var(--r,100px),#C9A24A var(--r,100px) calc(var(--r,100px) + 4px),#F3E7C9 calc(var(--r,100px) + 4px) calc(var(--r,100px) + 12px),#C9A24A calc(var(--r,100px) + 12px) calc(var(--r,100px) + 14px),rgba(0,0,0,0) calc(var(--r,100px) + 14px)),
  linear-gradient(to bottom,#F3E7C9 0 10px,#C9A24A 10px 14px,#FFF8E8 14px 26px,#E7D6AE 26px 30px,#C9A24A 30px 32px,rgba(0,0,0,0) 32px),linear-gradient(#FFFFFF,#FAF7F1)}
.pl-entry{background:linear-gradient(to bottom,#D8EEFF,#EEF8E6) 50% 100%/200px 300px no-repeat,
  linear-gradient(#E6CB86,#C9A552) 50% 100%/224px 312px no-repeat,
  linear-gradient(to bottom,#FFFFFF,#FDFBF7 40%,#F6F1E9)}
.pl-col{background:repeating-linear-gradient(90deg,rgba(90,70,40,.05) 0 3px,rgba(0,0,0,0) 3px 10px),
  linear-gradient(to bottom,#EADFC8 0 26px,rgba(0,0,0,0) 26px calc(100% - 22px),#EADFC8 calc(100% - 22px)),
  linear-gradient(90deg,#ECE6DC,#FFFFFF 35%,#F3EEE6 60%,#E1D9CB)}
.pl-side{filter:brightness(.95)}
/* 방 먼 벽 위쪽: 금테 판넬 두 줄(빈 벽이 허전하지 않게) */
.pl-far{background:linear-gradient(#C9A24A,#C9A24A) 50% 150px/calc(100% - 120px) 2px no-repeat,linear-gradient(#C9A24A,#C9A24A) 50% 290px/calc(100% - 120px) 2px no-repeat,
  linear-gradient(90deg,#C9A24A,#C9A24A) 60px 150px/2px 142px no-repeat,linear-gradient(90deg,#C9A24A,#C9A24A) calc(100% - 60px) 150px/2px 142px no-repeat,
  linear-gradient(#FBF4E4,#FBF4E4) 50% 152px/calc(100% - 124px) 138px no-repeat,
  linear-gradient(to bottom,#F3E7C9 0 10px,#C9A24A 10px 14px,#FFF8E8 14px 26px,#E7D6AE 26px 30px,#C9A24A 30px 32px,rgba(0,0,0,0) 32px),
  linear-gradient(to top,#EFE6D6 0 22px,#C9A24A 22px 24px,#F6EFE2 24px 92px,#D9C08A 92px 94px,rgba(0,0,0,0) 94px),
  linear-gradient(to bottom,#FFFFFF,#FDFBF7 40%,#F7F2E9)}
.pl-label.pl-title{font-size:34px;letter-spacing:.04em}
.pl-label{display:grid;place-items:center;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:2px solid #C9A24A;border-radius:4px;
  background:linear-gradient(#FFFBF4,#F6EEDF);box-shadow:inset 0 0 0 4px #FFFBF4,inset 0 0 0 5px #E3CD95;font:600 24px/1 var(--mc-serif,'Noto Serif KR',serif);color:#4A3526}
.pl-note{display:grid;place-items:center;padding:4px 8px;text-align:center;border:1px dashed #D8C5A0;border-radius:4px;background:rgba(255,251,244,.95);font:600 11px/1.3 var(--font-sans);color:#7A5A48}
.pl-plinth{background:linear-gradient(#FFFFFF,#EEE8DE);box-shadow:inset 0 -10px 0 #E6DECF}
.pl-plinth.pl-top{background:#F8F5EF;box-shadow:none}
/* 가운데 홀 받침대(D45): 대리석 · 위 스포트라이트 · 황동 명패(세리프). 비면 점선 */
.pl-marble{background:linear-gradient(160deg,rgba(255,255,255,.6),rgba(255,255,255,0) 45%),
  linear-gradient(115deg,rgba(0,0,0,0) 30%,rgba(170,160,145,.18) 31%,rgba(0,0,0,0) 33%,rgba(0,0,0,0) 62%,rgba(170,160,145,.14) 63%,rgba(0,0,0,0) 65%),
  linear-gradient(#FBF9F4,#ECE7DE);box-shadow:inset 0 10px 0 -4px #F5F0E6,inset 0 -8px 0 #E2DACB}
.pl-marble.pl-top{background:#F9F6F0;box-shadow:inset 0 0 0 3px #E8E0D0}
.pl-marble.pl-empty{background:rgba(251,249,244,.55);border:2px dashed #C9A24A;box-shadow:none}
.pl-pool{pointer-events:none;background:radial-gradient(circle,rgba(255,244,210,.8),rgba(255,244,210,0) 65%)}
.pl-plaque{display:grid;place-items:center;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:2px;
  background:linear-gradient(135deg,#F1E2B6,#D8BC72 55%,#B8913A);color:#2B2007;font:600 10px/1 var(--mc-serif,'Noto Serif KR',serif);box-shadow:0 2px 3px -2px rgba(0,0,0,.4)}
.m3-beam{pointer-events:none;background:linear-gradient(to bottom,rgba(255,250,228,.55),rgba(255,250,228,.12) 70%,rgba(255,250,228,0));
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 35%,#000 65%,transparent);mask-image:linear-gradient(90deg,transparent,#000 35%,#000 65%,transparent)}
.m3-pl-art img{filter:drop-shadow(0 10px 8px rgba(74,52,65,.3))}
.pl-glass{pointer-events:none;border:1px solid rgba(255,255,255,.9);background:linear-gradient(135deg,rgba(225,243,255,.32),rgba(255,255,255,.06) 55%,rgba(225,243,255,.28))}
/* 벽화 */
.mural-big{border:10px solid #E6CB86;box-shadow:0 0 0 4px #FFF8EA,0 20px 40px -24px rgba(74,52,65,.4);background:#FFF8EC}
.mural-mini{border:6px solid #E6CB86;background:radial-gradient(circle at 76% 30%,var(--tint) 0 12%,rgba(0,0,0,0) 13%),
  radial-gradient(ellipse 80% 42% at 28% 100%,#BDE8A8 0 60%,rgba(0,0,0,0) 61%),radial-gradient(ellipse 90% 45% at 82% 106%,#9ED98C 0 60%,rgba(0,0,0,0) 61%),
  linear-gradient(#DDF0FF,#FFF8EC)}
/* 액자: 금빛 두 겹 테 + 매트 + 부드러운 위 조명 + 명패(제목만) */
.m3-frame{backface-visibility:hidden;padding:7px;border:0;border-radius:1px;cursor:pointer;background:linear-gradient(135deg,#E6CB86,#C9A552 38%,#8E6B2A 62%,#E6CB86);
  box-shadow:inset 0 0 0 2px rgba(255,241,200,.55),0 18px 26px -18px rgba(74,52,65,.55)}
.m3-frame::before{content:'';position:absolute;left:-45%;right:-45%;top:-85%;bottom:88%;pointer-events:none;
  background:radial-gradient(ellipse 45% 70% at 50% 100%,rgba(255,246,214,.75),rgba(255,246,214,0) 70%)}
.m3-frame::after{content:attr(data-title);position:absolute;left:50%;top:calc(100% + 10px);transform:translateX(-50%);max-width:150%;padding:3px 10px;border-radius:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:linear-gradient(135deg,#F1E2B6,#D8BC72 55%,#C9A24A);color:#2B2007;font:600 12px/1.3 var(--mc-serif,'Noto Serif KR',serif)}
.m3-frame img,.m3-frame video{display:block;width:100%;height:100%;box-sizing:border-box;padding:9px;object-fit:contain;background:#FBF8F1;box-shadow:inset 0 0 0 1px rgba(142,107,42,.45),inset 0 6px 10px -6px rgba(0,0,0,.2);pointer-events:none}
.m3-frame.near{box-shadow:0 0 0 3px rgba(255,248,230,.95),0 0 50px 8px rgba(255,226,160,.6)}
.m3-frame:focus-visible,.m3-ped-art:focus-visible{outline:4px solid #6E3550;outline-offset:6px}
/* 진열대 안 입체 */
.m3-ped-art{padding:0;border:0;background:none;cursor:pointer}
.bb-z{display:block}
.bb-art{display:grid;place-items:end center}
.bb-art img{max-width:100%;max-height:100%}
.m3-ped-art img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 8px 8px rgba(74,52,65,.28));pointer-events:none}
.m3-ped-art.near img{filter:drop-shadow(0 0 14px rgba(255,226,160,.95))}
.m3-blob{width:52px;height:60px;margin-bottom:6px;border-radius:48% 52% 40% 60% / 55% 45% 55% 45%;background:radial-gradient(circle at 35% 30%,#FFFFFF,var(--tint) 70%)}
/* 동상 · 화분(카메라를 향해 도는 판) */
.m3-statue{pointer-events:none}
.bb-st{display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.st-hero{display:grid;place-items:center;margin-bottom:-6px;filter:drop-shadow(0 10px 10px rgba(74,52,65,.25))}
.st-cyl{position:relative;width:50px;height:90px;border-radius:0 0 50% 50% / 0 0 10px 10px;background:linear-gradient(90deg,#E4DDD0,#FFFFFF 35%,#F2ECE2 62%,#D8D0C2)}
.st-cyl::before{content:'';position:absolute;left:0;right:0;top:-8px;height:16px;border-radius:50%;background:radial-gradient(ellipse at 50% 45%,#FFFFFF,#EDE6DA)}
.st-cyl.big{width:140px;height:90px;display:grid;place-items:center;border-radius:0 0 50% 50% / 0 0 14px 14px;
  background:linear-gradient(90deg,#E4DDD0,#FFFFFF 35%,#F2ECE2 62%,#D8D0C2);box-shadow:inset 0 -8px 0 #E2D8C6,inset 0 6px 0 -2px #C9A24A}
.st-cyl.big::before{top:-10px;height:20px}
.st-cyl.big span{margin-top:6px;padding:3px 7px;border-radius:2px;background:linear-gradient(135deg,#F1E2B6,#D8BC72 55%,#B8913A);color:#2B2007;font:600 8px/1.2 var(--mc-serif,'Noto Serif KR',serif);max-width:110px;text-align:center;white-space:nowrap}
.st-mini{position:relative;z-index:1;max-width:62px;max-height:58px;margin-bottom:-2px;object-fit:contain;filter:grayscale(1) sepia(.2) brightness(1.12) contrast(.92) drop-shadow(0 4px 4px rgba(74,52,65,.25))}
.st-pot{position:relative;width:46px;height:44px;margin-bottom:0;border-radius:4px 4px 12px 12px;background:linear-gradient(90deg,#E9C9A8,#F7E3CE 40%,#DDB692)}
.st-pot::before{content:'';position:absolute;left:-22px;right:-22px;bottom:40px;height:80px;border-radius:50% 50% 40% 40%;
  background:radial-gradient(circle at 30% 60%,#8FD18A 0 22%,rgba(0,0,0,0) 23%),radial-gradient(circle at 70% 55%,#7CC47A 0 24%,rgba(0,0,0,0) 25%),
  radial-gradient(circle at 50% 30%,#A5DD9C 0 26%,rgba(0,0,0,0) 27%),radial-gradient(circle at 50% 70%,#6DB36B 0 22%,rgba(0,0,0,0) 23%)}

/* 계기판(떠 있는 유리 섬) */
.m3-hud{z-index:8}
.m3-where{position:absolute;top:14px;left:50%;transform:translateX(-50%);margin:0;max-width:calc(100% - 260px);padding:10px 18px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  background:rgba(255,251,247,.86);box-shadow:0 0 0 1px rgba(255,255,255,.7),0 12px 30px -18px rgba(74,52,65,.5);font:700 15px/1 var(--font-sans);color:#6E3550;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.m3-exit{position:absolute;top:14px;left:14px;display:inline-flex;align-items:center;gap:4px;min-height:46px;padding:8px 18px 8px 12px;border:1.5px solid #C9A24A;border-radius:999px;cursor:pointer;
  background:#FFF9EE;color:#4A3526;font:700 16px/1 var(--font-sans);box-shadow:0 3px 0 #D9C08A,0 8px 16px -10px rgba(74,53,38,.45);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.m3-exit svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.m3-prompt{position:absolute;left:50%;top:66px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;max-width:min(420px,calc(100% - 540px));min-width:0;padding:10px 16px;border:0;border-radius:18px;cursor:pointer;text-align:left;
  background:linear-gradient(135deg,#EFD9A2,#CFAE5E 55%,#B08D3E);box-shadow:0 16px 36px -20px rgba(74,52,65,.7)}
.m3-prompt span{min-width:0;display:grid}
.m3-prompt b{font:700 16px/1.25 var(--font-sans);color:#2B2007;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m3-prompt small{font:500 12px/1.3 var(--font-sans);color:#3B2C0B}
.m3-prompt kbd{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:rgba(253,251,247,.85);font:700 12px/1 var(--font-sans);color:#2B2007}
.m3-keys{position:absolute;left:14px;top:70px;margin:0;max-width:360px;display:flex;flex-wrap:wrap;gap:2px 0;pointer-events:none;font:600 12px/1.6 var(--font-sans);color:#6E3550;
  padding:8px 12px;border-radius:14px;background:rgba(255,251,247,.72)}
.m3-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.m3s :focus-visible{outline:2px solid #6E3550;outline-offset:3px}
/* 큰 방 버튼 줄: 미니맵 왼쪽, 넘치면 줄 안에서만 가로로 밀림(화면은 넘치지 않음) */
.m3-bar{position:absolute;left:14px;right:192px;bottom:14px;display:flex;gap:8px;padding:6px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;
  border-radius:999px;background:rgba(255,251,247,.72);box-shadow:0 0 0 1px rgba(201,162,74,.35),0 16px 36px -20px rgba(74,52,65,.45);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);touch-action:pan-x}
/* HUD 버튼(§17-13 H): 크림 알약 + 얇은 금테, 누르면 2~3px 내려앉고 그림자가 줄어든다. 세상은 고전 · 밝게 그대로 */
.m3-bar{padding:6px 6px 9px}
.m3-bar button{flex:none;min-height:56px;min-width:88px;padding:10px 22px;border:1.5px solid #C9A24A;border-radius:999px;cursor:pointer;background:#FFF9EE;color:#4A3526;
  font:700 17px/1.2 var(--font-sans);white-space:nowrap;box-shadow:0 3px 0 #D9C08A,0 8px 14px -10px rgba(74,53,38,.45);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.m3-bar button[aria-current]{background:linear-gradient(#F6E7BF,#EBD39A);border-color:#B08A34;color:#3A2A12}
.m3-bar button:hover,.m3-exit:hover{transform:translateY(-1px)}
.m3-bar button:active,.m3-exit:active{transform:translateY(3px);box-shadow:0 0 0 #D9C08A,0 2px 6px -4px rgba(74,53,38,.4);transition-duration:.05s}
@media (max-width:900px){.m3-keys:not(.touch){display:none}.m3-keys.touch{top:66px;max-width:calc(100% - 28px);font-size:11px;padding:5px 10px}.m3-prompt{max-width:calc(100% - 32px)}}
@media (max-width:600px){
  .m3-where{left:auto;right:14px;transform:none;max-width:calc(100% - 150px);font-size:14px}
  .m3-bar{right:140px;left:8px;bottom:10px;padding:4px;gap:6px}
  .m3-bar button{min-height:52px;min-width:76px;padding:8px 14px;font-size:16px}
  }
/* 걸리는 장면: 자리는 비워 두었다가 걸리면 나타난다(opacity만) */
.m3-frame.pending,.m3-ped-art.pending{opacity:0}
.m3-frame.appear,.m3-ped-art.appear{animation:m3-appear .6s ease-out}
@keyframes m3-appear{from{opacity:0}to{opacity:1}}
/* 아이 캐릭터: 화면 아래 가운데, 방 버튼 줄 위(장식) */
.m3-keys span{white-space:pre}
.m3-me{position:absolute;left:50%;bottom:86px;z-index:7;width:110px;margin-left:-55px;pointer-events:none;display:grid;justify-items:center}
.me-body{position:relative;transform-origin:50% 100%;animation:m3-breathe 3.2s ease-in-out infinite}
.me-shadow{width:70px;height:12px;margin-top:-10px;border-radius:50%;background:radial-gradient(ellipse,rgba(74,52,65,.28),rgba(74,52,65,0) 70%)}
.m3-me.walking .me-body{animation:m3-waddle .46s ease-in-out infinite}
.m3-me.jumping .me-body{animation:m3-hop .5s cubic-bezier(.3,1.4,.5,1)}
.m3-me.entering{animation:m3-walkin 1.2s ease-out}
.me-carry{position:absolute;left:50%;bottom:86px;z-index:1;width:64px;height:52px;margin-left:-32px;padding:4px;border-radius:2px;background:linear-gradient(135deg,#E6CB86,#C9A552 45%,#8E6B2A);
  box-shadow:0 6px 10px -6px rgba(43,26,46,.5);transition:transform .42s cubic-bezier(.5,0,.75,0),opacity .42s}
.me-carry img{display:block;width:100%;height:100%;object-fit:contain;background:#FBF8F1}
.me-carry.give{transform:translateY(-120px) scale(.4);opacity:0}
@keyframes m3-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.02,.975)}}
@keyframes m3-waddle{0%,100%{transform:translateY(0) rotate(-5deg)}25%{transform:translateY(-7px) rotate(0)}50%{transform:translateY(0) rotate(5deg)}75%{transform:translateY(-7px) rotate(0)}}
@keyframes m3-hop{0%{transform:translateY(0) scale(1.06,.92)}40%{transform:translateY(-34px) scale(.96,1.05)}80%{transform:translateY(0) scale(1.05,.94)}100%{transform:translateY(0) scale(1)}}
@keyframes m3-walkin{from{transform:translateY(-70px) scale(.55);opacity:0}30%{opacity:1}to{transform:none;opacity:1}}
/* 금빛 반짝 */
.m3-spark{position:absolute;left:50%;top:44%;z-index:9;width:0;height:0;pointer-events:none}
.m3-spark i{position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:3px;transform:rotate(var(--a)) translateY(0) rotate(45deg) scale(.2);opacity:0;
  background:radial-gradient(circle,#FFF6D0,#E6CB86 55%,#C9A552);box-shadow:0 0 12px 3px rgba(255,226,160,.8);animation:m3-spark .9s ease-out forwards}
.m3-spark i:nth-child(even){animation-delay:.08s;width:10px;height:10px}
@keyframes m3-spark{0%{opacity:0;transform:rotate(var(--a)) translateY(0) rotate(45deg) scale(.2)}25%{opacity:1}100%{opacity:0;transform:rotate(var(--a)) translateY(-150px) rotate(45deg) scale(1)}}
@media (max-width:600px){.m3-me{left:56%;bottom:76px;width:90px;margin-left:-45px}.me-carry{bottom:70px}}
@media (prefers-reduced-motion:reduce){.m3s *{transition:none!important;animation:none!important}.m3-bar button:hover,.m3-exit:hover{transform:none}}

/* ===== D52(§17-18 A) 압도적인 유럽 미술관 — 붉은 비단 홀 · 초록/붉은 방 · 금빛 코니스 · 코퍼 볼트 · 천창 빛(밝게, 가장자리 어둠 없음) ===== */
.pl-silk,.pl-wall.pl-red,.pl-wall.pl-green{--base1:#9C3236;--base2:#8E2A2E;--base3:#7C2327;
  background:
    linear-gradient(to bottom,#F6EACB 0 14px,#C9A24A 14px 20px,#FFF3D6 20px 34px,#C9A24A 34px 38px,rgba(0,0,0,0) 38px),
    linear-gradient(to top,#EEE3CE 0 86px,#C9A24A 86px 91px,#F7EFDF 91px 96px,#C9A24A 96px 98px,rgba(0,0,0,0) 98px),
    radial-gradient(ellipse 9px 15px at 50% 50%,rgba(246,200,140,.22) 0 60%,rgba(0,0,0,0) 64%) 0 0/56px 64px,
    radial-gradient(circle at 50% 50%,rgba(246,200,140,.14) 0 3px,rgba(0,0,0,0) 4px) 28px 32px/56px 64px,
    linear-gradient(var(--base1),var(--base2) 45%,var(--base3))}
.pl-wall.pl-green{--base1:#386A52;--base2:#2F5A45;--base3:#264B39}
.pl-far{box-shadow:inset 0 0 0 40px rgba(0,0,0,0)}
.pl-silk.pl-lintel,.pl-wall.pl-lintel.pl-red,.pl-wall.pl-lintel.pl-green{
  background:
    radial-gradient(circle at 50% 100%,rgba(0,0,0,0) 0 var(--r,100px),#C9A24A var(--r,100px) calc(var(--r,100px) + 5px),#F6EACB calc(var(--r,100px) + 5px) calc(var(--r,100px) + 14px),#C9A24A calc(var(--r,100px) + 14px) calc(var(--r,100px) + 17px),rgba(0,0,0,0) calc(var(--r,100px) + 17px)),
    linear-gradient(to bottom,#F6EACB 0 14px,#C9A24A 14px 20px,#FFF3D6 20px 34px,#C9A24A 34px 38px,rgba(0,0,0,0) 38px),
    radial-gradient(ellipse 9px 15px at 50% 50%,rgba(246,200,140,.22) 0 60%,rgba(0,0,0,0) 64%) 0 0/56px 64px,
    linear-gradient(var(--base1,#9C3236),var(--base2,#8E2A2E))}
.pl-entry.pl-silk{background:
    linear-gradient(to bottom,#FFF6DF,#DDF0FF 45%,#EAF6E2) 50% 100%/340px 480px no-repeat,
    linear-gradient(#C9A24A,#C9A24A) 50% 100%/370px 498px no-repeat,
    radial-gradient(ellipse 9px 15px at 50% 50%,rgba(246,200,140,.22) 0 60%,rgba(0,0,0,0) 64%) 0 0/56px 64px,
    linear-gradient(#9C3236,#8E2A2E 45%,#7C2327)}
/* 원통 볼트: 크림 격자(코퍼) + 금선, 꼭대기 띠 = 천창(하늘빛 · 흰 창살) */
.pl-vault{background:
    radial-gradient(circle at 50% 50%,rgba(201,162,74,.5) 0 5px,rgba(0,0,0,0) 6px) 60px 60px/120px 120px,
    repeating-linear-gradient(90deg,#C9A24A 0 5px,#EFE1C0 5px 12px,rgba(0,0,0,0) 12px 120px),
    repeating-linear-gradient(0deg,#C9A24A 0 5px,#EFE1C0 5px 12px,rgba(0,0,0,0) 12px 120px),
    radial-gradient(ellipse at 50% 50%,#FFFDF7,#F4E9D2);box-shadow:none}
.pl-vault.pl-sky{background:
    repeating-linear-gradient(0deg,rgba(255,255,255,.95) 0 8px,rgba(0,0,0,0) 8px 150px),
    linear-gradient(90deg,#C9A24A 0 6px,rgba(0,0,0,0) 6px calc(100% - 6px),#C9A24A calc(100% - 6px)),
    linear-gradient(90deg,rgba(255,255,255,.95) 0 3px,rgba(0,0,0,0) 3px) 50% 0/50% 100% no-repeat,
    linear-gradient(90deg,#D8EEFF,#F2FAFF 50%,#D8EEFF)}
/* 대계단 · 난간 */
.pl-step{background:linear-gradient(to bottom,#FFFFFF 0 6px,#F4EEE4 6px);box-shadow:inset 0 -2px 0 #E4D9C6}
.pl-riser{background:linear-gradient(#E9E0CF,#DDD2BE)}
.pl-balustrade{background:linear-gradient(to bottom,#C9A24A 0 6px,#F6EFE2 6px 18px,#E9E0CF 18px);box-shadow:inset 0 -10px 0 #DDD2BE}
.pl-balustrade.pl-top{background:#F6F0E4;box-shadow:inset 0 0 0 4px #C9A24A}
.pl-landing{background:radial-gradient(circle at 50% 48%,#E9DCC2 0 120px,#FFFFFF 121px 134px,#C9A24A 135px 140px,rgba(0,0,0,0) 141px),
  repeating-conic-gradient(#F6F1E8 0 25%,#E7E4DF 0 50%) 0 0/200px 200px}
.pl-hall.pl-floor{background:radial-gradient(ellipse 40% 26% at 50% 50%,rgba(255,244,205,.75),rgba(255,244,205,0) 70%) 0 0/100% 600px repeat-y,
  linear-gradient(90deg,rgba(0,0,0,0) 0 calc(50% - 160px),rgba(160,73,107,.08) calc(50% - 160px) calc(50% + 160px),rgba(0,0,0,0) calc(50% + 160px)),
  repeating-conic-gradient(#F7F2E9 0 25%,#E6E2DB 0 50%) 0 0/200px 200px}
/* 쌍기둥(코린트식 느낌): 세로 홈 · 금빛 머리 · 받침 */
.pl-col.pl-pair{background:
    linear-gradient(to bottom,#C9A24A 0 10px,#F3E3B8 10px 44px,#C9A24A 44px 50px,rgba(0,0,0,0) 50px calc(100% - 40px),#C9A24A calc(100% - 40px) calc(100% - 36px),#EFE6D6 calc(100% - 36px)),
    repeating-linear-gradient(90deg,rgba(120,90,40,.10) 0 3px,rgba(0,0,0,0) 3px 11px),
    linear-gradient(90deg,#E9E1D2,#FFFFFF 35%,#F2ECE2 60%,#DCD2C1)}
/* 벤치 */
.pl-bench.pl-seat{background:linear-gradient(90deg,#B84A48,#9C3236);border:4px solid #C9A24A;border-radius:6px}
.pl-bench.pl-front{background:linear-gradient(#8E2A2E,#6F2023);border-top:4px solid #C9A24A}
/* 방 제목판 · 문 이름판(둥근 · 금테) — 누르면 그 방으로 */
.pl-label.pl-door{cursor:pointer;border-radius:999px}
.pl-label.pl-title{border-radius:999px}
/* 아이 그림: 명패는 그림 오른쪽 아래, 둥근 모서리(D52 A) */
.m3-frame::after{left:calc(100% + 10px);top:auto;bottom:0;transform:none;max-width:180px;border-radius:10px;padding:4px 10px;white-space:normal;line-height:1.3;width:max-content}
.mural-mini{border-radius:14px;border-width:6px}
/* 앞 · 다음 작품(아래 가운데 큰 버튼, 캐릭터 양옆) · 친구 초대 */
.m3-tour{position:absolute;left:0;right:0;bottom:96px;height:0;z-index:9}
.m3-tour button{position:absolute;bottom:0;min-height:56px;padding:10px 20px;border:1.5px solid #C9A24A;border-radius:999px;cursor:pointer;background:#FFF9EE;color:#4A3526;white-space:nowrap;
  font:800 17px/1 var(--font-sans);box-shadow:0 3px 0 #D9C08A,0 10px 20px -12px rgba(74,53,38,.5);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.m3-tour .t-prev{right:calc(50% + 72px)}
.m3-tour .t-next{left:calc(50% + 72px);background:#A0496B;border-color:#6E2B47;color:#FFFBF7;box-shadow:0 3px 0 #6E2B47,0 10px 20px -12px rgba(74,53,38,.5)}
.m3-tour button:disabled{opacity:.55;cursor:default}
.m3-tour button:not(:disabled):active{transform:translateY(3px);box-shadow:0 0 0 #D9C08A}
.m3-invite{position:absolute;top:14px;right:14px;display:inline-flex;align-items:center;min-height:46px;padding:8px 18px;border:1.5px solid #C9A24A;border-radius:999px;background:#FFF9EE;color:#4A3526;
  font:700 15px/1 var(--font-sans);text-decoration:none;box-shadow:0 3px 0 #D9C08A}
.m3-invite:active{transform:translateY(3px);box-shadow:none}
@media (max-width:600px){
  .m3-where{left:50%;right:auto;transform:translateX(-50%);max-width:calc(100% - 250px)}
  .m3-tour{bottom:136px}
  .m3-tour button{min-height:50px;padding:8px 14px;font-size:15px}
  .m3-tour .t-prev{right:auto;left:8px}
  .m3-tour .t-next{left:auto;right:8px}
  .m3-me{left:50%;bottom:78px}
  .m3-invite{padding:8px 12px;font-size:14px}
  .m3-frame::after{max-width:120px}
}
@media (prefers-reduced-motion:reduce){.m3-tour button{transition:none}}
.pl-lobby.pl-floor{background:linear-gradient(135deg,rgba(255,255,255,.35),rgba(255,255,255,0) 40%),repeating-conic-gradient(#F6F1E8 0 25%,#E7E4DF 0 50%) 0 0/200px 200px}

/* 액자 2배 그리기(FR_K) — 금테 · 매트 · 명패 크기도 2배 단위 */
.m3-frame{padding:14px;box-shadow:inset 0 0 0 4px rgba(255,241,200,.55),0 36px 52px -36px rgba(74,52,65,.55)}
.m3-frame img,.m3-frame video{padding:18px;backface-visibility:hidden;box-shadow:inset 0 0 0 2px rgba(142,107,42,.45),inset 0 12px 20px -12px rgba(0,0,0,.2)}
.m3-frame::after{left:calc(100% + 20px);font-size:24px;padding:8px 20px;border-radius:20px;max-width:360px}
.m3-frame.near{box-shadow:0 0 0 6px rgba(255,248,230,.95),0 0 100px 16px rgba(255,226,160,.6)}
.m3-frame:focus-visible{outline:8px solid #6E3550;outline-offset:12px}
.pl-step{background:linear-gradient(90deg,rgba(0,0,0,0) calc(50% - 150px),#A83A3D calc(50% - 150px) calc(50% - 140px),#9C3236 calc(50% - 140px) calc(50% + 140px),#A83A3D calc(50% + 140px) calc(50% + 150px),rgba(0,0,0,0) calc(50% + 150px)),
  linear-gradient(to bottom,#FFFFFF 0 6px,#F4EEE4 6px);box-shadow:inset 0 -2px 0 #E4D9C6}
.pl-riser{background:linear-gradient(90deg,rgba(0,0,0,0) calc(50% - 150px),#7E2428 calc(50% - 150px) calc(50% + 150px),rgba(0,0,0,0) calc(50% + 150px)),linear-gradient(#E9E0CF,#DDD2BE)}
@media (max-width:600px){.m3-frame::after{max-width:240px}}
</style>
