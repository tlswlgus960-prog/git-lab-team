// 캐릭터 만들기(D40, SD_02 §17-13 A) — 계약 enum(openapi CharacterKind · CharacterColor · MuseumStyle)과 화면 이름.
// types.gen.ts가 아직 이 enum을 싣지 않아 여기서 같은 목록을 둔다(계약 순서 그대로). 목록 밖 값은 보내지 않는다.
export const KINDS = ['bear', 'rabbit', 'cat', 'dog', 'fox', 'penguin', 'dino', 'owl'] as const;
export const COLORS = ['sunflower', 'peach', 'sky', 'leaf', 'lavender', 'cloud'] as const;
export const STYLES = ['glass_pyramid', 'white_spiral', 'column_temple', 'clock_station', 'brick_chimney', 'golden_dome', 'hanok_roof', 'silver_wave'] as const;

export type CharacterKind = (typeof KINDS)[number];
export type CharacterColor = (typeof COLORS)[number];
export type MuseumStyle = (typeof STYLES)[number];

export const KIND_NAME: Record<CharacterKind, string> = {
  bear: '곰', rabbit: '토끼', cat: '고양이', dog: '강아지', fox: '여우', penguin: '펭귄', dino: '공룡', owl: '부엉이',
};
export const COLOR_NAME: Record<CharacterColor, string> = {
  sunflower: '해바라기', peach: '복숭아', sky: '하늘', leaf: '풀잎', lavender: '라벤더', cloud: '구름',
};
/** 모양만 모티브 — 실제 미술관 이름·로고 없음(D33) */
export const STYLE_NAME: Record<MuseumStyle, string> = {
  glass_pyramid: '유리 피라미드', white_spiral: '하얀 나선 탑', column_temple: '기둥 신전', clock_station: '시계탑 기차역',
  brick_chimney: '붉은 벽돌 굴뚝', golden_dome: '황금 돔 궁전', hanok_roof: '기와 한옥', silver_wave: '은빛 물결 지붕',
};

/** 아직 안 골랐으면(null) 화면 기본값 */
export const DEFAULT_KIND: CharacterKind = 'bear';
export const DEFAULT_COLOR: CharacterColor = 'sunflower';
export const DEFAULT_STYLE: MuseumStyle = 'column_temple';

export const isKind = (v: unknown): v is CharacterKind => (KINDS as readonly unknown[]).includes(v);
export const isColor = (v: unknown): v is CharacterColor => (COLORS as readonly unknown[]).includes(v);
export const isStyle = (v: unknown): v is MuseumStyle => (STYLES as readonly unknown[]).includes(v);
