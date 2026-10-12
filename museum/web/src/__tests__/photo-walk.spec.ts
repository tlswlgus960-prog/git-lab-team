// 1인칭 고전 회랑 배치(D33, SD_02 §17-9): 입구 쪽이 최근 나이, 구역 안은 최근 작품부터 좌우 번갈아, 깊이(96m)를 넘으면 걸지 않는다.
import { describe, expect, it } from 'vitest';
import { layout, ZMAX, ZMIN } from '../app/walkphoto/engine';

const art = (id: string, age: number, madeOn: string) => ({ id, title: id, age, madeOn, src: null });
describe('고전 회랑 배치', () => {
  it('최근 나이가 입구 쪽, 구역 안은 최근 작품부터 좌우 번갈아', () => {
    const { sections, hung } = layout([
      { age: 5, items: [art('a', 5, '2024-01-01'), art('b', 5, '2024-05-01')] },
      { age: 7, items: [art('c', 7, '2026-01-01')] },
    ]);
    expect(sections.map((s) => s.age)).toEqual([7, 5]);
    expect(sections[0]!.z0).toBeGreaterThan(ZMIN);
    expect(hung.map((h) => h.art.id)).toEqual(['c', 'b', 'a']);
    expect(hung.map((h) => h.side)).toEqual([-1, -1, 1]);
    expect(hung[1]!.z).toBeGreaterThan(hung[0]!.z);
  });
  it('깊이를 넘는 작품은 걸지 않는다(나머지는 목록)', () => {
    const many = Array.from({ length: 80 }, (_, i) => art(`x${i}`, 6, `2025-01-${String((i % 28) + 1).padStart(2, '0')}`));
    const { hung } = layout([{ age: 6, items: many }]);
    expect(hung.length).toBeLessThan(80);
    expect(Math.max(...hung.map((h) => h.z))).toBeLessThanOrEqual(ZMAX);
  });
});

// 나이 미정 구역 · 제목 권유(D34 ③, SD_02 §17-9) — B API가 ageAtMaking null · titleAuto를 주면 나타난다
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ArtViewer from '../app/walk/ArtViewer.vue';
import { roomNumbers } from '../app/museumTheme';
import { ko } from '../copy/ko';

describe('나이 미정 · 제목 권유', () => {
  it('회랑은 나이 미정이 입구 쪽 맨 앞, 목록 번호는 맨 뒤, 명패는 "나이 미정"', () => {
    const { sections } = layout([{ age: 6, items: [art('a', 6, '2025-01-01')] }, { age: null, items: [art('n', 0, '2026-09-30')] }]);
    expect(sections.map((s) => s.age)).toEqual([null, 6]);
    const no = roomNumbers([{ ageAtMaking: null }, { ageAtMaking: 5 }]);
    expect([no.get(5), no.get(null)]).toEqual([1, 2]);
    expect(ko.museum.plaque('2026-09-30', null)).toBe('2026-09-30 · 나이 미정');
    expect(ko.photo.room(null)).toBe('나이 미정 전시실');
  });
  it('D46: 올린 작품은 고정 — 자동 제목이어도 크게 보기에 "제목을 붙여 줄까요?" · 이야기 고치기 링크가 없다', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
    const item = { id: '9', kind: 'frame', originalUrl: '/f', title: '제목 없는 그림 1', madeOn: '2026-09-30', ageAtMaking: 6, childWords: null };
    const w = mount(ArtViewer, { props: { item: { ...item, titleAuto: true } as never, alias: '하늘', still: '/f' }, global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    expect(w.find('.av-ask').exists()).toBe(false);
    expect(w.find('a[href$="/story"]').exists()).toBe(false);
    w.unmount();
    const v = mount(ArtViewer, { props: { item: item as never, alias: '하늘', still: '/f' }, global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    expect(v.find('.av-ask').exists()).toBe(false);
    v.unmount();
  });
});
