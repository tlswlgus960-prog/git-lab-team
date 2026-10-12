// 미술관 마을 배치(D40, SD_02 §17-13 D): 서버가 준 격자 칸(x, y)을 위에서 비스듬히 본 화면 좌표로 바꾼다. 순수 함수 — 시험 대상.
import { isColor, isKind, isStyle, DEFAULT_STYLE, type CharacterColor, type CharacterKind, type MuseumStyle } from '@/app/character/names';

export interface TownChildDto { id: string; alias: string; character?: string | null; color?: string | null; museumStyle?: string | null }
export interface TownBuildingDto { id: string; x: number; y: number; relation: 'mine' | 'neighbor' | 'stranger'; style?: string | null; children?: TownChildDto[] }

export interface TownChild { id: string; alias: string; kind: CharacterKind | null; color: CharacterColor | null; style: MuseumStyle }
export interface PlacedBuilding {
  id: string; relation: TownBuildingDto['relation']; style: MuseumStyle; color: CharacterColor | undefined;
  children: TownChild[]; gx: number; gy: number;
  /** 마을 판 위 가운데 좌표(px) */
  cx: number; cy: number;
}
export interface TownLayout { buildings: PlacedBuilding[]; width: number; height: number; minX: number; minY: number }

export const TILE_W = 360;   // 마름모 칸 가로(건물 170px + 사이 길 — 겹치지 않게)
export const TILE_H = 180;   // 마름모 칸 세로
export const PAD = 200;      // 판 가장자리 여백(건물 높이 몫 포함)

/** 격자 칸 → 판 좌표(아이소메트릭) */
export const iso = (x: number, y: number) => ({ cx: (x - y) * (TILE_W / 2), cy: (x + y) * (TILE_H / 2) });

export function layoutTown(dtos: TownBuildingDto[]): TownLayout {
  const raw = dtos.map((b) => {
    const kids: TownChild[] = (b.children ?? []).map((c) => ({
      id: c.id, alias: c.alias, kind: isKind(c.character) ? c.character : null, color: isColor(c.color) ? c.color : null,
      style: isStyle(c.museumStyle) ? c.museumStyle : DEFAULT_STYLE,
    }));
    return {
      id: b.id, relation: b.relation, style: isStyle(b.style) ? b.style : DEFAULT_STYLE,
      color: kids[0]?.color ?? undefined, children: kids, gx: b.x, gy: b.y, ...iso(b.x, b.y),
    };
  });
  if (!raw.length) return { buildings: [], width: 0, height: 0, minX: 0, minY: 0 };
  const xs = raw.map((b) => b.cx); const ys = raw.map((b) => b.cy);
  const minX = Math.min(...xs) - TILE_W / 2 - PAD; const minY = Math.min(...ys) - TILE_H / 2 - PAD;
  const maxX = Math.max(...xs) + TILE_W / 2 + PAD; const maxY = Math.max(...ys) + TILE_H / 2 + PAD / 2;
  // 판 왼쪽 위를 (0,0)으로 옮기고, 뒤(위)에 있는 건물이 먼저 그려지게 깊이 순
  const buildings = raw.map((b) => ({ ...b, cx: b.cx - minX, cy: b.cy - minY })).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return { buildings, width: maxX - minX, height: maxY - minY, minX, minY };
}

/** 보기 창(뷰포트)을 판 안으로 — 판이 창보다 작으면 가운데 */
export function clampPan(pan: { x: number; y: number }, view: { w: number; h: number }, board: { w: number; h: number }) {
  const axis = (p: number, v: number, b: number) => (b <= v ? (v - b) / 2 : Math.min(0, Math.max(v - b, p)));
  return { x: axis(pan.x, view.w, board.w), y: axis(pan.y, view.h, board.h) };
}

/** 건물이 창 가운데 오는 이동값 */
export const centerOn = (b: { cx: number; cy: number }, view: { w: number; h: number }) => ({ x: view.w / 2 - b.cx, y: view.h / 2 - b.cy });

/** 미술관 주소: 내 아이는 내 미술관, 이웃 아이는 방문 */
export const museumPath = (childId: string, relation: PlacedBuilding['relation']) =>
  relation === 'mine' ? `/app/museum/${childId}` : `/app/museum/${childId}?visit=1`;
