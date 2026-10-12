// 바뀌는 값 뒤 조사(docs/C/C_화면문구.md §0-7): 앞말 끝 글자의 받침으로 을/를·이/가·과/와·으로/로를 고른다.
// 끝 글자가 숫자면 읽는 소리로, 한글·숫자가 아니면(영문 등) "을(를)"처럼 둘 다 적는다.
type Pair = '을/를' | '이/가' | '과/와' | '으로/로' | '은/는';

// 0 영 1 일 2 이 3 삼 4 사 5 오 6 육 7 칠 8 팔 9 구 — 받침 없음 0, ㄹ 받침 8, 그 밖 받침 1
const DIGIT_JONG = [21, 8, 0, 16, 0, 0, 1, 8, 8, 0];

function jong(word: string): number | null {
  const last = word.trim().slice(-1);
  if (!last) return null;
  const c = last.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
  if (last >= '0' && last <= '9') return DIGIT_JONG[Number(last)]!;
  return null;
}

/** 값 + 알맞은 조사. 예: josa('움직임', '을/를') → '움직임을', josa('별이', '과/와') → '별이와' */
export function josa(word: string, pair: Pair): string {
  const [withJong, without] = pair.split('/') as [string, string];
  const j = jong(word);
  if (j === null) return `${word}${withJong}(${without})`;
  if (pair === '으로/로') return `${word}${j === 0 || j === 8 ? '로' : '으로'}`;
  return `${word}${j === 0 ? without : withJong}`;
}
