// D40 미술관 마을 · 이웃 시험(SD_02 §17-13 D·E, UC_16): 배치(격자 → 아이소메트릭) · 마을 화면(모르는 가족은 자물쇠, 누르면 로비 → 미술관 주소) · 이웃 칸 · 받기.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import TownView from '../app/views/TownView.vue';
import NeighborAcceptView from '../app/views/NeighborAcceptView.vue';
import NeighborPanel from '../app/town/NeighborPanel.vue';
import { neighbor as nc, town as tc } from '../app/town/copy';
import { clampPan, iso, layoutTown, museumPath, type TownBuildingDto } from '../app/town/layout';

const Stub = { template: '<div />' };
const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: object) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, ...body }), { status, headers: { 'content-type': 'application/problem+json' } });

const TOWN: TownBuildingDto[] = [
  { id: 'b_mine000000000000', x: 1, y: 0, relation: 'mine', style: 'hanok_roof', children: [{ id: '7', alias: '하늘', character: 'fox', color: 'peach', museumStyle: 'hanok_roof' }] },
  { id: 'b_nb00000000000000', x: 2, y: 0, relation: 'neighbor', style: null, children: [{ id: '9', alias: '별이', character: null, color: null, museumStyle: null }] },
  { id: 'b_st00000000000000', x: 0, y: 1, relation: 'stranger', style: 'golden_dome' },
];

let router: Router;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setActivePinia(createPinia());
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: Stub }] });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

async function mountAt(C: object, url = '/app/town') {
  await router.push(url);
  await router.isReady();
  const w = mount(C, { global: { plugins: [router], stubs: { RouterLink: { props: ['to'], template: '<a :href="String(to)"><slot /></a>' } } }, attachTo: document.body });
  await flushPromises();
  return w;
}

describe('마을 배치(layoutTown)', () => {
  it('격자 칸을 아이소메트릭 좌표로, 판 안(0 이상)에 두고 뒤에서 앞 순서로 그린다', () => {
    const l = layoutTown(TOWN);
    expect(iso(1, 0)).toEqual({ cx: 180, cy: 90 });
    for (const b of l.buildings) { expect(b.cx).toBeGreaterThan(0); expect(b.cy).toBeGreaterThan(0); expect(b.cx).toBeLessThan(l.width); expect(b.cy).toBeLessThan(l.height); }
    const ys = l.buildings.map((b) => b.cy);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
  it('모양이 없거나 틀리면 기본 모양, 캐릭터는 없으면 null, 모르는 가족은 아이 없음', () => {
    const l = layoutTown(TOWN);
    const nb = l.buildings.find((b) => b.relation === 'neighbor')!;
    expect(nb.style).toBe('column_temple');
    expect(nb.children[0]).toMatchObject({ alias: '별이', kind: null, color: null });
    expect(l.buildings.find((b) => b.relation === 'stranger')!.children).toEqual([]);
    expect(layoutTown([]).buildings).toEqual([]);
  });
  it('끌기는 판 밖으로 나가지 않고, 판이 작으면 가운데', () => {
    expect(clampPan({ x: 50, y: -9999 }, { w: 400, h: 300 }, { w: 1000, h: 800 })).toEqual({ x: 0, y: -500 });
    expect(clampPan({ x: 50, y: 50 }, { w: 400, h: 300 }, { w: 200, h: 100 })).toEqual({ x: 100, y: 100 });
  });
  it('내 아이는 내 미술관, 이웃 아이는 방문 주소', () => {
    expect(museumPath('7', 'mine')).toBe('/app/museum/7');
    expect(museumPath('9', 'neighbor')).toBe('/app/museum/9?visit=1');
  });
});

describe('마을 화면(TownView)', () => {
  it('건물 3채, 모르는 가족은 자물쇠 이름 · 아이 별칭 간판 없음, 미니맵 오른쪽 아래', async () => {
    fetchMock.mockResolvedValue(json(200, { buildings: TOWN }));
    const w = await mountAt(TownView);
    const blds = w.findAll('button.bld');
    expect(blds).toHaveLength(3);
    expect(blds.map((b) => b.attributes('aria-label'))).toContain(`${tc.stranger} — ${tc.locked}`);
    expect(w.findAll('.lot.stranger .sign')).toHaveLength(0);
    expect(w.find('.lot.neighbor .sign').text()).toContain('별이');
    expect(w.find('nav.minimap').exists()).toBe(true);
    expect(w.findAll('.map .dot')).toHaveLength(3);
  });
  it('이웃 건물을 누르면 로비 → 아이 미술관 문 → 방문 주소로 간다', async () => {
    fetchMock.mockResolvedValue(json(200, { buildings: TOWN }));
    const w = await mountAt(TownView);
    await w.find('.lot.neighbor button.bld').trigger('click');
    await flushPromises();
    expect(w.find('.lobby h2').text()).toBe(tc.neighbor);
    await w.find('.lobby button.door').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/app/museum/9?visit=1');
  });
  it('모르는 가족 건물은 들어가는 문이 없다', async () => {
    fetchMock.mockResolvedValue(json(200, { buildings: TOWN }));
    const w = await mountAt(TownView);
    await w.find('.lot.stranger button.bld').trigger('click');
    await flushPromises();
    expect(w.find('.lobby').text()).toContain(tc.locked);
    expect(w.findAll('.lobby button.door')).toHaveLength(0);
  });
  it('불러오기 안 되면 다시 해 보기', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const w = await mountAt(TownView);
    expect(w.find('[role="alert"]').text()).toContain(tc.unavailable);
  });
});

describe('이웃 칸(NeighborPanel) · 받기(NeighborAcceptView)', () => {
  it('링크 만들기 → 복사, 이웃 목록과 끊기 확인', async () => {
    const nb = [TOWN[1]];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const m = init?.method ?? 'GET';
      if (url === '/v1/neighbors' && m === 'GET') return json(200, nb);
      if (url === '/v1/neighbors/invites' && m === 'GET') return json(200, []);
      if (url === '/v1/neighbors/invites' && m === 'POST') return json(201, { id: '1', link: 'http://x/app/neighbor?token=abc', expiresAt: '2026-10-07T00:00:00Z' });
      if (url.startsWith('/v1/neighbors/b_') && m === 'DELETE') { nb.length = 0; return json(204, null); }
      return json(404, {});
    });
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const w = await mountAt(NeighborPanel, '/app/family');
    expect(w.text()).toContain('별이');
    await w.findAll('button').find((b) => b.text() === nc.copy)!.trigger('click');
    await flushPromises();
    expect(write).toHaveBeenCalledWith('http://x/app/neighbor?token=abc');
    expect(w.text()).toContain(nc.copied);
    await w.findAll('button').find((b) => b.text() === nc.unlink)!.trigger('click');
    expect(w.find('[role="alertdialog"]').text()).toContain(nc.unlinkConfirm);
    await w.findAll('button').find((b) => b.text() === nc.unlinkGo)!.trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls.some(([u, i]) => u === '/v1/neighbors/b_nb00000000000000' && i?.method === 'DELETE')).toBe(true);
    expect(w.text()).toContain(nc.none);
  });
  it('받기: 성공이면 마을로, 자기 가족 링크 · 끝난 링크는 알맞은 말', async () => {
    fetchMock.mockResolvedValueOnce(problem(409, { code: 'conflict', reason: 'own_family' }));
    let w = await mountAt(NeighborAcceptView, '/app/neighbor?token=tok-1234567890');
    await w.find('button.g-btn--primary').trigger('click'); await flushPromises();
    expect(w.find('[role="alert"]').text()).toBe(nc.ownFamily);
    expect(w.find('button.g-btn--primary').exists()).toBe(false); // 다시 눌러도 소용없으면 [마을로 가기](판별 A2-8)
    expect(w.find('a[href="/app/town"]').text()).toBe(nc.toTown);
    w.unmount();
    fetchMock.mockResolvedValueOnce(problem(400, { code: 'token_invalid', reason: 'token_invalid' }));
    w = await mountAt(NeighborAcceptView, '/app/neighbor?token=tok-1234567890');
    await w.find('button.g-btn--primary').trigger('click'); await flushPromises();
    expect(w.find('[role="alert"]').text()).toBe(nc.tokenInvalid);
    expect(w.find('a[href="/app/town"]').exists()).toBe(true);
    w.unmount();
    fetchMock.mockRejectedValueOnce(new TypeError('network')); // 끊김은 잠시 뒤 다시 — 버튼 그대로
    w = await mountAt(NeighborAcceptView, '/app/neighbor?token=tok-1234567890');
    await w.find('button.g-btn--primary').trigger('click'); await flushPromises();
    expect(w.find('[role="alert"]').text()).toBe(nc.tryLater);
    expect(w.find('button.g-btn--primary').exists()).toBe(true);
    w.unmount();
    fetchMock.mockResolvedValueOnce(json(204, null));
    w = await mountAt(NeighborAcceptView, '/app/neighbor?token=tok-1234567890');
    await w.find('button.g-btn--primary').trigger('click'); await flushPromises();
    expect(w.text()).toContain(nc.accepted);
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))).toEqual({ token: 'tok-1234567890' });
  });
  it('말 파일에 금지어가 없다', async () => {
    const all = JSON.stringify({ ...tc, ...nc }) + [tc.lobby(0), tc.lobby(2), tc.museumOf('가'), nc.expires('가'), nc.list(2), nc.childrenOf([]), nc.childrenOf(['가'])].join();
    for (const bad of ['점수', '확률', '%', '실패했', '!']) expect(all).not.toContain(bad);
  });
});
