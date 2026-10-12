// 1인칭 고전 회랑 엔진(D33, SD_02 §17-9) — 이제민 세션2 시안(docs/C/louvre-walk/index.html)을 제품용으로 옮긴 것.
// 사진 한 장(한 점 투시)을 Tour Into the Picture로 편 조각(manifest `kind: "tip"`)을 CSS perspective · preserve-3d로 세우고 그 안을 걷는다.
// 3D 엔진 없음. 좌표는 미터(Z = 사진 찍은 자리에서 앞, X = 오른쪽 +, 눈높이 1.5m), CSS는 1m = 100px.
// 화면 글자 · 계기판은 부르는 쪽(Vue)이 그린다. 이 파일은 장면 · 카메라 · 입력 · 자동 걷기 · 가까운 작품 감지만.
import parquetUrl from '@/assets/walk/parquet.webp';

export interface TipFace { name: string; src: string; w: number; h: number; tf: string }
export interface TipNode {
  id: string; kind: 'tip'; title: string; source: string; author: string; license: string;
  original: { width: number; height: number }; camera: { vx: number; vy: number; f: number };
  box: { xl: number; xr: number; yf: number; yc: number; zb: number }; faces: TipFace[];
}
export interface WalkArt { id: string; title: string; age: number | null; madeOn: string; src: string | null }
/** age null = 나이 미정 구역(D34 ③) */
export interface Section { age: number | null; z0: number; n: number }
export interface Hung { art: WalkArt; side: -1 | 1; x: number; z: number; fw: number; fh: number; el: HTMLButtonElement }
export interface Cam { x: number; z: number; yaw: number; pitch: number; P: number }
interface Hooks { onNear(a: Hung | null): void; onWhere(sec: Section | null): void; onOpen(a: Hung): void; onFrame?(c: Cam): void }

export const ZMIN = 24;
export const ZMAX = 96;
const EYE = 1.5;
const HANG = 1.45;
const STEP = 2.2; // 작품 간격(구역 안, 좌우 번갈아)
const cm = (m: number) => (m * 100).toFixed(1);
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 나이 구역 배치: 입구 쪽이 최근 나이. 깊이에 들어가는 만큼만(넘치면 최근 순) */
export function layout(groups: { age: number | null; items: WalkArt[] }[]): { sections: Section[]; hung: { art: WalkArt; side: -1 | 1; z: number; age: number | null }[] } {
  const sections: Section[] = []; const hung: { art: WalkArt; side: -1 | 1; z: number; age: number | null }[] = [];
  let z = ZMIN + 3;
  // 나이 미정(null)이 입구 쪽 맨 앞(막 올린 작품), 그다음 최근 나이부터
  for (const g of [...groups].sort((a, b) => (a.age == null ? -1 : b.age == null ? 1 : b.age - a.age))) {
    const items = [...g.items].sort((a, b) => b.madeOn.localeCompare(a.madeOn));
    const room = Math.floor((ZMAX - 2 - (z + 1.8)) / STEP) + 1;
    if (room <= 0) break;
    const take = items.slice(0, room);
    sections.push({ age: g.age, z0: z, n: take.length });
    take.forEach((art, i) => hung.push({ art, side: i % 2 === 0 ? -1 : 1, z: z + 1.8 + i * STEP, age: g.age }));
    z += 1.8 + take.length * STEP + 2.4;
  }
  return { sections, hung };
}

export class PhotoCorridor {
  cam: Cam = { x: 0, z: 0, yaw: 0, pitch: 0, P: 1000 };
  arts: Hung[] = [];
  sections: Section[] = [];
  entered = false;
  near: Hung | null = null;
  private world: HTMLElement;
  private raf = 0;
  private last = performance.now();
  private bobT = 0; private bobA = 0;
  private auto: { from: Cam; to: Cam; t0: number; dur: number; art: Hung | null; dist: number } | null = null;
  private keys = new Set<string>();
  private drag: { x: number; y: number; yaw: number; pitch: number; moved: number } | null = null;
  private stick = { x: 0, y: 0 };
  private whereSec: Section | null | undefined = undefined;
  private tourIdx = -1;
  private disposed = false;

  constructor(private vp: HTMLElement, private node: TipNode, private base: string, private reduced: () => boolean, private hooks: Hooks) {
    this.world = document.createElement('div'); this.world.className = 'pw-world'; vp.appendChild(this.world);
    this.buildPhoto();
    vp.addEventListener('pointerdown', this.onDown); vp.addEventListener('pointermove', this.onMove); vp.addEventListener('pointerup', this.onUp); vp.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKeyUp); window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    this.cam.P = this.fitPhotoP();
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- 장면 ----------
  private plane(cls: string, w: number, h: number, tf: string, html = '', tag: 'div' | 'button' = 'div') {
    const el = document.createElement(tag); el.className = `pw-pl ${cls}`;
    el.style.cssText = `width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;transform:${tf}`;
    if (html) el.innerHTML = html;
    this.world.appendChild(el); return el;
  }
  private buildPhoto() {
    for (const f of this.node.faces) {
      const el = this.plane('pw-photo', f.w, f.h, f.tf); const url = `${this.base}/${f.src}`;
      el.style.backgroundImage = `url(${url})`;
      if (f.name.startsWith('floor')) { // 바닥은 사진 맨 앞의 선명한 쪽모이 결을 겹친다(색 · 빛은 사진 그대로)
        el.style.backgroundImage = `url(${parquetUrl}),url(${url})`; el.style.backgroundSize = '440px 520px,100% 100%';
        el.style.backgroundRepeat = 'repeat,no-repeat'; el.style.backgroundBlendMode = 'overlay,normal';
        el.style.setProperty('mask-image', `url(${url})`); el.style.setProperty('-webkit-mask-image', `url(${url})`);
        el.style.setProperty('mask-size', '100% 100%'); el.style.setProperty('-webkit-mask-size', '100% 100%');
      }
      el.setAttribute('aria-hidden', 'true');
    }
    const { xl, xr, yf, yc } = this.node.box; const w = (xr - xl) * 100; const h = (yf - yc) * 100;
    const entry = this.plane('pw-entry pw-two pw-post', w, h, `translate3d(${cm((xl + xr) / 2)}px,${cm((yc + yf) / 2)}px,${cm(-(ZMIN - 4))}px)`);
    entry.setAttribute('aria-hidden', 'true');
  }
  /** 전시 작품을 건다(다시 부르면 옛 액자를 걷어 낸다) */
  hangAll(groups: { age: number | null; items: WalkArt[] }[], label: { banner(age: number | null, n: number): string; art(title: string, age: number | null): string; plaque(madeOn: string, age: number | null): string }) {
    this.world.querySelectorAll('.pw-art,.pw-plaque,.pw-banner').forEach((e) => e.remove());
    this.arts = []; this.near = null; this.hooks.onNear(null);
    const { sections, hung } = layout(groups); this.sections = sections;
    const { xl, xr } = this.node.box;
    for (const s of sections) {
      const b = this.plane('pw-banner pw-two pw-post', 380, 96, `translate3d(${cm((xl + xr) / 2)}px,${cm(-3.1)}px,${cm(-(s.z0 - 1.2))}px)`, label.banner(s.age, s.n));
      b.setAttribute('aria-hidden', 'true');
    }
    for (const h of hung) {
      const ratio = 4 / 3; const long = 1.15;
      const fw = ratio >= 1 ? long : long * ratio; const fh = ratio >= 1 ? long / ratio : long;
      const x = h.side < 0 ? xl + 0.04 : xr - 0.04; const y = EYE - HANG; const yaw = h.side < 0 ? 90 : -90;
      const img = h.art.src ? `<img alt="" src="${esc(h.art.src)}" loading="lazy">` : '';
      const el = this.plane('pw-art pw-post', fw * 100, fh * 100, `translate3d(${cm(x)}px,${cm(y)}px,${cm(-h.z)}px) rotateY(${yaw}deg)`,
        `<span class="pw-glow" aria-hidden="true"></span><span class="pw-fr"><span class="pw-mat">${img}</span></span>`, 'button') as HTMLButtonElement;
      el.type = 'button'; el.setAttribute('aria-label', label.art(h.art.title, h.age));
      const a: Hung = { art: h.art, side: h.side, x, z: h.z, fw, fh, el };
      // 그림 비율대로 액자를 맞춘다(잘라 내지 않음)
      const im = el.querySelector('img');
      im?.addEventListener('load', () => { const r = im.naturalWidth / Math.max(1, im.naturalHeight); this.fit(a, r); }, { once: true });
      const pl = this.plane('pw-plaque pw-post', 46, 17, '', `<b>${esc(h.art.title)}</b><span>${esc(label.plaque(h.art.madeOn, h.age))}</span>`);
      pl.setAttribute('aria-hidden', 'true'); (a as Hung & { pl?: HTMLElement }).pl = pl;
      this.placePlaque(a);
      el.addEventListener('click', (e) => { e.stopPropagation(); if (this.near === a) this.hooks.onOpen(a); else this.walkTo(this.artPose(a), a); });
      this.arts.push(a);
    }
    // 안내 걷기 차례 = 입구에서 안쪽으로
    this.arts.sort((p, q) => p.z - q.z);
  }
  private fit(a: Hung, ratio: number) {
    const long = 1.15; a.fw = ratio >= 1 ? long : long * ratio; a.fh = ratio >= 1 ? long / ratio : long;
    a.el.style.width = `${a.fw * 100}px`; a.el.style.height = `${a.fh * 100}px`; a.el.style.margin = `${-a.fh * 50}px 0 0 ${-a.fw * 50}px`;
    this.placePlaque(a);
  }
  private placePlaque(a: Hung) {
    const pl = (a as Hung & { pl?: HTMLElement }).pl; if (!pl) return;
    const y = EYE - HANG; const yaw = a.side < 0 ? 90 : -90;
    // 명패: 관람자 기준 작품 오른쪽, 액자 아래 선에 맞춤
    const pz = a.z + (a.side < 0 ? -1 : 1) * (a.fw / 2 + 0.38);
    pl.style.transform = `translate3d(${cm(a.x - a.side * 0.01)}px,${cm(y + a.fh / 2 - 0.12)}px,${cm(-pz)}px) rotateY(${yaw}deg)`;
  }

  // ---------- 카메라 ----------
  private fitPhotoP() { // 입구: 사진 찍은 화각 그대로(사진 = 화면)
    const c = this.node.camera; const W = this.node.original.width; const Hh = this.node.original.height;
    const w = this.vp.clientWidth; const h = this.vp.clientHeight;
    return c.f * Math.max(w / (2 * Math.min(c.vx, W - c.vx)), h / (2 * (Hh - c.vy)));
  }
  private walkP() { const w = this.vp.clientWidth; const h = this.vp.clientHeight; return w > h ? (w / 2) / Math.tan((26 * Math.PI) / 180) : Math.max(h * 1.25, 900); }
  private artP(a: Hung) { const w = this.vp.clientWidth; const h = this.vp.clientHeight; const D = 2.7; return Math.min(this.walkP() * 1.6, (Math.min(w * 0.72, h * 0.55) * D * 100) / (Math.max(a.fw, a.fh * (w / h > 1 ? 1 : 0.8)) * 100)); }
  private render() {
    const r = this.reduced(); const bob = r ? 0 : Math.sin(this.bobT) * 2.2 * this.bobA; const roll = r ? 0 : Math.sin(this.bobT / 2) * 0.25 * this.bobA;
    const c = this.cam;
    this.vp.style.perspective = `${c.P.toFixed(1)}px`;
    this.world.style.transform = `translateZ(${(c.P - 1).toFixed(1)}px) rotateZ(${roll.toFixed(3)}deg) rotateX(${c.pitch.toFixed(2)}deg) rotateY(${(-c.yaw).toFixed(2)}deg) translate3d(${cm(-c.x)}px,${bob.toFixed(2)}px,${cm(c.z)}px)`;
  }
  private inside(x: number, z: number) { const b = this.node.box; return x > b.xl + 0.9 && x < b.xr - 0.9 && z > ZMIN - 0.01 && z < ZMAX + 0.01; }
  artPose(a: Hung): Cam {
    const D = 2.7; const fwd = 0.55; const b = this.node.box;
    const x = a.side < 0 ? Math.min(b.xl + D, b.xr - 1) : Math.max(b.xr - D, b.xl + 1);
    return { x, z: a.z - fwd, yaw: a.side < 0 ? 78 : -78, pitch: 0, P: this.artP(a) };
  }
  walkTo(target: Cam, art: Hung | null = null, ms?: number) {
    const from = { ...this.cam }; const dist = Math.hypot(target.x - from.x, target.z - from.z);
    let tyaw = target.yaw; while (tyaw - from.yaw > 180) tyaw -= 360; while (tyaw - from.yaw < -180) tyaw += 360;
    const dur = this.reduced() ? 0 : (ms ?? Math.min(2600, Math.max(700, dist * 260 + Math.abs(tyaw - from.yaw) * 5)));
    this.auto = { from, to: { ...target, yaw: tyaw }, t0: performance.now(), dur, art, dist };
    if (!dur) { Object.assign(this.cam, this.auto.to); this.auto = null; this.render(); this.sense(); }
  }

  // ---------- 입장 · 안내 걷기 ----------
  /** 입구 연출: 사진 속으로 걸어 들어간다(3.4초, 움직임 줄이기면 바로) */
  enter(instant = false) {
    if (this.entered) return; this.entered = true; this.vp.classList.add('pw-in');
    this.walkTo({ x: -0.3, z: ZMIN + 1.5, yaw: 0, pitch: 2, P: this.walkP() }, null, instant ? 0 : 3400);
  }
  step(d: 1 | -1) {
    if (!this.arts.length) return;
    if (!this.entered) this.enter(true);
    this.tourIdx = Math.max(0, Math.min(this.arts.length - 1, this.tourIdx + d));
    const a = this.arts[this.tourIdx]!; this.walkTo(this.artPose(a), a);
  }
  goTo(a: Hung, instant = false) {
    if (!this.entered) this.enter(true);
    this.tourIdx = this.arts.indexOf(a);
    this.walkTo(this.artPose(a), a, instant ? 0 : undefined);
  }
  /** 두 번째 방문 · 건너뛰기: 그 나이 구역의 첫 작품 앞으로(없으면 가장 최근) */
  goToSection(age: number | null, instant = true) {
    const a = this.arts.find((x) => x.art.age === age) ?? this.arts[0];
    if (!this.entered) this.enter(true);
    if (a) this.goTo(a, instant); else this.walkTo({ x: -0.3, z: ZMIN + 1.5, yaw: 0, pitch: 2, P: this.walkP() }, null, 0);
  }

  /** 걸리는 장면(D34 ⑤): 카메라가 그 벽 앞으로 걸어가는 동안 액자가 관람자 앞에 떠 있다가 벽으로 날아가 붙는다 */
  async land(id: string): Promise<Hung | null> {
    const a = this.arts.find((x) => x.art.id === id); if (!a) return null;
    if (!this.entered) this.enter(true);
    this.tourIdx = this.arts.indexOf(a);
    const pose = this.artPose(a);
    if (this.reduced()) { this.walkTo(pose, a, 0); return a; }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const final = a.el.style.transform; const yaw = a.side < 0 ? 90 : -90;
    const mid = [(a.x + pose.x) / 2 + (a.side < 0 ? 0.9 : -0.9), (a.z + pose.z) / 2] as const;
    a.el.classList.add('pw-landing'); a.el.style.transition = 'none';
    a.el.style.transform = `translate3d(${cm(mid[0])}px,${cm(-0.25)}px,${cm(-mid[1])}px) rotateY(${yaw + (a.side < 0 ? -35 : 35)}deg) scale(.55)`;
    this.walkTo(pose, a, 2200);
    await wait(1700);
    a.el.style.transition = ''; void a.el.offsetWidth; a.el.style.transform = final;
    await wait(1500); a.el.classList.remove('pw-landing');
    return a;
  }

  // ---------- 입력 ----------
  setStick(x: number, y: number) { this.stick = { x, y }; if (x || y) this.auto = null; }
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!this.entered || e.defaultPrevented || t?.closest?.('input, select, textarea, [role=dialog]')) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) { this.keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); this.auto = null; }
    if (k === 'e' && this.near) this.hooks.onOpen(this.near);
    if (k === ' ' && !t?.closest?.('button, a')) { e.preventDefault(); this.step(1); }
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private onBlur = () => { this.keys.clear(); };
  private onDown = (e: PointerEvent) => {
    if (!this.entered || (e.target as HTMLElement).closest('.pw-art')) return;
    this.drag = { x: e.clientX, y: e.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch, moved: 0 };
    try { this.vp.setPointerCapture(e.pointerId); } catch { /* 없어도 됨 */ }
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag; if (!d) return;
    const dx = e.clientX - d.x; const dy = e.clientY - d.y; d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    if (d.moved > 6) { this.auto = null; this.cam.yaw = d.yaw + dx * 0.18; this.cam.pitch = Math.max(-16, Math.min(22, d.pitch + dy * 0.12)); }
  };
  private onUp = () => { this.drag = null; };
  private onResize = () => { if (!this.entered) { this.cam.P = this.fitPhotoP(); this.render(); } };

  // ---------- 매 프레임 ----------
  private frame = (t: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    let moving = 0;
    const a = this.auto;
    if (a) {
      const k = a.dur ? Math.min(1, (t - a.t0) / a.dur) : 1; const e = 1 - (1 - k) ** 3 * (1 - k * 0.15);
      for (const p of ['x', 'z', 'yaw', 'pitch', 'P'] as const) this.cam[p] = a.from[p] + (a.to[p] - a.from[p]) * e;
      moving = a.dist > 0.3 ? Math.sin(Math.PI * k) : 0;
      if (k >= 1) this.auto = null;
    } else if (this.entered) {
      const run = this.keys.has('shift') ? 2.1 : 1; const sp = 1.9 * run;
      let f = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - this.stick.y;
      let s = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0) + this.stick.x;
      const turn = (this.keys.has('arrowleft') ? 1 : 0) - (this.keys.has('arrowright') ? 1 : 0);
      this.cam.yaw += turn * 70 * dt;
      const m = Math.hypot(f, s); if (m > 1) { f /= m; s /= m; }
      if (m > 0.05) {
        const y = (this.cam.yaw * Math.PI) / 180; const dx = (-Math.sin(y) * f + Math.cos(y) * s) * sp * dt; const dz = (Math.cos(y) * f + Math.sin(y) * s) * sp * dt;
        if (this.inside(this.cam.x + dx, this.cam.z)) this.cam.x += dx; if (this.inside(this.cam.x, this.cam.z + dz)) this.cam.z += dz;
        moving = Math.min(1, m) * run;
        this.cam.P += (this.walkP() - this.cam.P) * Math.min(1, dt * 2.5);
      }
    }
    this.bobA += ((moving ? 1 : 0) - this.bobA) * Math.min(1, dt * 6); this.bobT += dt * 8.5 * Math.max(0.4, moving);
    this.render(); this.sense(); this.hooks.onFrame?.(this.cam);
    this.raf = requestAnimationFrame(this.frame);
  };
  /** 가까운 작품: 바라보는 방향 ±30°, 4.2m 안 · 지금 구역 */
  private sense() {
    let best: Hung | null = null; let bd = 1e9; const y = (this.cam.yaw * Math.PI) / 180; const fx = -Math.sin(y); const fz = Math.cos(y);
    if (this.entered) for (const a of this.arts) {
      const dx = a.x - this.cam.x; const dz = a.z - this.cam.z; const d = Math.hypot(dx, dz); if (d > 4.2 || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < 0.86) continue; if (d < bd) { bd = d; best = a; }
    }
    if (best !== this.near) { this.near?.el.classList.remove('pw-near'); this.near = best; best?.el.classList.add('pw-near'); this.hooks.onNear(best); }
    const sec = this.entered ? [...this.sections].reverse().find((s) => this.cam.z >= s.z0 - 1) ?? null : null;
    if (sec !== this.whereSec) { this.whereSec = sec; this.hooks.onWhere(sec); }
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf);
    this.vp.removeEventListener('pointerdown', this.onDown); this.vp.removeEventListener('pointermove', this.onMove); this.vp.removeEventListener('pointerup', this.onUp); this.vp.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKeyUp); window.removeEventListener('blur', this.onBlur); window.removeEventListener('resize', this.onResize);
    this.world.remove();
  }
}
