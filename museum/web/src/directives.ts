// 움직임 지시어(D38, SD_02 §17-11): v-reveal = 화면에 들어올 때 차례로 떠오르기(값 = 순번) · v-tilt = 마우스를 따라 최대 4° 기울기.
import type { App } from 'vue';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let io: IntersectionObserver | null = null;
const observer = () => (io ??= new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) { e.target.classList.add('is-in'); io!.unobserve(e.target); }
}, { rootMargin: '0px 0px -8% 0px' }));

export function installDirectives(app: App) {
  app.directive<HTMLElement, number | undefined>('reveal', {
    mounted(el, b) {
      el.dataset.reveal = ''; el.style.setProperty('--i', String(Math.min(b.value ?? 0, 12)));
      if (reduce() || typeof IntersectionObserver === 'undefined') el.classList.add('is-in'); else observer().observe(el);
    },
    unmounted(el) { io?.unobserve(el); },
  });
  app.directive<HTMLElement>('tilt', {
    mounted(el) {
      if (reduce() || !matchMedia('(pointer: fine)').matches) return;
      el.dataset.tilt = '';
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--ty', `${(x * 8).toFixed(2)}deg`); el.style.setProperty('--tx', `${(-y * 8).toFixed(2)}deg`);
      });
      el.addEventListener('pointerleave', () => { el.style.setProperty('--tx', '0deg'); el.style.setProperty('--ty', '0deg'); });
    },
  });
}
