// D40 캐릭터 만들기 시험(SD_02 §17-13 A · D): 캐릭터 8×6 · 건물 8 · 만들기 4단계 · 바꾸기(PATCH).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import CharacterAvatar from '../app/character/CharacterAvatar.vue';
import MuseumBuilding from '../app/character/MuseumBuilding.vue';
import CharacterCreateView from '../app/views/CharacterCreateView.vue';
import { cc } from '../app/character/copy';
import { COLORS, COLOR_NAME, KINDS, KIND_NAME, STYLES, STYLE_NAME } from '../app/character/names';

const Stub = { template: '<div />' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: object) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, ...body }), { status, headers: { 'content-type': 'application/problem+json' } });

let router: Router;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setActivePinia(createPinia());
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: Stub }] });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function open(url: string) {
  await router.push(url);
  await router.isReady();
  const w = mount(CharacterCreateView, { global: { plugins: [router], stubs: { RouterLink: { props: ['to'], template: '<a :href="String(to)"><slot /></a>' } } }, attachTo: document.body });
  await flushPromises();
  return w;
}
const bodyOf = (i: number) => JSON.parse(String(fetchMock.mock.calls[i]![1]!.body));
const btn = (w: ReturnType<typeof mount>, label: string) => w.findAll('button').find((b) => b.text().startsWith(label))!;
const stepOf = (w: ReturnType<typeof mount>) => w.find('[data-step]').attributes('data-step');

describe('캐릭터 그림(CharacterAvatar)', () => {
  it('8종 × 6색 모두 그려지고 이름이 "{색}색 {동물}"이다', () => {
    for (const k of KINDS) for (const c of COLORS) {
      const w = mount(CharacterAvatar, { props: { kind: k, color: c } });
      const svg = w.get('svg[role="img"]');
      expect(svg.attributes('aria-label')).toBe(`${COLOR_NAME[c]}색 ${KIND_NAME[k]}`);
      expect(svg.findAll('circle, ellipse, polygon, path').length).toBeGreaterThan(8);
      w.unmount();
    }
    expect(mount(CharacterAvatar, { props: { kind: 'bear', color: 'sunflower' } }).attributes('aria-label')).toBeUndefined();
  });
  it('spinning이면 도는 클래스', () => {
    const w = mount(CharacterAvatar, { props: { kind: 'owl', color: 'sky', spinning: true, size: 80 } });
    expect(w.classes()).toContain('spin');
    expect(w.get('svg').attributes('width')).toBe('80');
  });
});

describe('미술관 건물(MuseumBuilding)', () => {
  it('8가지 모양이 모두 그려지고 문이 있다, 잠기면 자물쇠', () => {
    for (const s of STYLES) {
      const w = mount(MuseumBuilding, { props: { museumStyle: s } });
      expect(w.get('svg').attributes('aria-label')).toBe(STYLE_NAME[s]);
      expect(w.find('.door').exists()).toBe(true);
      expect(w.find('[data-lock]').exists()).toBe(false);
      w.unmount();
      const l = mount(MuseumBuilding, { props: { museumStyle: s, locked: true, color: 'leaf' } });
      expect(l.find('[data-lock]').exists()).toBe(true);
      expect(l.get('svg').attributes('aria-label')).toContain('잠겨');
      l.unmount();
    }
  });
});

describe('캐릭터 만들기(/app/children/new)', () => {
  it('이름이 비었거나 21자면 ①에서 넘어가지 않는다', async () => {
    const w = await open('/app/children/new');
    expect(stepOf(w)).toBe('1');
    const next = () => btn(w, cc.next);
    expect(next().attributes('aria-disabled')).toBe('true');
    await next().trigger('click');
    await w.find('form').trigger('submit');
    expect(stepOf(w)).toBe('1');
    await w.find('#cc-alias').setValue('가'.repeat(21));
    expect(next().attributes('aria-disabled')).toBe('true');
    expect(w.find('#cc-next-why').text()).toContain('20자까지'); // 이유는 버튼 아래 한 줄(세션2 판별 A8)
    await next().trigger('click');
    expect(stepOf(w)).toBe('1');
    await w.find('#cc-alias').setValue('   ');
    await next().trigger('click');
    expect(stepOf(w)).toBe('1');
    expect(fetchMock).not.toHaveBeenCalled();
    w.unmount();
  });

  it('네 단계를 지나 리본을 자르면 {alias, character, color, museumStyle}만 보내고 미술관으로 간다', async () => {
    fetchMock.mockResolvedValue(json(201, { id: 'c9', alias: '별이', character: 'fox', color: 'sky', museumStyle: 'glass_pyramid' }));
    const w = await open('/app/children/new');
    await w.find('#cc-alias').setValue('  별이 ');
    await btn(w, cc.next).trigger('click');
    expect(stepOf(w)).toBe('2');
    expect(w.get('[data-test="live"]').text()).toBe(cc.stepOf(2, 4, '캐릭터 고르기'));
    await w.find('input[name="cc-kind"][value="fox"]').setValue(true);
    await w.find('input[name="cc-color"][value="sky"]').setValue(true);
    expect(w.find('.stage svg').attributes('aria-label')).toBe('하늘색 여우');
    await btn(w, cc.next).trigger('click');
    expect(stepOf(w)).toBe('3');
    // 기본 기둥 신전 → 이전 두 번 = 유리 피라미드
    expect(w.text()).toContain(STYLE_NAME.column_temple);
    await w.find(`button[aria-label="${cc.prevStyle}"]`).trigger('click');
    await w.find(`button[aria-label="${cc.prevStyle}"]`).trigger('click');
    expect(w.text()).toContain(STYLE_NAME.glass_pyramid);
    await btn(w, cc.next).trigger('click');
    expect(stepOf(w)).toBe('4');
    expect(fetchMock).not.toHaveBeenCalled();
    await btn(w, cc.cutRibbon).trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls[0]![0]).toBe('/v1/children');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
    expect(bodyOf(0)).toEqual({ alias: '별이', character: 'fox', color: 'sky', museumStyle: 'glass_pyramid' });
    expect(w.text()).toContain('별이의 미술관이 문을 열었어요');
    expect(w.emitted('created')).toHaveLength(1);
    await btn(w, cc.enter).trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/app/museum/c9');
    w.unmount();
  });

  it('서버가 별칭을 막으면(422 G4) ①로 돌아가 차단 블록을 보인다', async () => {
    fetchMock.mockResolvedValue(problem(422, { code: 'validation', reason: 'alias_too_long', gate: 'G4' }));
    const w = await open('/app/children/new');
    await w.find('#cc-alias').setValue('별이');
    await btn(w, cc.next).trigger('click');
    await btn(w, cc.next).trigger('click');
    await btn(w, cc.next).trigger('click');
    await btn(w, cc.cutRibbon).trigger('click');
    await flushPromises();
    expect(stepOf(w)).toBe('1');
    expect(w.find('[data-gate="G4"]').text()).toContain('20자까지');
    w.unmount();
  });

  it('바꾸기(?edit=)는 ②에서 시작하고 별칭과 함께 PATCH, 끝나면 우리 아이로', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, [{ id: 'c1', alias: '하늘', character: 'cat', color: 'peach', museumStyle: 'hanok_roof' }, { id: 'c2', alias: '별이' }]))
      .mockResolvedValueOnce(json(200, { id: 'c1', alias: '하늘' }));
    const w = await open('/app/children/new?edit=c1');
    expect(stepOf(w)).toBe('2');
    expect(w.findAll('.dot-btn')).toHaveLength(2);
    expect(w.find('.stage svg').attributes('aria-label')).toBe('복숭아색 고양이');
    await w.find('input[name="cc-kind"][value="owl"]').setValue(true);
    await btn(w, cc.next).trigger('click');
    expect(w.text()).toContain(STYLE_NAME.hanok_roof);
    await w.find(`button[aria-label="${cc.nextStyle}"]`).trigger('click');
    await btn(w, cc.saveEdit).trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls[1]![0]).toBe('/v1/children/c1');
    expect(fetchMock.mock.calls[1]![1]!.method).toBe('PATCH');
    expect(bodyOf(1)).toEqual({ alias: '하늘', character: 'owl', color: 'peach', museumStyle: 'silver_wave' });
    expect(router.currentRoute.value.path).toBe('/app/children');
    w.unmount();
  });

  it('바꿀 아이가 없으면 안내', async () => {
    fetchMock.mockResolvedValue(json(200, []));
    const w = await open('/app/children/new?edit=zz');
    expect(w.text()).toContain(cc.notFound);
    w.unmount();
  });
});

describe('문구', () => {
  it('점수·확률·실패 표현과 느낌표가 없다', () => {
    const all = JSON.stringify(cc) + Object.values(cc).filter((v) => typeof v === 'function').map((f) => (f as (...a: unknown[]) => string)('별이', '별이', '별이')).join('');
    for (const bad of ['점수', '확률', '%', '실패했', '!']) expect(all).not.toContain(bad);
  });
});
