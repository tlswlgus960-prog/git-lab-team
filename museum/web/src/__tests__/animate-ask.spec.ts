// D49 움직임 질문(SD_02 §17-9): 판정이 움직임을 제안한 그림만 "애니메이션으로 만드시겠습니까?" [예] · [아니오].
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnimateAsk from '../components/AnimateAsk.vue';
import { ko } from '../copy/ko';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
const base = { suggestion: 'animated', confirmedKind: null, choices: ['animated', 'relief', 'frame'], making: false };
function serve(d: object) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST' && String(url).endsWith('/confirm')) return json({ ...d, confirmedKind: 'animated' });
    return json(d);
  });
}
const posts = () => fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/confirm') && i?.method === 'POST');
const btn = (w: ReturnType<typeof mount>, t: string) => w.findAll('button').find((b) => b.text() === t);

beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('움직임 질문(D49)', () => {
  it('움직임 제안 그림이면 묻고, [예]는 animated로 확정한다', async () => {
    serve(base);
    const w = mount(AnimateAsk, { props: { artworkId: '7' } });
    await flushPromises();
    expect(w.text()).toContain(ko.animAsk.q);
    expect(btn(w, ko.animAsk.yes)).toBeTruthy();
    expect(btn(w, ko.animAsk.no)).toBeTruthy();
    await btn(w, ko.animAsk.yes)!.trigger('click');
    await flushPromises();
    expect(JSON.parse(String(posts()[0]![1]!.body))).toEqual({ kind: 'animated' });
    expect(w.text()).toContain(ko.animAsk.started);
    expect(w.emitted('started')).toBeTruthy();
    w.unmount();
  });
  it('[아니오]면 확정하지 않고, 이 기기에서 다시 묻지 않는다', async () => {
    serve(base);
    const w = mount(AnimateAsk, { props: { artworkId: '8' } });
    await flushPromises();
    await btn(w, ko.animAsk.no)!.trigger('click');
    expect(posts()).toHaveLength(0);
    expect(w.text()).not.toContain(ko.animAsk.q);
    w.unmount();
    const again = mount(AnimateAsk, { props: { artworkId: '8' } });
    await flushPromises();
    expect(again.text()).not.toContain(ko.animAsk.q);
    again.unmount();
  });
  it.each([
    ['만들기 작품', { making: true }],
    ['이미 확정', { confirmedKind: 'frame' }],
    ['움직임 선택지 막힘(M3 꺼짐)', { choices: ['frame'] }],
    ['판정이 다른 제안', { suggestion: 'relief' }],
  ])('%s이면 묻지 않는다', async (_n, over) => {
    serve({ ...base, ...over });
    const w = mount(AnimateAsk, { props: { artworkId: '9' } });
    await flushPromises();
    expect(w.text()).not.toContain(ko.animAsk.q);
    expect(w.emitted('closed')).toBeTruthy();
    w.unmount();
  });
  it('판정 전이면 기다렸다가 제안이 오면 묻는다', async () => {
    vi.useFakeTimers();
    let n = 0;
    fetchMock.mockImplementation(async () => json(++n < 2 ? { ...base, suggestion: null } : base));
    const w = mount(AnimateAsk, { props: { artworkId: '10' } });
    await flushPromises();
    expect(w.text()).toContain(ko.animAsk.judging);
    await vi.advanceTimersByTimeAsync(3100);
    await flushPromises();
    expect(w.text()).toContain(ko.animAsk.q);
    w.unmount();
  });
  it('판정이 30초 안에 오지 않으면 묻지 않고 닫는다', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => json({ ...base, suggestion: null }));
    const w = mount(AnimateAsk, { props: { artworkId: '11' } });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(33_000);
    await flushPromises();
    expect(w.text()).not.toContain(ko.animAsk.q);
    expect(w.emitted('closed')).toBeTruthy();
    w.unmount();
  });
  it('[예]가 409(이미 확정)면 다시 읽게 알리고 닫는다 — "만들 수 없어요"로 남지 않음', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => ((init?.method ?? 'GET') === 'POST'
      ? json({ type: 'about:blank', title: 'conflict', status: 409, code: 'conflict', reason: 'already_processing', gate: 'G8' }, 409) : json(base)));
    const w = mount(AnimateAsk, { props: { artworkId: '12' } });
    await flushPromises();
    await btn(w, ko.animAsk.yes)!.trigger('click');
    await flushPromises();
    expect(w.text()).not.toContain(ko.animAsk.fail);
    expect(w.emitted('started')).toBeTruthy();
    expect(w.emitted('closed')).toBeTruthy();
    w.unmount();
  });
  it('overlay는 ready가 된 뒤에만 보이고, 대화상자 · 첫 버튼 초점 · Esc = 나중에(기억 안 함)', async () => {
    serve(base);
    const w = mount(AnimateAsk, { props: { artworkId: '13', overlay: true, ready: false }, attachTo: document.body });
    await flushPromises();
    expect(document.body.textContent).not.toContain(ko.animAsk.q);
    await w.setProps({ ready: true });
    await flushPromises();
    const dlg = w.find('[role="dialog"]');
    expect(dlg.exists()).toBe(true);
    expect(dlg.attributes('aria-labelledby')).toBe(w.find('h2').attributes('id'));
    expect(document.activeElement?.textContent).toBe(ko.animAsk.yes);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.emitted('closed')).toBeTruthy();
    expect(localStorage.getItem('uam.animAsk.13')).toBeNull();
    w.unmount();
  });
  it('인라인(작품 상세)은 대화상자가 아니라 구역이고, 판정 전이면 "살펴보는 중" 작은 글자', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => json({ ...base, suggestion: null }));
    const w = mount(AnimateAsk, { props: { artworkId: '14' } });
    await flushPromises();
    expect(w.find('[role="status"]').text()).toContain(ko.animAsk.judging);
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    w.unmount();
  });
  it('판정 기다리는 작은 알약일 때는 Tab · Esc를 가로채지 않는다(overlay)', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => json({ ...base, suggestion: null }));
    const w = mount(AnimateAsk, { props: { artworkId: '15', overlay: true }, attachTo: document.body });
    await flushPromises();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await flushPromises();
    expect(w.emitted('closed')).toBeFalsy();
    w.unmount();
  });
  it('미술관(overlay) 판정 기다림은 질문 카드 자리의 상태 카드(토스트 아님) — [나중에]로 닫고, 판정이 오면 그 자리에서 질문', async () => {
    vi.useFakeTimers();
    let n = 0;
    fetchMock.mockImplementation(async () => json(++n < 2 ? { ...base, suggestion: null } : base));
    const w = mount(AnimateAsk, { props: { artworkId: '16', overlay: true }, attachTo: document.body });
    await flushPromises();
    expect(w.find('.aa-status').text()).toContain(ko.animAsk.judging);
    expect(btn(w, ko.animAsk.later)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3100);
    await flushPromises();
    expect(w.find('.aa-status').exists()).toBe(false);
    expect(w.find('[role="dialog"]').text()).toContain(ko.animAsk.q);
    w.unmount();
  });
});
