// 걷는 화면 전환(D38, SD_02 §17-11): 같은 문서 View Transitions. 더 깊은 화면 = 다가감, 뒤로 = 물러남, 미술관 ↔ 관리 = 문 지나기.
// 지원 안 되면 그냥 바뀐다. 움직임 줄이기면 motion.css가 교차 페이드로 바꾼다.
import { nextTick } from 'vue';
import type { Router, RouteLocationNormalized } from 'vue-router';

const MUSEUM = new Set(['/app', '/app/list', '/app/hall']);
const depth = (r: RouteLocationNormalized) => r.path.split('/').filter(Boolean).length;

export function installTransitions(router: Router) {
  let finish: (() => void) | null = null;
  router.beforeResolve((to, from) => {
    const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
    if (!doc.startViewTransition || !from.matched.length || to.path === from.path) return;
    const dir = MUSEUM.has(to.path) !== MUSEUM.has(from.path) ? 'door' : depth(to) >= depth(from) ? 'forward' : 'back';
    document.documentElement.dataset.vt = dir;
    return new Promise<void>((go) => {
      doc.startViewTransition!(async () => {
        go(); // 이동을 확정하고
        await new Promise<void>((done) => { finish = done; setTimeout(done, 1200); }); // 새 화면이 그려질 때까지
      });
    });
  });
  router.afterEach(async () => { await nextTick(); finish?.(); finish = null; });
}
