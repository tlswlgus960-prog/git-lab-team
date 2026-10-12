// 전시 응답 → 미술관 입력(MuseumInput). 가족 = GET /v1/gallery?child= · 방문자 = GET /v1/visit/children/{id}/gallery (D40, §17-13 F).
// 방문자에게는 나이 · 한마디 · 감상평 · 그린 날을 싣지 않는다(응답에도 없음) — 방 이름은 "전시실 N".
import type { components } from '@/api/types.gen';
import type { ItemKind, MuseumInput, MuseumItem } from './layout';
import { m3 } from './copy';

type Gallery = components['schemas']['Gallery'];
type GalleryItem = components['schemas']['GalleryItem'];

/** 이웃 아이의 미술관(계약 VisitGallery — types.gen.ts에 아직 없어 여기서 같은 모양을 둔다) */
export interface VisitGallery {
  child: { id: string; alias: string; character?: string | null; color?: string | null; museumStyle?: string | null };
  rooms: { room: number; items: { id: string; kind: ItemKind; title: string | null; primaryUrl?: string | null; auxUrl?: string | null }[] }[];
}
export interface ChildInfo { alias: string; character?: string | null; color?: string | null; museumStyle?: string | null }

/** 가족 전시의 멈춘 그림: 액자 · 움직이는 그림 = photoUrl(고친 사진), 입체(2.5D) = 컷아웃(auxUrl) */
export function stillOf(it: GalleryItem): string | null {
  if (it.kind === 'relief') return it.auxUrl ?? it.photoUrl ?? it.originalUrl ?? null;
  if (it.kind === 'animated') return it.posterUrl ?? it.photoUrl ?? it.originalUrl ?? null;
  if (it.kind === 'sculpture') return it.photoUrl ?? it.originalUrl ?? null;
  return it.photoUrl ?? it.originalUrl ?? null;
}

/** 보호자가 적은 것만 말한다(외부 평가 2026-09-30): 날짜 · 나이를 적지 않았으면(…Auto) 그 값을 보이지 않는다. types.gen.ts가 아직 몰라 방어적으로 읽는다 */
const flag = (it: unknown, k: 'madeOnAuto' | 'ageAuto' | 'titleAuto') => (it as Record<string, unknown> | null)?.[k] === true;
/** 자동 제목("제목 없는 그림 N")은 "제목이 아직 없는 작품"으로 */
export function shownTitle(it: { title?: string | null } & Record<string, unknown>): string | null {
  const t = it.title ?? null;
  if (flag(it, 'titleAuto') || (t && /^제목 없는 그림 \d+$/.test(t))) return m3.autoTitle;
  return t;
}
function toItem(it: GalleryItem): MuseumItem {
  const unsure = flag(it, 'madeOnAuto') || flag(it, 'ageAuto');
  return {
    id: it.id, kind: it.kind as ItemKind, title: shownTitle(it as never), imageUrl: stillOf(it),
    auxUrl: it.auxUrl ?? null, videoUrl: it.kind === 'animated' ? it.primaryUrl ?? null : null,
    caption: unsure ? null : it.aiCaption?.body ?? null, // 적지 않은 날짜 · 나이가 해설에 섞이지 않게
    making: (it as { making?: boolean }).making === true, // (D45) 서버 칸이 생기면 그대로 받는다
  };
}

export function fromGallery(g: Gallery, child: ChildInfo): MuseumInput {
  const byDate = (a: GalleryItem, b: GalleryItem) => b.madeOn.localeCompare(a.madeOn);
  // 나이를 보호자가 적지 않은(ageAuto) 작품은 나이 방에 넣지 않고 "나이를 적지 않은 작품" 방으로(맨 앞)
  const autoItems = g.groups.flatMap((grp) => grp.items.filter((it) => flag(it, 'ageAuto')));
  const groups = [...g.groups]
    // 나이 미정이 1번 방, 그다음 최근 나이부터(입구 쪽이 최근)
    .sort((a, b) => (a.ageAtMaking == null ? -1 : b.ageAtMaking == null ? 1 : b.ageAtMaking - a.ageAtMaking))
    .map((grp) => ({
      label: grp.ageAtMaking == null ? m3.noAgeRoom : m3.ageRoom(grp.ageAtMaking),
      age: grp.ageAtMaking ?? null,
      items: grp.items.filter((it) => !flag(it, 'ageAuto')).sort(byDate).map(toItem),
    }))
    .filter((grp) => grp.items.length);
  if (autoItems.length) groups.unshift({ label: m3.ageAutoRoom, age: null, items: [...autoItems].sort(byDate).map(toItem) });
  return { childAlias: child.alias, character: child.character ?? null, color: child.color ?? null, museumStyle: child.museumStyle ?? null, visitor: false, groups };
}

/** 방문 파일 뜻(API 7f02fba): frame = primaryUrl 그림 · animated = primaryUrl 영상 + auxUrl 그림 · relief = auxUrl 컷아웃(primaryUrl 깊이) · sculpture = primaryUrl 결과(그림 없음) */
function visitItem(it: VisitGallery['rooms'][number]['items'][number]): MuseumItem {
  const p = it.primaryUrl ?? null; const a = it.auxUrl ?? null;
  const imageUrl = it.kind === 'frame' ? p : it.kind === 'animated' ? a : it.kind === 'relief' ? a : null;
  return { id: it.id, kind: it.kind, title: shownTitle(it as never), imageUrl, auxUrl: a, videoUrl: it.kind === 'animated' ? p : null, caption: null,
    making: (it as { making?: boolean }).making === true };
}

export function fromVisit(v: VisitGallery): MuseumInput {
  const rooms = [...v.rooms].sort((a, b) => a.room - b.room);
  return {
    childAlias: v.child.alias, character: v.child.character ?? null, color: v.child.color ?? null, museumStyle: v.child.museumStyle ?? null,
    visitor: true,
    groups: rooms.map((r) => ({ label: m3.visitRoom(r.room), items: r.items.map(visitItem) })),
  };
}
