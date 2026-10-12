// 마지막으로 들어간 아이 미술관(D43, SD_02 §17-13 G) — 이 브라우저에만. 저장소가 막혀 있으면 기억하지 않는다.
const LAST = 'uam.lastChild';
export function lastChild(): string | null { try { return localStorage.getItem(LAST); } catch { return null; } }
export function rememberChild(id: string) { try { localStorage.setItem(LAST, id); } catch { /* 저장소 없음 */ } }
