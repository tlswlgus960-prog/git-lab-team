// 아이 미술관 배치(D40 → D45 → D52, SD_02 §17-13 · §17-18 A) — 순수 함수. 화면(Scene.vue)은 이 결과를 CSS 3D 면으로 세우기만 한다.
// 좌표: 미터. x = 오른쪽 +, z = 입구에서 안쪽 +, y = 홀 바닥에서 높이(입구 아래층은 음수). CSS는 1m = 100px, 눈높이 EYE가 화면 가운데.
// 평면도(D52, 실제 도면 참고 — 다뤼 계단 · 그랑드 갤러리 · 앙필라드 · 덜위치): 정문(z=0) → 대계단 12단 → 층계참(캐릭터 동상 약 3m)
//   → 가운데 홀(폭 12m · 원통 볼트 꼭대기 14m · 천창 띠 · 6m마다 쌍기둥 칸 · 길이 max(40m, 방 수)) → 끝벽 큰 벽화.
//   방(8×8m, 볼트 꼭대기 8m)은 홀 양옆에 번갈아(1 왼쪽 · 2 오른쪽 …), 한쪽 방들은 방 사이 문이 한 축에 줄지은 앙필라드.
// 방 = 나이 구역(최소 2 · 최대 8, 넘치면 오래된 구역을 마지막 방에 묶음), 나이 미정은 1번 방. 방문자는 "전시실 N"만.
import { m3 } from './copy';

// ---------- 입력(정규화된 전시) ----------
export type ItemKind = 'animated' | 'relief' | 'frame' | 'sculpture';
export interface MuseumItem {
  id: string;
  kind: ItemKind;
  title: string | null;
  /** 벽 · 진열대에 보일 멈춘 그림 */
  imageUrl: string | null;
  auxUrl?: string | null;
  /** 움직이는 그림(액자 안 재생 · 크게 보기) */
  videoUrl?: string | null;
  caption?: string | null;
  /** (D45) '만들기' 표시 — 서버 칸은 아직 없음(이제민 결정 뒤). true면 받침대로 간다 */
  making?: boolean;
}
export interface MuseumGroup {
  label: string;
  /** 나이 구역(가족만). null = 나이 미정 → 1번 방. 방문자는 싣지 않는다 */
  age?: number | null;
  items: MuseumItem[];
}
export interface MuseumInput {
  childAlias: string;
  character?: string | null;
  color?: string | null;
  museumStyle?: string | null;
  visitor: boolean;
  groups: MuseumGroup[];
  /** 방과 상관없이 가운데 홀 받침대에 바로 놓을 만들기 작품(견본 미술관 D48 등) — 방 진열대보다 앞 */
  hallMaking?: MuseumItem[];
}

// ---------- 출력 ----------
export interface Vec { x: number; z: number }
export interface Pose { x: number; z: number; yaw: number; /** 도착 때 고개(위 +). 없으면 0 */ pitch?: number }
export interface Rect { x0: number; x1: number; z0: number; z1: number }
/** 장식 면(바닥 · 벽 · 천장 · 기둥 · 글자판). w · h · 위치는 미터, 회전은 도 */
export interface Plane { key: string; cls: string; x: number; y: number; z: number; w: number; h: number; ry: number; rx: number; /** 볼트 띠 기울기 */ rz?: number; text?: string }
export interface FrameSpot { key: string; item: MuseumItem; room: number; x: number; y: number; z: number; ry: number; w: number; h: number; normal: Vec; pose: Pose }
export interface PedestalSpot { key: string; room: number; x: number; z: number; item: MuseumItem | null; pose: Pose; planes: Plane[] }
export interface StatueSpot { key: string; room: number; x: number; z: number; kind: 'character' | 'art' | 'plant'; item: MuseumItem | null }
/** (D45) 가운데 홀 대리석 받침대 — 만들기 작품(비면 점선 + 안내) */
export interface PlinthSpot { key: string; index: number; side: -1 | 1; x: number; z: number; item: MuseumItem | null; pose: Pose; planes: Plane[] }
export interface MuralSpot { key: string; x: number; y: number; z: number; ry: number; w: number; h: number; big: boolean; seed: number }
export interface Room {
  index: number; no: number; label: string; side: -1 | 1; rect: Rect; center: Vec;
  door: { z: number; hall: Vec; inside: Vec }; entry: Pose; count: number; hidden: number; tone: 'green' | 'red';
  frames: FrameSpot[]; pedestal: PedestalSpot; statues: StatueSpot[];
}
export interface BenchSpot { key: string; x: number; z: number; side: -1 | 1 }
/** 앞 · 다음 작품 차례 한 칸 */
export interface TourStop { key: string; pose: Pose; x: number; z: number; title: string | null }
export interface MuseumLayout {
  alias: string; visitor: boolean; color: string;
  rooms: Room[]; frames: FrameSpot[]; pedestals: PedestalSpot[]; plinths: PlinthSpot[]; plinthHidden: number; statues: StatueSpot[]; murals: MuralSpot[];
  benches: BenchSpot[]; planes: Plane[];
  lobby: Rect; hall: Rect; walkable: Rect[]; blockers: Rect[]; bounds: Rect;
  start: Pose; hallEntry: Pose; zEnd: number; tour: TourStop[];
}

// ---------- 치수(D52) ----------
export const EYE = 1.55;
export const HALL_HALF = 6; // 홀 폭 12m
export const WALL_H = 8; // 홀 벽(볼트 시작)
export const HALL_H = 14; // 홀 볼트 꼭대기
export const ROOM = 8;
export const ROOM_WALL = 4; // 방 벽(볼트 시작)
export const ROOM_H = 8; // 방 볼트 꼭대기
export const BAY = 6; // 쌍기둥 칸
export const MIN_HALL_LEN = 40;
// 대계단: 폭 8m · 12단(단 높이 0.17 · 너비 0.5) — 입구 아래층에서 층계참으로
export const STEPS = 12;
export const RISE = 0.17;
export const TREAD = 0.5;
export const STAIR_HALF = 4;
export const STAIR_Z0 = 3;
export const STAIR_Z1 = STAIR_Z0 + STEPS * TREAD;
export const STAIR_H = STEPS * RISE;
export const LOW = -STAIR_H; // 입구 아래층 높이
export const HALL_Z0 = 14; // 층계참 끝 = 홀 시작
export const LOBBY_D = HALL_Z0;
export const LOBBY_STATUE_X = 0;
export const LOBBY_STATUE_Z = 11.6; // 층계참 가운데
export const DOOR_W = 2.4;
export const DOOR_H = 2.8;
export const ARCH_TOP = DOOR_H + DOOR_W / 2; // 홀 → 방 문 아치 4m
export const ED_W = 2.0; // 앙필라드 문
export const ED_H = 2.6;
export const MIN_PLINTHS = 2;
export const ARRIVE_PITCH = 6;
export const MAX_PLINTHS = 12;
export const PLINTH_H = 1;
export const MIN_ROOMS = 2;
export const MAX_ROOMS = 8;
const MARGIN = 0.4;
const FRAME_W = 1.1;
const FRAME_H = 0.9;
/** 아이 그림 중심 높이 1.22m(가드너 미술관 · 아이 눈높이) */
export const FRAME_Y = 1.22;
const VIEW_D = 3.0; // 액자 앞 서는 거리(가까움 3.2m 안) — 그림이 화면을 다 덮지 않게
/** 1.22m 그림을 정면으로(눈 1.55m에서 살짝 내려 봄) */
const FRAME_PITCH = -6;

/** 캐릭터 색 → 벽화 물감(연하게). 목록 밖이면 해바라기 */
export const TINT: Record<string, string> = {
  sunflower: '#FFC93C', peach: '#FF9E80', sky: '#6EC6FF', leaf: '#7ED67A', lavender: '#B89DF6', cloud: '#C8CBDA',
};

const r2 = (n: number) => Math.round(n * 1000) / 1000;
/** 바라보는 방향(dx, dz)의 yaw(도). 앞 = (−sin yaw, cos yaw) */
export const yawOf = (dx: number, dz: number) => r2((Math.atan2(-dx, dz) * 180) / Math.PI);

/** 면 → CSS transform(1m = 100px, 홀 바닥 눈높이가 원점) */
export function planeTf(p: { x: number; y: number; z: number; ry?: number; rx?: number; rz?: number }): string {
  let s = `translate3d(${r2(p.x * 100)}px,${r2((EYE - p.y) * 100)}px,${r2(-p.z * 100)}px)`;
  if (p.ry) s += ` rotateY(${p.ry}deg)`;
  if (p.rz) s += ` rotateZ(${p.rz}deg)`;
  if (p.rx) s += ` rotateX(${p.rx}deg)`;
  return s;
}
export function planeStyle(p: { x: number; y: number; z: number; w: number; h: number; ry?: number; rx?: number; rz?: number }): Record<string, string> {
  const w = r2(p.w * 100); const h = r2(p.h * 100);
  return { width: `${w}px`, height: `${h}px`, margin: `${-h / 2}px 0 0 ${-w / 2}px`, transform: planeTf(p) };
}
/** 바닥 높이(카메라): 입구 아래층 → 계단 → 층계참 · 홀 */
export function floorAt(z: number): number {
  if (z <= STAIR_Z0) return LOW;
  if (z >= STAIR_Z1) return 0;
  return LOW + ((z - STAIR_Z0) / (STAIR_Z1 - STAIR_Z0)) * STAIR_H;
}

// ---------- 방 나누기 ----------
interface RoomSeed { label: string; items: MuseumItem[] }
function roomSeeds(input: MuseumInput): RoomSeed[] {
  let groups = input.groups.filter((g) => g.items.length);
  // 나이 미정은 1번 방(§17-13 B) — 받은 순서는 그대로 두고 앞으로만 옮긴다
  const none = groups.filter((g) => g.age === null);
  if (none.length) groups = [...none, ...groups.filter((g) => g.age !== null)];
  let seeds: RoomSeed[] = groups.map((g) => ({ label: g.label, items: [...g.items] }));
  if (groups.length > MAX_ROOMS) {
    const rest = groups.slice(MAX_ROOMS - 1);
    const ages = rest.map((g) => g.age).filter((a): a is number => typeof a === 'number');
    const label = ages.length === rest.length ? m3.mergedAges(Math.min(...ages), Math.max(...ages)) : m3.mergedMore(rest[0]!.label);
    seeds = [...seeds.slice(0, MAX_ROOMS - 1), { label, items: rest.flatMap((g) => g.items) }];
  }
  while (seeds.length < MIN_ROOMS) seeds.push({ label: m3.emptyRoom, items: [] });
  if (input.visitor) seeds = seeds.map((s, i) => ({ ...s, label: m3.visitRoom(i + 1) }));
  return seeds;
}

/** 만들기 작품: relief · sculpture · (곧) making 표시 */
export const isMaking = (it: MuseumItem) => it.making === true || it.kind === 'relief' || it.kind === 'sculpture';

// ---------- 배치 ----------
/** 원통 볼트를 평면 띠 n개로 — 축이 z(홀 · 로비)면 ry 0, 축이 x(방)면 ry 90. 가운데 띠는 천창 */
function vault(P: (key: string, cls: string, o: Omit<Plane, 'key' | 'cls' | 'ry' | 'rx'> & { ry?: number; rx?: number; rz?: number }) => void,
  key: string, cls: string, o: { cx: number; cz: number; spring: number; r: number; len: number; axis: 'z' | 'x'; n: number }) {
  const d = Math.PI / o.n; const chord = 2 * o.r * Math.sin(d / 2); const rm = o.r * Math.cos(d / 2);
  for (let i = 0; i < o.n; i++) {
    const m = d * (i + 0.5); const off = rm * Math.cos(m); const y = o.spring + rm * Math.sin(m);
    const crown = i === (o.n - 1) / 2;
    const at = o.axis === 'z' ? { x: o.cx + off, z: o.cz } : { x: o.cx, z: o.cz + off };
    P(`${key}-v${i}`, `${cls} vault${crown ? ' sky' : ''}`, { ...at, y, w: chord + 0.02, h: o.len, rx: -90, rz: r2(90 - (m * 180) / Math.PI), ry: o.axis === 'z' ? 0 : 90 });
  }
}

export function buildMuseumLayout(input: MuseumInput): MuseumLayout {
  const seeds = roomSeeds(input);
  const rows = Math.ceil(seeds.length / 2);
  const zRooms0 = HALL_Z0 + 2;
  const hallLen = Math.max(MIN_HALL_LEN, rows * ROOM + 8);
  const zEnd = HALL_Z0 + hallLen;
  const planes: Plane[] = [];
  const P = (key: string, cls: string, o: Omit<Plane, 'key' | 'cls' | 'ry' | 'rx'> & { ry?: number; rx?: number; rz?: number }) =>
    planes.push({ key, cls, ry: 0, rx: 0, ...o });
  const W = HALL_HALF * 2;

  // ---- 로비: 아래층(입구) · 대계단 12단 · 층계참(동상) — 다뤼 계단 구성만 ----
  P('floor-low', 'floor lobby', { x: 0, y: LOW, z: STAIR_Z0 / 2, w: W, h: STAIR_Z0, rx: 90 });
  for (let i = 0; i < STEPS; i++) {
    const z = STAIR_Z0 + i * TREAD;
    P(`st${i}-r`, 'riser', { x: 0, y: LOW + i * RISE + RISE / 2, z, w: STAIR_HALF * 2 - 0.04, h: RISE });
    P(`st${i}-t`, 'step', { x: 0, y: LOW + (i + 1) * RISE, z: z + TREAD / 2, w: STAIR_HALF * 2 - 0.04, h: TREAD, rx: 90 });
  }
  for (const side of [-1, 1] as const) { // 계단 옆 난간 벽(금빛 갓돌) · 앞면
    const sx = side * (STAIR_HALF + 0.03); const bh = STAIR_H + 1; // 계단 판과 겹치지 않게 살짝 밖으로(3D 정렬 깨짐 방지)
    P(`bal${side}`, 'balustrade', { x: sx, y: LOW + bh / 2, z: (STAIR_Z0 + STAIR_Z1) / 2, w: STAIR_Z1 - STAIR_Z0, h: bh, ry: -side * 90 });
    P(`bal${side}-f`, 'balustrade', { x: side * (STAIR_HALF + HALL_HALF) / 2, y: LOW + bh / 2, z: STAIR_Z0, w: HALL_HALF - STAIR_HALF - 0.1, h: bh });
    P(`bal${side}-top`, 'balustrade top', { x: side * (STAIR_HALF + HALL_HALF) / 2, y: 1, z: (STAIR_Z0 + STAIR_Z1) / 2, w: HALL_HALF - STAIR_HALF - 0.1, h: STAIR_Z1 - STAIR_Z0 - 0.04, rx: 90 });
    for (const cz of [STAIR_Z0 + 0.4, STAIR_Z1 - 0.4]) P(`lcol${side}-${cz}`, 'col', { x: side * (STAIR_HALF + 0.9), y: (1 + WALL_H) / 2, z: cz, w: 0.7, h: WALL_H - 1, ry: 0 });
  }
  P('floor-landing', 'floor landing', { x: 0, y: 0, z: (STAIR_Z1 + HALL_Z0) / 2, w: W, h: HALL_Z0 - STAIR_Z1, rx: 90 });
  P('floor-hall', 'floor hall', { x: 0, y: 0, z: (HALL_Z0 + zEnd) / 2, w: W, h: zEnd - HALL_Z0, rx: 90 });
  // 입구벽(정문) · 끝벽 — 볼트 반원까지 덮는 직사각형(모서리는 볼트 뒤에 숨는다)
  P('wall-entry', 'wall silk entry', { x: 0, y: (LOW + HALL_H) / 2, z: 0, w: W, h: HALL_H - LOW, ry: 180 });
  P('wall-end', 'wall silk', { x: 0, y: HALL_H / 2, z: zEnd, w: W, h: HALL_H });
  // 원통 볼트(꼭대기 14m) + 천창 띠 — 로비부터 끝벽까지 하나
  vault(P, 'hv', 'ceil', { cx: 0, cz: zEnd / 2, spring: WALL_H, r: HALL_HALF, len: zEnd, axis: 'z', n: 7 });

  const rooms: Room[] = [];
  const frames: FrameSpot[] = [];
  const pedestals: PedestalSpot[] = [];
  const statues: StatueSpot[] = [];
  const murals: MuralSpot[] = [];
  const walkable: Rect[] = [];
  const blockers: Rect[] = [];
  const extraMaking: MuseumItem[] = [...(input.hallMaking ?? [])];
  const doorZ: Record<number, number[]> = { [-1]: [], 1: [] };

  seeds.forEach((seed, index) => {
    const side: -1 | 1 = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const z0 = zRooms0 + row * ROOM; const z1 = z0 + ROOM; const zc = z0 + ROOM / 2;
    const xin = side * HALL_HALF; const xout = side * (HALL_HALF + ROOM); const xc = side * (HALL_HALF + ROOM / 2);
    const rect: Rect = { x0: Math.min(xin, xout), x1: Math.max(xin, xout), z0, z1 };
    const facingHall = -side * 90;
    const k = `r${index}`;
    const tone = row % 2 === (side < 0 ? 0 : 1) ? 'green' : 'red'; // 방 벽: 초록 · 붉은 번갈아(드레스덴)
    doorZ[side]!.push(zc);

    P(`${k}-floor`, 'floor room', { x: xc, y: 0, z: zc, w: ROOM, h: ROOM, rx: 90 });
    P(`${k}-far`, `wall room far ${tone}`, { x: xout, y: ROOM_H / 2, z: zc, w: ROOM, h: ROOM_H, ry: facingHall });
    P(`${k}-title`, 'label title', { x: side * (HALL_HALF + ROOM - 0.03), y: 3.2, z: zc, w: 3.4, h: 0.62, ry: facingHall, text: seed.label });
    vault(P, `${k}`, `ceil ${tone}`, { cx: xc, cz: zc, spring: ROOM_WALL, r: ROOM / 2, len: ROOM, axis: 'x', n: 5 });
    P(`${k}-label`, 'label door', { x: side * (HALL_HALF - 0.02), y: ARCH_TOP + 0.55, z: zc, w: 3, h: 0.55, ry: facingHall, text: seed.label });

    // 작품 나누기: 진열대 1(그 방 첫 만들기 작품) · 벽(먼 벽 3 · 앞뒤 벽 2~3 · 홀 쪽 벽 2)
    const solid = seed.items.find(isMaking) ?? null;
    extraMaking.push(...seed.items.filter((it) => isMaking(it) && it !== solid));
    const wallItems = seed.items.filter((it) => !isMaking(it));
    const mine = seeds.filter((_, i) => i % 2 === index % 2).length; // 같은 쪽 방 수
    const first = row === 0; const last = row === mine - 1;
    const slots: { x: number; z: number; ry: number; normal: Vec }[] = [];
    for (const d of [0, -2.5, 2.5]) slots.push({ x: side * (HALL_HALF + ROOM - 0.03), z: zc + d, ry: facingHall, normal: { x: -side, z: 0 } });
    for (const d of first ? [0, -2.4, 2.4] : [-2.4, 2.4]) slots.push({ x: xc + d, z: z0 + 0.03, ry: 180, normal: { x: 0, z: 1 } });
    for (const d of last ? [0, -2.4, 2.4] : [-2.4, 2.4]) slots.push({ x: xc + d, z: z1 - 0.03, ry: 0, normal: { x: 0, z: -1 } });
    for (const d of [-2.7, 2.7]) slots.push({ x: side * (HALL_HALF + 0.03), z: zc + d, ry: side * 90, normal: { x: side, z: 0 } });
    const hung = wallItems.slice(0, slots.length);
    const roomFrames: FrameSpot[] = hung.map((item, i) => {
      const s = slots[i]!;
      return { key: `${k}-f${i}`, item, room: index, x: s.x, y: FRAME_Y, z: s.z, ry: s.ry, w: FRAME_W, h: FRAME_H, normal: s.normal,
        pose: { x: r2(s.x + s.normal.x * VIEW_D), z: r2(s.z + s.normal.z * VIEW_D), yaw: yawOf(-s.normal.x, -s.normal.z), pitch: FRAME_PITCH } };
    });

    // 진열대(받침 + 유리 상자)
    const pp: Plane[] = [];
    const box = (pre: string, cls: string, half: number, yb: number, h: number, top: boolean) => {
      pp.push({ key: `${pre}-e`, cls, x: xc + half, y: yb + h / 2, z: zc, w: half * 2, h, ry: 90, rx: 0 });
      pp.push({ key: `${pre}-w`, cls, x: xc - half, y: yb + h / 2, z: zc, w: half * 2, h, ry: -90, rx: 0 });
      pp.push({ key: `${pre}-n`, cls, x: xc, y: yb + h / 2, z: zc - half, w: half * 2, h, ry: 0, rx: 0 });
      pp.push({ key: `${pre}-s`, cls, x: xc, y: yb + h / 2, z: zc + half, w: half * 2, h, ry: 180, rx: 0 });
      if (top) pp.push({ key: `${pre}-t`, cls: `${cls} top`, x: xc, y: yb + h, z: zc, w: half * 2, h: half * 2, ry: 0, rx: 90 });
    };
    box(`${k}-plinth`, 'plinth', 0.45, 0, 0.9, true);
    if (solid) box(`${k}-glass`, 'glass', 0.4, 0.9, 0.9, false);
    else pp.push({ key: `${k}-ped-note`, cls: 'note', x: xc - side * 0.46, y: 0.55, z: zc, w: 0.86, h: 0.5, ry: facingHall, rx: 0, text: m3.pedestalEmpty });
    const pedestal: PedestalSpot = { key: `${k}-ped`, room: index, x: xc, z: zc, item: solid, planes: pp,
      pose: { x: r2(xc - side * 1.7), z: zc, yaw: yawOf(side, 0) } };
    blockers.push({ x0: xc - 0.6, x1: xc + 0.6, z0: zc - 0.6, z1: zc + 0.6 });

    const pick = [seed.items[0] ?? null, seed.items[1] ?? null];
    const roomStatues: StatueSpot[] = [-1.9, 1.9].map((dz, i) => {
      const it = pick[i] && pick[i]!.imageUrl ? pick[i]! : null;
      return { key: `${k}-st${i}`, room: index, x: side * (HALL_HALF + 0.75), z: zc + dz, kind: it ? 'art' : 'plant', item: it };
    });
    for (const s of roomStatues) blockers.push({ x0: s.x - 0.35, x1: s.x + 0.35, z0: s.z - 0.35, z1: s.z + 0.35 });

    const door = { z: zc, hall: { x: side * (HALL_HALF - 1), z: zc }, inside: { x: side * (HALL_HALF + 1.2), z: zc } };
    rooms.push({
      index, no: index + 1, label: seed.label, side, rect, center: { x: xc, z: zc }, door, tone,
      entry: { x: side * (HALL_HALF + 0.3), z: zc, yaw: yawOf(side, 0), pitch: 2 },
      count: seed.items.length, hidden: wallItems.length - hung.length,
      frames: roomFrames, pedestal, statues: roomStatues,
    });
    frames.push(...roomFrames); pedestals.push(pedestal); statues.push(...roomStatues);
    walkable.push({ x0: rect.x0 + MARGIN, x1: rect.x1 - MARGIN, z0: z0 + MARGIN, z1: z1 - MARGIN });
    walkable.push({ x0: side * HALL_HALF - 0.8, x1: side * HALL_HALF + 0.8, z0: zc - DOOR_W / 2 + MARGIN, z1: zc + DOOR_W / 2 - MARGIN });
  });

  // ---- 홀 옆벽(붉은 비단) · 방 사이 벽(앙필라드 문) ----
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R'; const x = side * HALL_HALF; const ry = -side * 90;
    // 로비 옆벽은 세 조각: 입구 아래층(바닥부터) · 계단 옆(난간 위로만) · 층계참(홀 바닥부터) — 큰 한 장은 3D 정렬이 깨져 계단 위로 비친다
    P(`hw${s}-lobA`, 'wall silk', { x, y: (LOW + WALL_H) / 2, z: STAIR_Z0 / 2, w: STAIR_Z0, h: WALL_H - LOW, ry });
    P(`hw${s}-lobB`, 'wall silk', { x, y: (1 + WALL_H) / 2, z: (STAIR_Z0 + STAIR_Z1) / 2, w: STAIR_Z1 - STAIR_Z0, h: WALL_H - 1, ry });
    P(`hw${s}-lobC`, 'wall silk', { x, y: WALL_H / 2, z: (STAIR_Z1 + zRooms0) / 2, w: zRooms0 - STAIR_Z1, h: WALL_H, ry });
    for (let row = 0; row < rows; row++) {
      const z0 = zRooms0 + row * ROOM; const zc = z0 + ROOM / 2;
      const has = rooms.some((r) => r.side === side && Math.floor(r.index / 2) === row);
      if (!has) { P(`hw${s}-${row}`, 'wall silk', { x, y: WALL_H / 2, z: zc, w: ROOM, h: WALL_H, ry }); continue; }
      const seg = (ROOM - DOOR_W) / 2;
      P(`hw${s}-${row}a`, 'wall silk', { x, y: WALL_H / 2, z: z0 + seg / 2, w: seg, h: WALL_H, ry });
      P(`hw${s}-${row}b`, 'wall silk', { x, y: WALL_H / 2, z: zc + DOOR_W / 2 + seg / 2, w: seg, h: WALL_H, ry });
      P(`hw${s}-${row}c`, 'wall silk lintel', { x, y: (DOOR_H + WALL_H) / 2, z: zc, w: DOOR_W, h: WALL_H - DOOR_H, ry });
    }
    const zr = zRooms0 + rows * ROOM;
    P(`hw${s}-end`, 'wall silk', { x, y: WALL_H / 2, z: (zr + zEnd) / 2, w: zEnd - zr, h: WALL_H, ry });
    const mine = rooms.filter((r) => r.side === side);
    for (let b = 0; b <= mine.length; b++) {
      const z = zRooms0 + b * ROOM; const xc = side * (HALL_HALF + ROOM / 2);
      const tone = (mine[Math.min(b, mine.length - 1)]?.tone) ?? 'red';
      if (b === 0 || b === mine.length) { P(`rw${s}-${b}`, `wall room ${tone}`, { x: xc, y: ROOM_WALL / 2, z, w: ROOM, h: ROOM_WALL }); continue; }
      // 앙필라드: 방 사이 문이 한 축(방 가운데 x)에 줄지어 방 너머가 보인다
      const seg = (ROOM - ED_W) / 2; const xa = side * (HALL_HALF + seg / 2); const xb = side * (HALL_HALF + ROOM - seg / 2);
      P(`rw${s}-${b}a`, `wall room ${tone}`, { x: xa, y: ROOM_WALL / 2, z, w: seg, h: ROOM_WALL });
      P(`rw${s}-${b}b`, `wall room ${tone}`, { x: xb, y: ROOM_WALL / 2, z, w: seg, h: ROOM_WALL });
      P(`rw${s}-${b}c`, `wall room ${tone} lintel`, { x: xc, y: (ED_H + ROOM_WALL) / 2, z, w: ED_W, h: ROOM_WALL - ED_H });
      walkable.push({ x0: xc - ED_W / 2 + MARGIN, x1: xc + ED_W / 2 - MARGIN, z0: z - 0.8, z1: z + 0.8 });
    }
  }
  murals.push({ key: 'mu-end', x: 0, y: 4.2, z: zEnd - 0.02, ry: 0, w: 9, h: 5.2, big: true, seed: 0 });

  // ---- 칸(bay): 6m마다 쌍기둥, 칸마다 받침대 · 벤치 · 화분 · 파스텔 벽화 (빈 칸 없음) ----
  const benches: BenchSpot[] = [];
  const bays: { side: -1 | 1; z: number }[] = [];
  const nearDoor = (side: -1 | 1, z: number, gap: number) => doorZ[side]!.some((d) => Math.abs(d - z) < gap);
  for (let b = 0; b * BAY <= hallLen + 0.01; b++) {
    const z = HALL_Z0 + b * BAY;
    for (const side of [-1, 1] as const) {
      if (b > 0 && nearDoor(side, z, DOOR_W / 2 + 0.9)) continue;
      for (const dz of [-0.45, 0.45]) {
        if (z + dz <= HALL_Z0 - 0.5 || z + dz >= zEnd - 0.2) continue;
        P(`pc${side}-${b}-${dz}`, 'col pair', { x: side * (HALL_HALF - 0.28), y: WALL_H / 2, z: z + dz, w: 0.56, h: WALL_H, ry: -side * 90 });
      }
    }
    if (b * BAY + BAY <= hallLen + 0.01) for (const side of [-1, 1] as const) {
      let cz = z + BAY / 2;
      if (nearDoor(side, cz, 2.2)) cz = doorZ[side]!.some((d) => d > cz) ? z + 1.1 : z + BAY - 1.1;
      if (!nearDoor(side, cz, 2.0)) bays.push({ side, z: cz });
    }
  }
  bays.sort((a, c) => a.z - c.z || a.side - c.side);
  // 받침대: 만들기 작품 수(최소 2)만큼, 양옆 번갈아 · 홀 입구에서 보이게 안쪽 칸부터
  const nPl = Math.min(MAX_PLINTHS, bays.length, Math.max(MIN_PLINTHS, extraMaking.length));
  const order: number[] = [];
  const bySide = { [-1]: bays.map((b, i) => ({ b, i })).filter((x) => x.b.side < 0), 1: bays.map((b, i) => ({ b, i })).filter((x) => x.b.side > 0) };
  for (let i = 0; order.length < nPl && i < bays.length; i++) {
    const side = (i % 2 === 0 ? -1 : 1) as -1 | 1; const list = bySide[side]!; const j = Math.floor(i / 2) + 1;
    const pickB = list[j] ?? list[0]; if (pickB && !order.includes(pickB.i)) order.push(pickB.i);
  }
  for (let i = 0; order.length < nPl && i < bays.length; i++) if (!order.includes(i)) order.push(i);
  const plinths: PlinthSpot[] = order.map((bi, index) => {
    const sl = bays[bi]!; const item = extraMaking[index] ?? null; const x = sl.side * (HALL_HALF - 2.2); const z = sl.z; const k = `pl${index}`;
    const half = 0.35; const face = -sl.side * 90; const cls = item ? 'marble' : 'marble empty';
    const planes: Plane[] = [
      { key: `${k}-e`, cls, x: x + half, y: PLINTH_H / 2, z, w: half * 2, h: PLINTH_H, ry: 90, rx: 0 },
      { key: `${k}-w`, cls, x: x - half, y: PLINTH_H / 2, z, w: half * 2, h: PLINTH_H, ry: -90, rx: 0 },
      { key: `${k}-n`, cls, x, y: PLINTH_H / 2, z: z - half, w: half * 2, h: PLINTH_H, ry: 0, rx: 0 },
      { key: `${k}-s`, cls, x, y: PLINTH_H / 2, z: z + half, w: half * 2, h: PLINTH_H, ry: 180, rx: 0 },
      { key: `${k}-t`, cls: `${cls} top`, x, y: PLINTH_H, z, w: half * 2, h: half * 2, ry: 0, rx: 90 },
      { key: `${k}-pool`, cls: 'pool', x, y: 0.01, z, w: 2.2, h: 2.2, ry: 0, rx: 90 },
      item
        ? { key: `${k}-plaque`, cls: 'plaque', x: x - sl.side * (half + 0.01), y: 0.72, z, w: 0.6, h: 0.16, ry: face, rx: 0, text: item.title ?? m3.untitled }
        : { key: `${k}-note`, cls: 'note', x: x - sl.side * (half + 0.01), y: 0.55, z, w: 0.66, h: 0.42, ry: face, rx: 0, text: m3.plinthEmpty },
    ];
    blockers.push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
    return { key: k, index, side: sl.side, x, z, item, planes, pose: { x: r2(x - sl.side * 1.8), z, yaw: yawOf(sl.side, 0) } };
  });
  const plinthHidden = Math.max(0, extraMaking.length - plinths.length);
  // 나머지 칸: 벤치 · 화분 · 파스텔 벽화 차례로(아이 느낌 한 스푼)
  bays.forEach((sl, i) => {
    if (order.includes(i)) return;
    const kind = ['bench', 'plant', 'mural'][i % 3];
    const wx = sl.side * (HALL_HALF - 0.02);
    if (kind === 'mural' || kind === 'bench') murals.push({ key: `bm${i}`, x: wx, y: 3.1, z: sl.z, ry: -sl.side * 90, w: 2.2, h: 1.5, big: false, seed: i });
    if (kind === 'bench') {
      const x = sl.side * (HALL_HALF - 1.3);
      benches.push({ key: `bn${i}`, x, z: sl.z, side: sl.side });
      P(`bn${i}-seat`, 'bench seat', { x, y: 0.46, z: sl.z, w: 0.55, h: 2.0, rx: 90 });
      P(`bn${i}-front`, 'bench front', { x: x - sl.side * 0.27, y: 0.23, z: sl.z, w: 2.0, h: 0.46, ry: -sl.side * 90 });
      blockers.push({ x0: x - 0.45, x1: x + 0.45, z0: sl.z - 1.1, z1: sl.z + 1.1 });
    }
    if (kind === 'plant') { statues.push({ key: `bp${i}`, room: -2, x: sl.side * (HALL_HALF - 0.9), z: sl.z, kind: 'plant', item: null }); }
  });

  // 층계참 가운데 아이 캐릭터 동상(받침 포함 약 3m)
  statues.push({ key: 'lobby-statue', room: -1, x: LOBBY_STATUE_X, z: LOBBY_STATUE_Z, kind: 'character', item: null });
  blockers.push({ x0: LOBBY_STATUE_X - 1.0, x1: LOBBY_STATUE_X + 1.0, z0: LOBBY_STATUE_Z - 1.0, z1: LOBBY_STATUE_Z + 1.0 });

  const lobby: Rect = { x0: -HALL_HALF, x1: HALL_HALF, z0: 0, z1: HALL_Z0 };
  const hall: Rect = { x0: -HALL_HALF, x1: HALL_HALF, z0: HALL_Z0, z1: zEnd };
  walkable.unshift(
    { x0: -HALL_HALF + MARGIN, x1: HALL_HALF - MARGIN, z0: MARGIN, z1: STAIR_Z0 + 0.2 }, // 입구 아래층
    { x0: -STAIR_HALF + MARGIN, x1: STAIR_HALF - MARGIN, z0: STAIR_Z0 - 0.2, z1: STAIR_Z1 + 0.2 }, // 계단
    { x0: -HALL_HALF + MARGIN, x1: HALL_HALF - MARGIN, z0: STAIR_Z1, z1: zEnd - MARGIN }, // 층계참 · 홀
  );
  const L = {
    alias: input.childAlias, visitor: input.visitor, color: TINT[input.color ?? ''] ?? TINT.sunflower!,
    rooms, frames, pedestals, plinths, plinthHidden, statues, murals, benches, planes, lobby, hall, walkable, blockers,
    bounds: { x0: -(HALL_HALF + ROOM), x1: HALL_HALF + ROOM, z0: 0, z1: zEnd },
    start: { x: 0, z: 1.0, yaw: 0, pitch: 8 }, hallEntry: { x: 0, z: HALL_Z0 + 0.3, yaw: 0, pitch: ARRIVE_PITCH }, zEnd,
    tour: [] as TourStop[],
  };
  // 차례(앞 · 다음 작품): 방 순서 → 벽 순서 → 진열대, 그 뒤 홀 받침대
  for (const r of rooms) {
    for (const f of r.frames) L.tour.push({ key: f.key, pose: f.pose, x: f.x, z: f.z, title: f.item.title });
    if (r.pedestal.item) L.tour.push({ key: r.pedestal.key, pose: r.pedestal.pose, x: r.pedestal.x, z: r.pedestal.z, title: r.pedestal.item.title });
  }
  for (const p of plinths) if (p.item) L.tour.push({ key: p.key, pose: p.pose, x: p.x, z: p.z, title: p.item.title });
  return L;
}

// ---------- 움직임 도우미(순수) ----------
const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
export function canStand(L: Pick<MuseumLayout, 'walkable' | 'blockers'>, x: number, z: number): boolean {
  return L.walkable.some((r) => inRect(r, x, z)) && !L.blockers.some((r) => inRect(r, x, z));
}
/** 벽 충돌: 갈 수 있으면 가고, 막히면 축마다 미끄러진다 */
export function clampMove(L: Pick<MuseumLayout, 'walkable' | 'blockers'>, from: Vec, to: Vec): Vec {
  if (canStand(L, to.x, to.z)) return { x: to.x, z: to.z };
  if (canStand(L, to.x, from.z)) return { x: to.x, z: from.z };
  if (canStand(L, from.x, to.z)) return { x: from.x, z: to.z };
  return { x: from.x, z: from.z };
}
/** 지금 있는 곳: 방 번호(0부터) · 'hall' · 'lobby' */
export function areaOf(L: Pick<MuseumLayout, 'rooms' | 'lobby'>, p: Vec): number | 'hall' | 'lobby' {
  const r = L.rooms.find((x) => inRect(x.rect, p.x, p.z) && Math.abs(p.x) > HALL_HALF);
  if (r) return r.index;
  return p.z < L.lobby.z1 ? 'lobby' : 'hall';
}
/** 걸어갈 길: 방을 나설 때 · 들어갈 때 문을 지난다(마지막 점 = 목표) */
export function pathTo(L: Pick<MuseumLayout, 'rooms' | 'lobby'>, from: Vec, to: Vec): Vec[] {
  const a = areaOf(L, from); const b = areaOf(L, to);
  const out: Vec[] = [];
  if (typeof a === 'number' && a !== b) { const r = L.rooms[a]!; out.push(r.door.inside, r.door.hall); }
  if (typeof b === 'number' && a !== b) { const r = L.rooms[b]!; out.push(r.door.hall, r.door.inside); }
  out.push({ x: to.x, z: to.z });
  // 층계참 동상을 가로지르면 옆으로 돌아간다
  const res: Vec[] = []; let prev = from;
  for (const q of out) {
    const dx = q.x - prev.x; const dz = q.z - prev.z; const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((LOBBY_STATUE_X - prev.x) * dx + (LOBBY_STATUE_Z - prev.z) * dz) / len2)) : 0;
    const cx = prev.x + dx * t; const cz = prev.z + dz * t;
    if (t > 0 && t < 1 && Math.hypot(cx - LOBBY_STATUE_X, cz - LOBBY_STATUE_Z) < 1.4) {
      const sx = (prev.x + q.x) / 2 >= LOBBY_STATUE_X ? 1 : -1;
      res.push({ x: LOBBY_STATUE_X + sx * 2.6, z: LOBBY_STATUE_Z });
    }
    res.push(q); prev = q;
  }
  return res;
}

/** 화면 한 점 → 바닥 위 점(미터). sx · sy = 화면 가운데 기준 px, P = CSS perspective. 바닥을 안 보면 null */
export function screenToFloor(cam: { x: number; z: number; yaw: number; pitch: number }, sx: number, sy: number, P: number): Vec | null {
  const p = (cam.pitch * Math.PI) / 180; const y = (cam.yaw * Math.PI) / 180;
  // 카메라 공간 광선(CSS: y 아래 +, 앞 = −z) → Rx(−pitch) → Ry(yaw)
  const v0 = { x: sx, y: sy, z: -P };
  const v1 = { x: v0.x, y: Math.cos(-p) * v0.y - Math.sin(-p) * v0.z, z: Math.sin(-p) * v0.y + Math.cos(-p) * v0.z };
  const v2 = { x: Math.cos(y) * v1.x + Math.sin(y) * v1.z, y: v1.y, z: -Math.sin(y) * v1.x + Math.cos(y) * v1.z };
  if (v2.y <= 1e-6) return null;
  const t = (EYE * 100) / v2.y;
  return { x: cam.x + (v2.x * t) / 100, z: cam.z - (v2.z * t) / 100 };
}

/** (D45) 둘러보기 위아래 한계 ±25° */
export const PITCH_MAX = 25;
export const clampPitch = (deg: number) => Math.max(-PITCH_MAX, Math.min(PITCH_MAX, deg));
/** (D45) 화각 60~70°: 화면 긴 변 기준 65°가 되는 CSS perspective */
export const FOV_DEG = 65;
export const perspectiveFor = (w: number, h: number) => Math.max(w, h) / 2 / Math.tan(((FOV_DEG / 2) * Math.PI) / 180);

/** 가까운지(크게 보기 바로 열기 · E 알림): D41 hall3d와 같이 2.5m 안 · 바라봄 45° 안 */
export const NEAR_M = 3.2; // D52: 액자 앞 3m에 서므로 조금 넓힘
export const FACE_DEG = 45;
export function isNear(cam: Vec, obj: Vec): boolean { return Math.hypot(cam.x - obj.x, cam.z - obj.z) <= NEAR_M + 1e-6; }
/** 바라보는 쪽에서 가장 가까운 대상(없으면 null) */
export function nearestTarget<T extends Vec>(cam: Pose, list: T[]): T | null {
  const y = (cam.yaw * Math.PI) / 180; const fx = -Math.sin(y); const fz = Math.cos(y); const lim = Math.cos((FACE_DEG * Math.PI) / 180);
  let best: T | null = null; let bd = Infinity;
  for (const t of list) {
    const dx = t.x - cam.x; const dz = t.z - cam.z; const d = Math.hypot(dx, dz);
    if (d > NEAR_M || d < 1e-6 || (dx * fx + dz * fz) / d < lim) continue;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/** 대략의 3D 요소 수(D52 기준 ~600) — 면 + 액자 2 + 진열대 면 + 그림 + 동상 2 + 벽화 */
export function domEstimate(L: MuseumLayout): number {
  return L.planes.length + L.frames.length * 2 + L.pedestals.reduce((n, p) => n + p.planes.length + (p.item ? 2 : 0), 0)
    + L.plinths.reduce((n, p) => n + p.planes.length + 1 + (p.item ? 2 : 0), 0)
    + L.statues.length * 2 + L.murals.length + 30;
}
