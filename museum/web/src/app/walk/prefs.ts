// 걸어 다니는 미술관의 기기별 기억(D31, SD_02 §17-6 "방문 기억" · "벽 색 고르기"). 이 기기 브라우저에만, 아이마다.
// 저장소를 못 쓰면(사생활 보호 모드 등) 늘 첫 방문 · 기본 벽 색으로 동작한다.

/** 연한 벽 색 6개(스타일가이드 v3 블록 색과 같은 값). 첫 값이 기본 크림 */
export const WALL_PRESETS = [
  { key: 'cream', hex: '#FFF6EA' }, { key: 'pink', hex: '#FDE4E8' }, { key: 'mint', hex: '#E0F3EF' },
  { key: 'lilac', hex: '#EEE6F8' }, { key: 'sky', hex: '#E4F1FA' }, { key: 'butter', hex: '#FFF5D6' },
] as const;
export const WALL_DEFAULT = WALL_PRESETS[0].hex;
/** 벽 위 글자(토큰 ink) — 벽 색은 이 글자와 4.5:1 이상이어야 한다 */
export const WALL_INK = '#6E3550';

const HEX = /^#[0-9a-f]{6}$/i;
function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
/** 고른 색이 글자와 4.5:1이 안 되면 흰색을 섞어 4.5:1이 될 때까지 밝게. adjusted = 보정했는지 */
export function readableWall(hex: string): { hex: string; adjusted: boolean } {
  if (!HEX.test(hex)) return { hex: WALL_DEFAULT, adjusted: false };
  const up = hex.toUpperCase();
  if (contrast(up, WALL_INK) >= 4.5) return { hex: up, adjusted: false };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(up.slice(i, i + 2), 16));
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mix = [r!, g!, b!].map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('');
    const out = `#${mix}`.toUpperCase();
    if (contrast(out, WALL_INK) >= 4.5) return { hex: out, adjusted: true };
  }
  return { hex: '#FFFFFF', adjusted: true };
}

function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string | null) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* 저장소 없음 — 기억하지 않는다 */ } }

export function loadWall(childId: string): string {
  const v = read(`uam.wall.${childId}`);
  return v && HEX.test(v) ? readableWall(v).hex : WALL_DEFAULT;
}
export function saveWall(childId: string, hex: string | null) { write(`uam.wall.${childId}`, hex); }

/** 방문 기억: null = 첫 방문, { room: 나이 | null } = 두 번째 방문부터(room이 없으면 첫 방) */
export function loadVisit(childId: string): { room: number | null } | null {
  const v = read(`uam.walk.${childId}`);
  if (!v) return null;
  try { const o = JSON.parse(v) as { room?: unknown }; return { room: typeof o.room === 'number' ? o.room : null }; } catch { return null; }
}
export function saveVisit(childId: string, room: number | null) { write(`uam.walk.${childId}`, JSON.stringify({ room })); write('uam.walk.last', childId); }
/** 마지막으로 본 아이 — API를 기다리기 전에 두 번째 방문인지 알아 입구 장면이 번쩍이지 않게 */
export function lastChild(): string | null { return read('uam.walk.last'); }
