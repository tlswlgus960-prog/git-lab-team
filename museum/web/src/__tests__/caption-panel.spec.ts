// S7 설명 초안 패널(T129, SD_02 §10·§10-5) 시험.
// 핵심 규칙: P0(404)에서는 패널이 없다, 입력이 없으면 초안 만들기 비활성(G14), 보낼 입력에 사진·이름이 없다는 안내,
// AI 초안은 "AI 작성"·직접 쓴 설명은 표시 없음(D6), G15 선택지, template으로 낮추면 G16, 30초 상한, 승인하면 고정.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import CaptionPanel from '../app/views/CaptionPanel.vue';
import type { ArtworkDetail } from '../app/artwork';
import { ko } from '../copy/ko';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: object) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, ...body }), { status, headers: { 'content-type': 'application/problem+json' } });
const cap = (o: object = {}) => ({ id: '9', body: '강아지와 산책한 날을 그렸어요.', source: 'llm', aiAuthored: true, edited: false, state: 'pending_approval', generationCount: 1, ...o });
const art = (o: Partial<ArtworkDetail> = {}) => ({
  id: '7', state: 'approved', caption: null, tagCandidates: ['강아지', '나무'],
  story: { title: '강아지', madeOn: '2026-09-01', ageAtMaking: 6, childWords: '멍멍이가 웃어' }, ...o,
}) as unknown as ArtworkDetail;

let fetchMock: ReturnType<typeof vi.fn>;
let posted: unknown[];
beforeEach(() => { setActivePinia(createPinia()); fetchMock = vi.fn(); posted = []; vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ''; });

function serve(map: Record<string, unknown | ((init?: RequestInit) => Response | Promise<Response>)>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).split('?')[0]}`;
    if (init?.body) posted.push(JSON.parse(String(init.body)));
    const v = map[key];
    if (v === undefined) return json({ code: 'not_found' }, 404);
    return typeof v === 'function' ? (v as (i?: RequestInit) => Response)(init) : json(v, key.startsWith('POST') ? 201 : 200);
  });
}
const STATUS = { 'GET /v1/captions/model-status': { warming: true, maxWaitSeconds: 13, busy: false } };
async function open(a = art()) { const w = mount(CaptionPanel, { props: { artwork: a }, attachTo: document.body }); await flushPromises(); return w; }
const btn = (w: ReturnType<typeof mount>, label: string) => w.findAll('button').find((b) => b.text().startsWith(label));

describe('S7 설명 초안 패널(T129)', () => {
  it('P0(설명 기능 꺼짐, 404)에서는 패널이 없다', async () => {
    serve({});
    const w = await open();
    expect(w.find('.caption-panel').exists()).toBe(false);
  });

  it('입력이 없으면 초안 만들기 비활성, 보낼 입력 미리보기에 사진·이름 제외 안내와 저장된 이야기 값', async () => {
    serve(STATUS);
    const w = await open();
    expect(w.text()).toContain(ko.caption.input);
    expect(w.text()).toContain('멍멍이가 웃어');
    expect(w.text()).toContain(ko.caption.warming(13));
    expect(w.text()).toContain(ko.caption.noDraft);
    expect(btn(w, ko.caption.make)!.attributes('aria-disabled') ?? btn(w, ko.caption.make)!.attributes('disabled')).toBeDefined();
    expect(w.text()).not.toContain('강아지.png');
  });

  it('초안 만들기 → AI 작성 초안 → 승인하면 고정', async () => {
    serve({ ...STATUS, 'POST /v1/artworks/7/captions': cap(), 'PUT /v1/artworks/7/captions/9': cap({ state: 'approved' }) });
    const w = await open();
    await w.find('#cp-kw').setValue('산책, 공원');
    await w.findAll('.chip input')[0]!.setValue(true);
    expect(w.text()).toContain('산책 공원');
    await btn(w, ko.caption.make)!.trigger('click'); await flushPromises();
    expect(posted[0]).toEqual({ keywords: ['산책', '공원'], selectedTags: ['강아지'] });
    expect(w.find('.badge').text()).toBe(ko.caption.ai);
    await btn(w, ko.caption.approve)!.trigger('click'); await flushPromises();
    expect(posted[1]).toEqual({ action: 'approve' });
    expect(w.text()).toContain(ko.caption.locked);
    expect(w.find('#cp-kw').exists()).toBe(false);
  });

  it('LLM 장애(G15)면 세 가지 선택지, 기본 문장으로 받기는 template 요청', async () => {
    let n = 0;
    serve({ ...STATUS, 'POST /v1/artworks/7/captions': () => (n++ === 0
      ? problem(503, { code: 'llm_unavailable', reason: 'timeout', gate: 'G15' }) : json(cap({ source: 'template', aiAuthored: true }), 201)) });
    const w = await open();
    await w.find('#cp-kw').setValue('산책');
    await btn(w, ko.caption.make)!.trigger('click'); await flushPromises();
    for (const l of [ko.caption.template, ko.caption.later, ko.caption.writeDirect]) expect(btn(w, l)).toBeTruthy();
    await btn(w, ko.caption.template)!.trigger('click'); await flushPromises();
    expect(posted[1]).toMatchObject({ fallback: 'template' });
    expect(w.text()).not.toContain(ko.caption.g16); // 보호자가 고른 기본 문장은 낮춤이 아니다
  });

  it('초안 만들기로 요청했는데 template으로 오면 G16 안내', async () => {
    serve({ ...STATUS, 'POST /v1/artworks/7/captions': cap({ source: 'template' }) });
    const w = await open();
    await w.find('#cp-kw').setValue('산책');
    await btn(w, ko.caption.make)!.trigger('click'); await flushPromises();
    expect(w.text()).toContain(ko.caption.g16);
  });

  it('버리고 직접 쓰기 → 초안 폐기 후 direct로 저장, AI 작성 표시 없음', async () => {
    serve({ ...STATUS, 'PUT /v1/artworks/7/captions/9': cap({ state: 'discarded' }),
      'POST /v1/artworks/7/captions': cap({ id: '10', source: 'direct', aiAuthored: false, body: '내가 쓴 설명' }) });
    const w = await open(art({ caption: cap() as never }));
    await btn(w, ko.caption.toDirect)!.trigger('click'); await flushPromises();
    expect(posted[0]).toEqual({ action: 'discard' });
    expect((w.find('#cp-direct').element as HTMLTextAreaElement).value).toBe(cap().body);
    await w.find('#cp-direct').setValue('내가 쓴 설명');
    await btn(w, ko.caption.save)!.trigger('click'); await flushPromises();
    expect(posted[1]).toMatchObject({ fallback: 'direct', body: '내가 쓴 설명' });
    expect(w.find('.badge').text()).toBe(ko.caption.direct);
  });

  it('30초 호출자 상한을 넘기면 G15 선택지를 먼저 보인다', async () => {
    vi.useFakeTimers();
    serve({ ...STATUS, 'POST /v1/artworks/7/captions': () => new Promise<Response>(() => {}) });
    const w = await open();
    await w.find('#cp-kw').setValue('산책');
    await btn(w, ko.caption.make)!.trigger('click');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(btn(w, ko.caption.template)).toBeTruthy();
    expect(w.text()).toContain(ko.caption.writing(30));
  });

  it('승인한 설명이 있으면 고정으로 연다(재생성 불가)', async () => {
    serve(STATUS);
    const w = await open(art({ caption: cap({ state: 'approved' }) as never }));
    expect(w.text()).toContain(ko.caption.locked);
    expect(btn(w, ko.caption.make)).toBeUndefined();
  });
});
