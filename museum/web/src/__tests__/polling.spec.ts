// T037 시험: 3→6→10→10초, 전이가 끝나면 멈춤, 숨은 탭에서는 부르지 않고 보이면 바로 부른다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { usePolling } from '../composables/usePolling';

let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => vi.useRealTimers());
const flush = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

describe('usePolling', () => {
  it('3→6→10→10초 간격, false를 받으면 멈춘다', async () => {
    let calls = 0;
    const scope = effectScope();
    const p = scope.run(() => usePolling(async () => { calls += 1; return calls < 5; }))!;
    p.start();
    await flush(2999); expect(calls).toBe(0);
    await flush(1); expect(calls).toBe(1);
    await flush(6000); expect(calls).toBe(2);
    await flush(10000); expect(calls).toBe(3);
    await flush(10000); expect(calls).toBe(4);
    await flush(10000); expect(calls).toBe(5);
    expect(p.running.value).toBe(false);
    await flush(30000); expect(calls).toBe(5);
    scope.stop();
  });
  it('숨은 탭에서는 멈추고, 다시 보이면 바로 한 번 부른다', async () => {
    let calls = 0;
    const scope = effectScope();
    const p = scope.run(() => usePolling(async () => { calls += 1; return true; }))!;
    p.start();
    visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    await flush(30000); expect(calls).toBe(0);
    visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    await flush(0); expect(calls).toBe(1);
    scope.stop();
    expect(p.running.value).toBe(false);
  });
  it('앞 요청이 끝나기 전에는 겹쳐 부르지 않는다', async () => {
    let calls = 0; let release: () => void = () => undefined;
    const scope = effectScope();
    const p = scope.run(() => usePolling(() => { calls += 1; return new Promise<boolean>((r) => { release = () => r(true); }); }))!;
    p.start();
    await flush(3000); expect(calls).toBe(1);
    visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    await flush(0); expect(calls).toBe(1);
    release(); await flush(0);
    scope.stop();
  });
  it('S11 모델 상태 표는 2초 고정 간격(steps 인자)', async () => {
    let calls = 0;
    const scope = effectScope();
    const p = scope.run(() => usePolling(async () => { calls += 1; return true; }, [2000]))!;
    p.start();
    await flush(2000); expect(calls).toBe(1);
    await flush(2000); expect(calls).toBe(2);
    await flush(2000); expect(calls).toBe(3);
    scope.stop();
  });
  it('범위가 사라지면 스스로 멈춘다', async () => {
    let calls = 0;
    const scope = effectScope();
    const p = scope.run(() => usePolling(async () => { calls += 1; return true; }))!;
    p.start(); scope.stop();
    expect(p.running.value).toBe(false);
    await flush(30000); expect(calls).toBe(0);
  });
  it('오류가 나도 멈추지 않고 마지막 오류를 남긴다', async () => {
    let calls = 0;
    const scope = effectScope();
    const p = scope.run(() => usePolling(async () => { calls += 1; if (calls === 1) throw new Error('x'); return true; }))!;
    p.start();
    await flush(3000); expect(p.lastError.value).toBeInstanceOf(Error);
    await flush(6000); expect(calls).toBe(2); expect(p.lastError.value).toBeNull();
    scope.stop();
  });
});
