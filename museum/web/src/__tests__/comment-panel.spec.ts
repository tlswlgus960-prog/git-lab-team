// D46 ④⑧⑨ 가족 코멘트(SD_02 §17-14): 7일 기한은 내부 규칙 — 화면에 기한 · 남은 날 · 끝남 안내 없음, 지나면(또는 409) 입력 · [지우기]만 조용히 사라짐.
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommentPanel from '../components/CommentPanel.vue';
import { ko } from '../copy/ko';

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const closed409 = () => json({ type: 'about:blank', title: 'conflict', status: 409, code: 'conflict', reason: 'comments_closed' }, 409);
const c1 = { id: '1', body: '멋지다', createdAt: '2026-09-30T01:00:00.000Z', mine: true, author: 'me' };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('가족 코멘트(D46 ⑨)', () => {
  it('기한 안: 입력 · 내 코멘트 [지우기] — 기한 · 남은 날은 보이지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
    fetchMock.mockImplementation(async () => json({ items: [c1], open: true, openUntil: '2026-10-02T12:00:00.000Z', days: 7 }));
    const w = mount(CommentPanel, { props: { artworkId: '7' } });
    await flushPromises();
    expect(w.text()).not.toMatch(/7일|남았어요|기간/);
    expect(w.text()).toContain(ko.comment.title);
    expect(w.find('textarea').exists()).toBe(true);
    expect(w.findAll('button').some((b) => b.text() === ko.comment.del)).toBe(true);
    w.unmount();
  });
  it('기한 지남: 조용히 보기만(입력 · 지우기 없음, 끝남 안내 없음)', async () => {
    fetchMock.mockImplementation(async () => json({ items: [c1], open: false, openUntil: '2026-09-01T00:00:00.000Z', days: 7 }));
    const w = mount(CommentPanel, { props: { artworkId: '7' } });
    await flushPromises();
    expect(w.text()).toContain('멋지다');
    expect(w.text()).not.toMatch(/7일|남았어요|기간|끝났어요/);
    expect(w.find('textarea').exists()).toBe(false);
    expect(w.findAll('button').some((b) => b.text() === ko.comment.del)).toBe(false);
    w.unmount();
  });
  it('지우는 사이 기한이 끝나면(409) 조용히 보기만으로 바꾼다', async () => {
    fetchMock.mockImplementation(async (_u: string, i?: RequestInit) => (i?.method === 'DELETE' ? closed409()
      : json({ items: [c1], open: true, openUntil: '2099-01-01T00:00:00.000Z', days: 7 })));
    const w = mount(CommentPanel, { props: { artworkId: '7' } });
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === ko.comment.del)!.trigger('click');
    await flushPromises();
    expect(w.find('textarea').exists()).toBe(false);
    expect(w.text()).toContain('멋지다');
    expect(w.text()).not.toMatch(/기간|끝났어요|못했어요/);
    w.unmount();
  });
  it('불러오기 실패는 [다시 불러오기]', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('network'); });
    const w = mount(CommentPanel, { props: { artworkId: '7' } });
    await flushPromises();
    expect(w.text()).toContain(ko.comment.loadFail);
    expect(w.findAll('button').some((b) => b.text() === ko.comment.retry)).toBe(true);
    w.unmount();
  });
});
