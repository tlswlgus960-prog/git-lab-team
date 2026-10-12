// 견본 미술관(D48 ①, SD_02 §17-17) — 로그인 · 서버 없이 걷는 견본 아이 "견본이"(곰 · 해바라기 · 기둥 신전)의 미술관.
// 그림은 팀이 코드로 그린 견본 SVG(web/public/museum/sample/, 실제 아이 그림 · 사진 아님). 목록은 manifest.json과 같다(시험이 확인).
// 방 3개(7살 · 6살 · 5살 — 입구 쪽이 최근), 벽 = 액자 그림, 만들기 작품 2점 = 가운데 홀 받침대. 해설은 규칙으로 만든 짧은 해요체.
import type { ItemKind, MuseumInput, MuseumItem } from './layout';
import { m3 } from './copy';
import { josa } from '@/copy/josa';

export const SAMPLE_BASE = '/museum/sample/';
export interface SampleWork { file: string; title: string; kind: ItemKind; age?: number }

export const SAMPLE_WORKS: SampleWork[] = [
  { file: 'house-sun.svg', title: '해님 아래 우리 집', kind: 'frame', age: 5 },
  { file: 'family.svg', title: '우리 가족 소풍', kind: 'frame', age: 5 },
  { file: 'cat.svg', title: '낮잠 자는 고양이', kind: 'frame', age: 5 },
  { file: 'snowman.svg', title: '눈사람 친구', kind: 'frame', age: 5 },
  { file: 'rainbow.svg', title: '비 온 뒤 무지개', kind: 'frame', age: 6 },
  { file: 'garden.svg', title: '꽃밭에 나비', kind: 'frame', age: 6 },
  { file: 'rocket.svg', title: '달나라 가는 로켓', kind: 'frame', age: 6 },
  { file: 'balloon.svg', title: '하늘로 풍선', kind: 'frame', age: 6 },
  { file: 'fish.svg', title: '바닷속 친구들', kind: 'frame', age: 7 },
  { file: 'tree.svg', title: '사과나무', kind: 'frame', age: 7 },
  { file: 'car.svg', title: '빨간 자동차', kind: 'frame', age: 7 },
];
export const SAMPLE_MAKING: SampleWork[] = [
  { file: 'clay-bear.svg', title: '찰흙 곰 인형', kind: 'relief' },
  { file: 'paper-robot.svg', title: '종이 상자 로봇', kind: 'relief' },
];

/** 규칙 해설: 나이 · 차례로 고른 짧은 해요체 한두 문장(개발 용어 없음) */
const FRAME_LINES = [
  (t: string) => `${t}에는 좋아하는 것이 가득 담겼어요. 크레파스를 꾹꾹 눌러 그린 선이 힘차요.`,
  (t: string) => `${t}의 밝은 색이 보는 사람 마음까지 환하게 해 줘요.`,
  (t: string) => `${josa(t, '을/를')} 그리면서 어떤 이야기를 떠올렸을까요? 그림 속 작은 것들을 하나씩 찾아보세요.`,
  (t: string) => `${josa(t, '은/는')} 모양을 크게, 색을 시원하게 칠했어요. 자신 있는 손길이 느껴져요.`,
];
const AGE_LINES: Record<number, string> = {
  5: '다섯 살에는 동그라미와 선으로 세상을 그려요.',
  6: '여섯 살이 되니 그림 속 이야기가 더 풍성해졌어요.',
  7: '일곱 살 그림에는 자세한 모양이 많이 보여요.',
};
export function sampleCaption(w: SampleWork, i: number): string {
  if (w.kind !== 'frame') return `${josa(w.title, '은/는')} 손으로 빚고 오려서 만든 작품이에요. 앞에서도 옆에서도 보는 재미가 있어요.`;
  return `${FRAME_LINES[i % FRAME_LINES.length]!(w.title)} ${w.age ? AGE_LINES[w.age] ?? '' : ''}`.trim();
}

const toItem = (w: SampleWork, i: number, pre: string): MuseumItem => ({
  id: `${pre}-${w.file.replace(/\.svg$/, '')}`, kind: w.kind, title: w.title, imageUrl: `${SAMPLE_BASE}${w.file}`,
  auxUrl: w.kind === 'relief' ? `${SAMPLE_BASE}${w.file}` : null, caption: sampleCaption(w, i), making: w.kind !== 'frame',
});

/** 견본이의 미술관 입력 — 서버 호출 없음 */
export function buildSampleInput(): MuseumInput {
  const ages = [7, 6, 5];
  return {
    childAlias: m3.sampleAlias, character: 'bear', color: 'sunflower', museumStyle: 'column_temple', visitor: false,
    groups: ages.map((age) => ({
      label: m3.ageRoom(age), age,
      items: SAMPLE_WORKS.map((w, i) => ({ w, i })).filter(({ w }) => w.age === age).map(({ w, i }) => toItem(w, i, 's')),
    })),
    hallMaking: SAMPLE_MAKING.map((w, i) => toItem(w, i, 'm')),
  };
}
