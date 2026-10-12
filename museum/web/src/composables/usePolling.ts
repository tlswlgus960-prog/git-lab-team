// 폴링(T037, R-12): 3 → 6 → 10초(이후 10초), 전이 중 상태일 때만, 탭이 숨으면 멈추고 보이면 바로 한 번 부른 뒤 이어 간다.
// tick이 false를 돌려주면(더 기다릴 상태가 아니면) 멈춘다. 오류는 멈추지 않고 다음 주기에 다시 부른다(§17 — 화면은 마지막 값 유지).
import { getCurrentScope, onScopeDispose, ref } from 'vue';

/** 움직임 줄이기 설정(SD_02 §17) — 재생 토글은 켜져도 정지 화면을 유지한다 */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const POLL_STEPS_MS = [3000, 6000, 10000] as const;

export function usePolling(tick: () => Promise<boolean>, steps: readonly number[] = POLL_STEPS_MS) {
  const running = ref(false);
  const lastError = ref<unknown>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let n = 0;
  let busy = false;

  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const schedule = () => {
    clear();
    if (!running.value || hidden()) return;
    const ms = steps[Math.min(n, steps.length - 1)] ?? 10000;
    n += 1;
    timer = setTimeout(run, ms);
  };
  async function run() {
    if (!running.value || busy) return;
    busy = true;
    try {
      const more = await tick();
      lastError.value = null;
      if (!more) { stop(); return; }
    } catch (e) {
      lastError.value = e;
    } finally {
      busy = false;
    }
    schedule();
  }
  const onVisibility = () => { if (!running.value) return; if (hidden()) clear(); else { void run(); } };

  function start() {
    if (running.value) return;
    running.value = true;
    n = 0;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    schedule();
  }
  function stop() {
    running.value = false;
    clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  }
  /** 사용자 조작 뒤처럼 3초부터 다시 */
  function restart() { stop(); start(); }

  if (getCurrentScope()) onScopeDispose(stop);
  return { running, lastError, start, stop, restart };
}
