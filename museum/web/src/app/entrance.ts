// 입장 화면(S0w, SD_02 §17-2 · §17-16 D47) 여부.
// - 첫 방문(로그인 전): 브라우저 저장값 uam.entered — 한 번 들어오면 로그인 화면으로 바로.
// - 탭 세션마다 한 번(D47): 로그인했어도 새로 연 탭에서 홈 /app로 들어오면 입장 화면부터. sessionStorage uam.enteredSession.
// 읽거나 쓰지 못하면(사생활 보호 모드 등) 입장 화면을 건너뛴다.
const KEY = 'uam.entered';
const SESSION_KEY = 'uam.enteredSession';

export function isFirstVisit(): boolean {
  try { return localStorage.getItem(KEY) !== '1'; } catch { return false; }
}

/** 이 탭에서 아직 입장 화면을 거치지 않았는가 */
export function needsEntrance(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) !== '1'; } catch { return false; }
}

export function markEntered(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* 저장소 없음 — 다음에도 입장 화면 없이 로그인 */ }
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* 저장소 없음 */ }
}
