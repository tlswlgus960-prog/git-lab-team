// 견본 미술관(D48 ①, SD_02 §17-17): 방 3개 · 벽 그림 9점 이상 · 만들기 작품은 가운데 홀 받침대 · 목록의 그림 파일이 모두 있음 ·
// 서버를 한 번도 부르지 않음(fetch를 부르면 실패) · 위 띠와 [카카오로 시작하기](로그인, next=/app) · [밖으로] = 입장 화면.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { buildMuseumLayout } from '../app/museum3d/layout';
import { buildSampleInput, SAMPLE_BASE, SAMPLE_MAKING, SAMPLE_WORKS } from '../app/museum3d/sample';
import { m3 } from '../app/museum3d/copy';
import SampleMuseumView from '../app/views/SampleMuseumView.vue';
import Viewer from '../app/museum3d/Viewer.vue';

const dir = resolve(process.cwd(), 'public/museum/sample');
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as { works: { file: string; title: string; kind: string; age: number }[]; making: { file: string; title: string; kind: string }[] };

describe('견본 미술관 자료', () => {
  it('견본이 · 곰 · 해바라기 · 방 3개(7 · 6 · 5살) · 벽 그림 9점 이상', () => {
    const inp = buildSampleInput();
    expect([inp.childAlias, inp.character, inp.color, inp.museumStyle, inp.visitor]).toEqual(['견본이', 'bear', 'sunflower', 'column_temple', false]);
    const L = buildMuseumLayout(inp);
    expect(L.rooms.map((r) => r.label)).toEqual([m3.ageRoom(7), m3.ageRoom(6), m3.ageRoom(5)]);
    expect(L.frames.length).toBeGreaterThanOrEqual(9);
  });
  it('만들기 작품은 가운데 홀 받침대에(방 진열대는 빈 받침)', () => {
    const L = buildMuseumLayout(buildSampleInput());
    expect(L.plinths.filter((p) => p.item).map((p) => p.item!.title)).toEqual(SAMPLE_MAKING.map((w) => w.title));
    expect(L.pedestals.every((p) => p.item === null)).toBe(true);
  });
  it('작품마다 짧은 해요체 해설(개발 용어 · 금지 글자 없음)', () => {
    const inp = buildSampleInput();
    const all = [...inp.groups.flatMap((g) => g.items), ...(inp.hallMaking ?? [])];
    for (const it of all) {
      expect(it.caption).toMatch(/요\.$/);
      for (const bad of ['점수', '확률', '%', '실패했', '!', '판정', '모델', '서버', 'API', '토큰', '깊이 정보', '에러', '(를)', '(는)']) expect(it.caption!.includes(bad), `${it.title} ${bad}`).toBe(false);
    }
  });
  it('manifest.json = sample.ts 목록이고, 모든 그림 파일이 있다(SVG)', () => {
    expect(manifest.works.map((w) => [w.file, w.title, w.kind, w.age])).toEqual(SAMPLE_WORKS.map((w) => [w.file, w.title, w.kind, w.age]));
    expect(manifest.making.map((w) => [w.file, w.title, w.kind])).toEqual(SAMPLE_MAKING.map((w) => [w.file, w.title, w.kind]));
    for (const w of [...manifest.works, ...manifest.making]) {
      const f = resolve(dir, w.file);
      expect(existsSync(f), w.file).toBe(true);
      expect(readFileSync(f, 'utf8')).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    }
    expect(SAMPLE_BASE).toBe('/museum/sample/');
  });
});

describe('SampleMuseumView', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });
  it('서버를 부르지 않고 열리며, 띠 · 로그인 버튼 · 바깥 광장 · [밖으로]가 맞다', async () => {
    const fetch = vi.fn(() => { throw new Error('견본 미술관은 서버를 부르면 안 돼요'); });
    vi.stubGlobal('fetch', fetch);
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/app/sample', component: SampleMuseumView }, { path: '/:p(.*)*', component: { template: '<div />' } }] });
    await router.push('/app/sample'); await router.isReady();
    const w = mount({ template: '<RouterView />' }, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    expect(fetch).not.toHaveBeenCalled();
    expect(w.find('.sm-band').text()).toContain(m3.sampleBanner);
    const go = w.find('.sm-band a');
    expect(go.text()).toBe(m3.sampleStart);
    expect(go.attributes('href')).toBe('/app/login?next=/app');
    expect(w.find('[role=region]').attributes('aria-label')).toBe(m3.scene('견본이'));
    expect(w.findAll('button[aria-label$="— 가까이 가기"]').length).toBeGreaterThanOrEqual(11);
    expect(w.findAll('.m3-bar button').map((b) => b.text())).toEqual([m3.lobby, m3.hall, m3.ageRoom(7), m3.ageRoom(6), m3.ageRoom(5)]);
    expect(w.find('.m3-me').exists()).toBe(true);
    // D52 C: 바깥 광장에서 시작 — [들어가기] · [카카오로 시작하기]
    const ex = w.find('.ex');
    expect(ex.findAll('.ex-b').map((b) => b.text())).toEqual([m3.enter, m3.sampleStart]);
    expect(ex.find('a.ex-b').attributes('href')).toBe('/app/login?next=/app');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    await ex.find('button.ex-b').trigger('click'); await flushPromises();
    expect(w.find('.ex').exists()).toBe(false);
    await w.find('.m3-exit').trigger('click'); await flushPromises(); // 안의 [밖으로] = 광장
    expect(w.find('.ex').exists()).toBe(true);
    expect(w.find('.m3-invite').exists()).toBe(false); // 견본엔 친구 초대 없음
    expect(fetch).not.toHaveBeenCalled();
    w.unmount();
  });

  it('크게 보기 = 그림 · 제목 · 해설만(저장 · 올리기 없음)', () => {
    const item = buildSampleInput().groups[0]!.items[0]!;
    const v = mount(Viewer, { props: { item, alias: '견본이' }, attachTo: document.body });
    const t = v.text();
    expect(t).toContain(item.title!); expect(t).toContain(item.caption!);
    expect(t).not.toMatch(/저장|올리기|이웃/);
    expect(v.find('img').attributes('src')).toBe(item.imageUrl);
    const sp = v.findComponent({ name: 'SpeakButton' });
    expect(sp.exists()).toBe(true);
    expect(sp.props('parts')).toEqual([item.title, item.caption]); // 견본 = 제목 + 해설
    v.unmount();
  });
});
