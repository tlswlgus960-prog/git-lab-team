// 걸어 다니는 미술관 /app(D31, SD_02 §17-6): 입구 → 회랑(최근 작품 · 명패) → 갈림길(N살 전시실) → 방 → 크게 보기 + 한마디,
// 두 번째 방문은 마지막 방에서, 작품 0개면 회랑 첫 자리에 [작품 올리기], 키보드, 벽 색(대비 보정 · 아이마다 저장).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import WalkHomeView from '../app/views/WalkHomeView.vue';
import { WALL_DEFAULT, WALL_INK, contrast, loadVisit, loadWall, readableWall, saveVisit } from '../app/walk/prefs';
import { ko } from '../copy/ko';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
let router: Router;
beforeEach(() => {
  setActivePinia(createPinia()); localStorage.clear();
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
  // 움직임 줄이기 = 걷기 전환 없이 장면만(시험을 기다리지 않게)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

const item = (id: string, age: number, madeOn: string, title: string, words: string | null = null) => ({ id, kind: 'frame', originalUrl: `/v1/files/${id}`, title, madeOn, ageAtMaking: age, childWords: words });
const gal = { childId: '1', groups: [
  { ageAtMaking: 6, items: [item('3', 6, '2025-05-01', '강아지', '멍멍이가 웃어')] },
  { ageAtMaking: 5, items: [item('1', 5, '2024-03-01', '해님'), item('2', 5, '2024-01-10', '꽃')] },
] };
function serve(gallery: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url).split('?')[0];
    if (path === '/v1/children') return json([{ id: '1', alias: '하늘' }]);
    if (path === '/v1/gallery') return json(gallery);
    return new Response('{}', { status: 404 });
  }));
}
async function open() {
  await router.push('/app'); await router.isReady();
  const w = mount(WalkHomeView, { global: { plugins: [router], stubs: { RouterLink: { props: ['to'], template: '<a><slot /></a>' } } }, attachTo: document.body });
  await flushPromises(); await flushPromises();
  return w;
}
const click = async (w: ReturnType<typeof mount>, label: string) => { await w.findAll('button').find((b) => b.text().includes(label))!.trigger('click'); await flushPromises(); await flushPromises(); };
const key = async (k: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); await flushPromises(); await flushPromises(); };

describe('벽 색(prefs)', () => {
  it('밝은 색은 그대로, 어두운 색은 글자 대비 4.5:1까지 밝게 보정, 잘못된 값은 기본 크림', () => {
    expect(readableWall('#e0f3ef')).toEqual({ hex: '#E0F3EF', adjusted: false });
    const dark = readableWall('#6e1a22');
    expect(dark.adjusted).toBe(true);
    expect(contrast(dark.hex, WALL_INK)).toBeGreaterThanOrEqual(4.5);
    expect(readableWall('red').hex).toBe(WALL_DEFAULT);
    localStorage.setItem('uam.wall.1', '#1c2b4f');
    expect(contrast(loadWall('1'), WALL_INK)).toBeGreaterThanOrEqual(4.5);
    expect(loadWall('2')).toBe(WALL_DEFAULT);
  });
});

describe('걸어 다니는 미술관 /app', () => {
  it('첫 방문: 입구 → [입장하기] → 회랑(최근 작품부터 · 명패) → 앞으로 → 갈림길(← 5살 · 6살 →) → 방', async () => {
    serve(gal);
    const w = await open();
    expect(w.find('.wk-where').text()).toBe(ko.walk.atGate);
    expect(w.find('.wk-sign h1').text()).toBe(ko.museum.hall('하늘'));
    await click(w, ko.walk.enter);
    expect(loadVisit('1')).toEqual({ room: null });
    expect(w.find('.wk-where').text()).toBe(ko.walk.atCorridor(1, 3));
    expect(w.find('.wk-corr .mc-plaque').text()).toContain('강아지');
    expect(w.find('.wk-corr .artframe').classes()).toContain('v-gold');
    await key('ArrowUp'); await key('ArrowUp');
    expect(w.find('.wk-corr .mc-plaque').text()).toContain('꽃');
    await click(w, ko.walk.forward);
    expect(w.find('.wk-where').text()).toBe(ko.walk.atJunction);
    expect(w.find('.wk-door.l').text()).toBe(ko.walk.toLeft(5));
    expect(w.find('.wk-door.r').text()).toBe(ko.walk.toRight(6));
    await key('ArrowRight');
    expect(w.find('.wk-where').text()).toBe(ko.walk.room(6));
    expect(loadVisit('1')).toEqual({ room: 6 });
    await key('ArrowLeft');
    expect(w.find('.rm-head h2').text()).toBe(ko.walk.room(5));
    expect(w.findAll('.wk-room .mc-plaque b').map((b) => b.text())).toEqual(['꽃', '해님']);
    w.unmount();
  });
  it('두 번째 방문은 입구 없이 마지막으로 본 방에서, [건너뛰기]는 입구 · 회랑에서 늘 보인다', async () => {
    saveVisit('1', 6);
    serve(gal);
    const w = await open();
    expect(w.find('.wk-where').text()).toBe(ko.walk.room(6));
    expect(w.find('.wk-gate').exists()).toBe(false);
    await click(w, ko.walk.toCorridor);
    expect(w.find('.wk-where').text()).toBe(ko.walk.atJunction);
    expect(w.findAll('button').some((b) => b.text().includes(ko.walk.skip))).toBe(true);
    w.unmount();
  });
  it('작품이 없으면 회랑 첫 자리에 "첫 그림을 걸어 볼까요?" · [작품 올리기], 갈림길 없음', async () => {
    serve({ childId: '1', groups: [] });
    const w = await open();
    await click(w, ko.walk.enter);
    expect(w.find('.wk-empty').text()).toContain(ko.museum.emptyTitle);
    expect(w.find('.wk-empty').text()).toContain(ko.museum.upload);
    await key('ArrowUp');
    expect(w.find('.wk-junc').exists()).toBe(false);
    w.unmount();
  });
  it('액자를 누르면 크게 보기 + 아이의 한마디, Esc로 닫고 초점은 액자로', async () => {
    serve(gal);
    const w = await open();
    await click(w, ko.walk.enter);
    const art = w.find('.wk-corr .wk-art');
    await art.trigger('click'); await flushPromises();
    expect(document.querySelector('[role=dialog] .av-words-q')?.textContent).toBe('“멍멍이가 웃어”');
    expect(document.activeElement?.textContent).toContain(ko.walk.close);
    document.querySelector<HTMLElement>('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    w.unmount();
  });
  it('벽 색을 고르면 장면 벽에 바로 쓰이고 아이마다 저장된다', async () => {
    serve(gal);
    const w = await open();
    await click(w, ko.walk.wall);
    await click(w, ko.walk.wallNames.mint!);
    expect(w.find('.wk').attributes('style')).toContain('--walk-wall: #E0F3EF');
    expect(localStorage.getItem('uam.wall.1')).toBe('#E0F3EF');
    w.unmount();
  });
});
