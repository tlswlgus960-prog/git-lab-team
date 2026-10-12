// 캐릭터 색 6가지(D40) — 밝고 또렷한 파스텔. body = 몸, shade = 그늘·귀 안쪽 밖, belly = 배·주둥이.
import type { CharacterColor } from './names';

export interface Tint { body: string; shade: string; belly: string }

export const PALETTE: Record<CharacterColor, Tint> = {
  sunflower: { body: '#FFC93C', shade: '#EFA81E', belly: '#FFF1C4' },
  peach: { body: '#FF9E80', shade: '#EE7B5E', belly: '#FFE4D8' },
  sky: { body: '#6EC6FF', shade: '#40A3E6', belly: '#DDF2FF' },
  leaf: { body: '#7ED67A', shade: '#52B64F', belly: '#E3F8DB' },
  lavender: { body: '#B89DF6', shade: '#9275DD', belly: '#F0E8FF' },
  cloud: { body: '#F3F4FA', shade: '#C8CBDA', belly: '#FFFFFF' },
};

/** 윤곽선(스티커 느낌) · 눈 · 코 */
export const INK = '#4A3441';
export const BEAK = '#FFA630';
export const PINK = '#FFB3C7';
