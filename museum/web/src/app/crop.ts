// S2 작품 영역 자르기 계산(D32, SD_02 §5·C11, UC2 A10). 좌표는 모두 사진 원래 픽셀(방향 보정 뒤).
// 화면(CropBox)과 올리기(UploadView)가 같은 계산을 쓴다. 캔버스·DOM에 기대지 않아 단위 시험이 된다.

export interface Rect { x: number; y: number; w: number; h: number }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

export const MIN_SIDE = 48; // 사각형 한 변 하한 [추론] — 사진이 더 작으면 사진 크기
export const MAX_PIXELS = 16_000_000; // 모바일 브라우저 캔버스 한도 [추론] — 넘으면 비율 유지 축소
export const JPEG_QUALITY = 0.92;
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const full = (W: number, H: number): Rect => ({ x: 0, y: 0, w: W, h: H });
export const isFull = (r: Rect, W: number, H: number) => r.x <= 0 && r.y <= 0 && r.w >= W && r.h >= H;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** 핸들을 (dx, dy)만큼 끈 결과. 사진 밖으로 나가지 않고 한 변이 min보다 작아지지 않는다. */
export function drag(r: Rect, h: Handle, dx: number, dy: number, W: number, H: number, min = MIN_SIDE): Rect {
  const mw = Math.min(min, W), mh = Math.min(min, H);
  if (h === 'move') return { ...r, x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h) };
  let l = r.x, t = r.y, rt = r.x + r.w, b = r.y + r.h;
  if (h.includes('w')) l = clamp(l + dx, 0, rt - mw);
  if (h.includes('e')) rt = clamp(rt + dx, l + mw, W);
  if (h.includes('n')) t = clamp(t + dy, 0, b - mh);
  if (h.includes('s')) b = clamp(b + dy, t + mh, H);
  return { x: l, y: t, w: rt - l, h: b - t };
}

/** 키보드 한 번 — 화살표 1%, Shift 10%(짧은 변 기준, 최소 1px). */
export function keyStep(key: string, shift: boolean, W: number, H: number): [number, number] | null {
  const s = Math.max(1, Math.round(Math.min(W, H) * (shift ? 0.1 : 0.01)));
  return ({ ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] } as Record<string, [number, number]>)[key] ?? null;
}

/** 정수 픽셀로 맞춘 사각형(캔버스에 그릴 원본 영역). */
export function snap(r: Rect, W: number, H: number): Rect {
  const x = clamp(Math.round(r.x), 0, W - 1), y = clamp(Math.round(r.y), 0, H - 1);
  return { x, y, w: clamp(Math.round(r.w), 1, W - x), h: clamp(Math.round(r.h), 1, H - y) };
}

/** 만들 이미지 크기 — 화소가 한도를 넘으면 비율 유지로 줄인다. */
export function outputSize(r: Rect, max = MAX_PIXELS): { w: number; h: number; scale: number } {
  const px = r.w * r.h;
  const scale = px > max ? Math.sqrt(max / px) : 1;
  return { w: Math.max(1, Math.floor(r.w * scale)), h: Math.max(1, Math.floor(r.h * scale)), scale };
}

/** PNG는 PNG로(투명·선 그림 보존), 그 밖(JPEG·HEIC)은 JPEG로. */
export const outputType = (mime: string, name = '') => (mime === 'image/png' || /\.png$/i.test(name) ? 'image/png' : 'image/jpeg');

export function croppedName(name: string, type: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'photo';
  return `${base}-crop.${type === 'image/png' ? 'png' : 'jpg'}`;
}
