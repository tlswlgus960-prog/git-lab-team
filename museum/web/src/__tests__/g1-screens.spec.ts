// G-1(액자 경로 한 바퀴) 화면 시험: S4 목록·상세(T080), S2 올리기(T066), S3 확정(T067), S5 결과(T094), S6 이야기(T095), S8 전시(T096), S0o(T055).
// 핵심 규칙: 선택지는 API가 준 것만·기본 선택 없음(UX2), 비활성 선택지는 사유 달린 C3, 판정 모델 비활성이면 G7 블록 없음(SD_02 §6-2),
// 처리하지 못함은 낮춘 결과가 아님(G9), 한마디는 적은 그대로, 동시 수정은 내 입력을 남긴다, 전시에는 낮춤 표시가 없다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { Component } from 'vue';
import ArtworksView from '../app/views/ArtworksView.vue';
import ArtworkDetailView from '../app/views/ArtworkDetailView.vue';
import UploadView from '../app/views/UploadView.vue';
import ConfirmView from '../app/views/ConfirmView.vue';
import ReviewView from '../app/views/ReviewView.vue';
import StoryView from '../app/views/StoryView.vue';
import MuseumView from '../app/views/MuseumView.vue';
import PaperHomeView from '../app/views/PaperHomeView.vue';
import WelcomeView from '../app/views/WelcomeView.vue';
import { isFirstVisit } from '../app/entrance';
import OpsLoginView from '../ops/views/OpsLoginView.vue';
import FamilyView from '../app/views/FamilyView.vue';
import InviteAcceptView from '../app/views/InviteAcceptView.vue';
import NoFamilyView from '../app/views/NoFamilyView.vue';
import { routeFor } from '../app/artwork';
import { ko } from '../copy/ko';
import { home as hc } from '../app/town/copy';
import { roomLabel } from '../app/museumTheme';

const Stub = { template: '<div />' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: object) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, ...body }), { status, headers: { 'content-type': 'application/problem+json' } });

let router: Router;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setActivePinia(createPinia());
  router = createRouter({ history: createMemoryHistory(), routes: [
    ...['', '/confirm', '/review', '/story'].map((x) => ({ path: `/app/artworks/:id${x}`, component: Stub })),
    { path: '/:p(.*)*', component: Stub },
  ] });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

/** url → 응답 사상. 함수면 매 호출마다 부른다 */
function serve(map: Record<string, unknown | ((init?: RequestInit) => Response)>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).split('?')[0]!;
    const key = `${init?.method ?? 'GET'} ${path}`;
    const v = map[key] ?? map[path];
    if (v === undefined) return json({ code: 'not_found' }, 404);
    return typeof v === 'function' ? (v as (i?: RequestInit) => Response)(init) : json(v);
  });
}
async function open(view: Component, url: string) {
  await router.push(url);
  await router.isReady();
  const w = mount(view, { global: { plugins: [router], stubs: { RouterLink: { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>' } } }, attachTo: document.body });
  await flushPromises();
  return w;
}
const btn = (w: ReturnType<typeof mount>, label: string) => w.findAll('button').find((b) => b.text().startsWith(label));
const calls = (method: string, path: string) => fetchMock.mock.calls.filter(([u, i]) => String(u).startsWith(path) && (i?.method ?? 'GET') === method);

const base = { id: '7', childId: '1', originalUrl: '/v1/files/o', cutoutUrl: null, suggestion: null, confirmedKind: null, choices: [], unavailableChoices: [], stages: [], result: null, downgrade: null, story: {} };

describe('작품이 어디로 가는가(routeFor)', () => {
  it('확정 전 → S3, 확인 대기·처리하지 못함 → S5, 승인됨 → S6, 그 밖 → 진행 상세', () => {
    expect(routeFor({ id: '1', state: 'awaiting_confirm' })).toBe('/app/artworks/1/confirm');
    expect(routeFor({ id: '1', state: 'judging', confirmedKind: 'frame' })).toBe('/app/artworks/1');
    expect(routeFor({ id: '1', state: 'failed' })).toBe('/app/artworks/1/review');
    expect(routeFor({ id: '1', state: 'approved' })).toBe('/app/artworks/1/story');
    expect(routeFor({ id: '1', state: 'processing' })).toBe('/app/artworks/1');
  });
});

describe('S4 목록·상세(T080)', () => {
  it('작품이 없으면 빈 안내, 아이가 없으면 올리기는 사유 달린 비활성', async () => {
    serve({ '/v1/artworks': [], '/v1/children': [] });
    const w = await open(ArtworksView, '/app');
    expect(w.text()).toContain(ko.list.empty);
    expect(btn(w, ko.shell.appMenu.upload)!.attributes('aria-disabled')).toBe('true');
    w.unmount();
  });
  it('상태 배지와 다음 행동을 보이고 아이 별칭을 붙인다', async () => {
    serve({
      '/v1/artworks': [{ id: '7', childId: '1', state: 'awaiting_confirm', updatedAt: 'x', title: null }, { id: '8', childId: '1', state: 'failed', updatedAt: 'x', title: '해와 집' }],
      '/v1/children': [{ id: '1', alias: '하늘' }],
    });
    const w = await open(ArtworksView, '/app');
    expect(w.text()).toContain('하늘');
    expect(w.text()).toContain(ko.guardian.chip.not_delivered);
    expect(w.find('a[href="/app/artworks/7/confirm"]').exists()).toBe(true);
    expect(w.text()).toContain(ko.list.toConfirm);
    w.unmount();
  });
  it('처리하지 못함은 G9 블록으로 "낮춘 결과가 아니에요"를 말한다', async () => {
    serve({ '/v1/artworks/7': { ...base, state: 'failed', confirmedKind: 'relief', stages: [{ stage: 'depth_relief', status: 'failed', attempt: 3 }] } });
    const w = await open(ArtworkDetailView, '/app/artworks/7');
    expect(w.find('[data-gate="G9"]').text()).toContain('낮춘 결과가 아니에요');
    // 모델 단계 표(다시 시도 횟수)는 보호자에게 보이지 않는다(D34 ④, SD_02 §17-8)
    expect(w.text()).not.toContain(ko.list.retried(2));
    expect(w.find('table').exists()).toBe(false);
    w.unmount();
  });
});

describe('S2 올리기(T066)', () => {
  it('아이가 하나면 미리 고르고, 사진 전에는 사유 달린 비활성, 20MB 넘으면 G5', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }] });
    const w = await open(UploadView, '/app/upload');
    expect((w.find('#up-child').element as HTMLSelectElement).value).toBe('1');
    expect(btn(w, ko.upload.submit)!.text()).toContain(ko.upload.needPhoto);
    const input = w.findAll('input[type="file"]')[1]!;
    const big = new File([new Uint8Array(1)], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    Object.defineProperty(input.element, 'files', { value: [big], configurable: true });
    await input.trigger('change');
    expect(w.find('[data-gate="G5"]').exists()).toBe(true);
    expect(btn(w, ko.upload.submit)!.text()).toContain(ko.upload.tooBig);
    w.unmount();
  });
  it('올리면 multipart + Idempotency-Key로 보내고 전시로 가서 걸리는 장면을 본다(D34, ?hung)', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }], 'POST /v1/artworks': () => json({ ...base, state: 'awaiting_confirm' }, 202) });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    const w = await open(UploadView, '/app/upload');
    const input = w.findAll('input[type="file"]')[1]!;
    Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], 'a.png', { type: 'image/png' })], configurable: true });
    await input.trigger('change');
    await btn(w, ko.upload.submit)!.trigger('click');
    await flushPromises();
    const [, init] = calls('POST', '/v1/artworks')[0]!;
    expect((init!.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect((init!.body as FormData).get('childId')).toBe('1');
    expect(router.currentRoute.value.path).toBe('/app');
    expect(router.currentRoute.value.query).toMatchObject({ hung: '7' });
    w.unmount();
  });
});

describe('S3 확정(T067)', () => {
  const disabled = { ...base, state: 'awaiting_confirm', suggestion: 'none', choices: ['frame'],
    unavailableChoices: [{ choice: 'animated', reason: 'model_disabled' }, { choice: 'relief', reason: 'model_disabled' }] };
  it('판정 모델 비활성(판정 단계 없음): G7 블록 없이 안내 한 줄, 비활성 선택지는 사유 달린 C3, 기본 선택 없음', async () => {
    serve({ '/v1/artworks/7': disabled });
    const w = await open(ConfirmView, '/app/artworks/7/confirm');
    expect(w.find('[data-gate="G7"]').exists()).toBe(false);
    expect(w.text()).toContain(ko.confirm.noSuggestion);
    expect(btn(w, ko.kind.animated!)!.attributes('aria-disabled')).toBe('true');
    expect(btn(w, ko.kind.animated!)!.text()).toContain(ko.review.unavailable.model_disabled);
    expect(w.findAll('.chip-opt[aria-pressed="true"]')).toHaveLength(0);
    // UX2 같은 크기: 비활성 칸도 같은 칩 모양, 순서는 움직임 → 2.5D → 액자 고정
    expect(w.findAll('.opts .chip-opt').map((b) => b.text().split('(')[0]!.trim())).toEqual([ko.kind.animated, ko.kind.relief, ko.kind.frame]);
    expect(btn(w, ko.confirm.submit)!.text()).toContain(ko.confirm.pickOne);
    w.unmount();
  });
  it('판정 소진(판정 단계가 있었음)이면 G7 블록', async () => {
    serve({ '/v1/artworks/7': { ...disabled, stages: [{ stage: 'judge', status: 'failed', attempt: 3 }] } });
    const w = await open(ConfirmView, '/app/artworks/7/confirm');
    expect(w.find('[data-gate="G7"]').exists()).toBe(true);
    w.unmount();
  });
  it('원본 액자를 골라 확정하면 frame을 보내고 진행 상세로', async () => {
    serve({ '/v1/artworks/7': disabled, 'POST /v1/artworks/7/confirm': () => json({ ...disabled, state: 'processing', confirmedKind: 'frame' }) });
    const w = await open(ConfirmView, '/app/artworks/7/confirm');
    await btn(w, ko.kind.frame!)!.trigger('click');
    await btn(w, ko.confirm.submit)!.trigger('click');
    await flushPromises();
    expect(JSON.parse(String(calls('POST', '/v1/artworks/7/confirm')[0]![1]!.body))).toEqual({ kind: 'frame' });
    expect(router.currentRoute.value.fullPath).toBe('/app/artworks/7?started=1');
    w.unmount();
  });
  it('이미 확정한 작품은 그 상태 화면으로 보낸다', async () => {
    serve({ '/v1/artworks/7': { ...base, state: 'awaiting_review' } });
    const w = await open(ConfirmView, '/app/artworks/7/confirm');
    expect(router.currentRoute.value.path).toBe('/app/artworks/7/review');
    w.unmount();
  });
});

describe('S5 결과 확인(T094)', () => {
  const frameResult = { ...base, state: 'awaiting_review', choices: ['like', 'retake'], result: { kind: 'frame', primaryUrl: null } };
  it('액자 결과: 좋아요·다시 찍기, 좋아요 → 아이 미술관 걸리는 장면(D49 보강)', async () => {
    serve({ '/v1/artworks/7': frameResult, 'POST /v1/artworks/7/decision': () => json({ artwork: { ...frameResult, state: 'approved' }, alreadyDecided: false }) });
    const w = await open(ReviewView, '/app/artworks/7/review');
    await btn(w, ko.review.decision.like!)!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/app?child=1&hung=7');
    w.unmount();
  });
  it('다시 찍기는 확인 창 뒤에만 보내고, 응답 artwork가 null이어도 S2로(아이 미리 선택)', async () => {
    serve({ '/v1/artworks/7': frameResult, 'POST /v1/artworks/7/decision': () => json({ artwork: null, alreadyDecided: false, retake: { childId: '1' } }) });
    const w = await open(ReviewView, '/app/artworks/7/review');
    await btn(w, ko.review.decision.retake!)!.trigger('click');
    expect(calls('POST', '/v1/artworks/7/decision')).toHaveLength(0);
    expect(w.text()).toContain(ko.review.retakeBody);
    await w.find('[role="alertdialog"] .btn-primary').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/app/upload?child=1&retakeOf=7');
    w.unmount();
  });
  it('처리하지 못함: G9 블록, 좋아요는 사유 달린 비활성', async () => {
    serve({ '/v1/artworks/7': { ...base, state: 'failed', choices: ['frame', 'retake'], unavailableChoices: [{ choice: 'like', reason: 'needs_result' }] } });
    const w = await open(ReviewView, '/app/artworks/7/review');
    expect(w.find('[data-gate="G9"]').exists()).toBe(true);
    expect(btn(w, ko.review.decision.like!)!.text()).toContain(ko.review.unavailable.needs_result);
    w.unmount();
  });
  it('낮춘 결과는 C6 안내로 숨기지 않는다', async () => {
    serve({ '/v1/artworks/7': { ...frameResult, downgrade: 'relief_to_frame' } });
    const w = await open(ReviewView, '/app/artworks/7/review');
    expect(w.text()).toContain(ko.downgradeNote('입체 부조', '원본 액자'));
    w.unmount();
  });
});

describe('S6 이야기(T095)', () => {
  const approved = { ...base, state: 'approved', story: { updatedAt: '2026-09-29T01:00:00.000Z', title: null, madeOn: null, ageAtMaking: null, childWords: null } };
  it('올린 작품은 고정(D46) — 이야기는 보기만, 저장 버튼 없음, 코멘트는 기한 안에만(안내 없음)', async () => {
    const hung = { ...approved, state: 'exhibited', story: { ...approved.story, title: '강아지', madeOn: '2026-09-01', ageAtMaking: 6, childWords: '멍멍' } };
    serve({ '/v1/artworks/7': hung, '/v1/artworks/7/comments': { items: [], open: false, openUntil: '2026-09-01T00:00:00.000Z', days: 7 } });
    const w = await open(StoryView, '/app/artworks/7/story');
    await flushPromises();
    expect(w.text()).toContain('강아지');
    expect(w.text()).toContain('멍멍');
    expect(w.text()).toContain(ko.up2.lockNote);
    expect(w.find('form').exists()).toBe(false);
    expect(w.find('textarea').exists()).toBe(false); // 코멘트 기한 지남 — 조용히 보기만(D46 ⑨)
    expect(calls('PUT', '/v1/artworks/7/story')).toHaveLength(0);
    w.unmount();
  });
});

describe('전시실 /app/hall(SD_02 §17-2 내용 · §17-4 모양)', () => {
  const gal = { childId: '1', groups: [
    { ageAtMaking: 5, items: [{ id: '8', kind: 'animated', originalUrl: '/v1/files/o8', primaryUrl: '/v1/files/v8', title: '해님', madeOn: '2026-03-01', ageAtMaking: 5, childWords: null }] },
    { ageAtMaking: 6, items: [{ id: '7', kind: 'frame', originalUrl: '/v1/files/o', title: '강아지', madeOn: '2026-09-01', ageAtMaking: 6, childWords: '멍멍이가 웃어' }] },
  ] };
  it('머리 "{별칭}의 전시실", 평면도와 N세관, 명패(제목·그린 날·나이), 낮춤 표시 없음, 준비 중 작품 수', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }], '/v1/gallery': gal,
      '/v1/artworks': [{ id: '7', childId: '1', state: 'exhibited', updatedAt: 'x' }, { id: '9', childId: '1', state: 'processing', updatedAt: 'x' }] });
    const w = await open(MuseumView, '/app/hall');
    await flushPromises();
    expect(w.find('.hall-title').text()).toBe(ko.museum.hallTitle('하늘'));
    expect(w.find('.room-meta').text()).toBe(ko.museum.roomMeta(1, '2026-03-01'));
    // 전시실 이름은 시안에 따라(D30): v2 "N세관" · 고전 시안 "제N전시실 · N살"
    expect(w.findAll('.plan-room').map((b) => b.find('b').text())).toEqual([roomLabel(1, 5), roomLabel(2, 6)]);
    expect(w.findAll('.signplate').map((h) => h.text())).toEqual([roomLabel(1, 5), roomLabel(2, 6)]);
    expect(w.text()).toContain(ko.museum.plaque('2026-09-01', 6));
    expect(w.text()).not.toContain('바꿨어요');
    expect(w.text()).toContain(ko.museum.preparing(1));
    w.unmount();
  });
  it('작품을 누르면 작품 앞(?art=): 전시 해설(작품명·작가 줄·규칙 문장·한마디 원문), 움직이는 그림은 누를 때만 재생 토글', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }], '/v1/gallery': gal, '/v1/artworks': [] });
    const w = await open(MuseumView, '/app/hall');
    await flushPromises();
    await w.findAll('button.piece')[1]!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.art).toBe('7');
    expect(w.find('.wl-title').text()).toBe('강아지');
    expect(w.find('.wl-artist').text()).toBe(ko.museum.artist('하늘', 6, '2026'));
    expect(w.find('.wl-artist').text()).toBe('하늘 (6세 작, 2026)');
    expect(w.find('.wl-kind').text()).toBe(ko.museum.kind.frame);
    expect(w.find('.wl-desc').text()).toBe('「강아지」는 하늘이 6살이던 2026년 9월에 그린 작품입니다. 작가는 이 그림을 두고 “멍멍이가 웃어”라고 말했습니다.');
    expect(w.find('.wl-words').text()).toBe('멍멍이가 웃어');
    expect(btn(w, ko.museum.play)).toBeUndefined();
    await w.find('.wl-back').trigger('click');
    await flushPromises(); await new Promise((r) => setTimeout(r, 0)); await flushPromises();
    expect(router.currentRoute.value.query.art).toBeUndefined();
    await w.findAll('button.piece')[0]!.trigger('click');
    await flushPromises();
    expect(w.find('.wl-kind').text()).toBe(ko.museum.kind.animated);
    expect(w.find('.wl-desc').text()).toContain(ko.museum.kindLine.animated!);
    expect(btn(w, ko.museum.play)!.attributes('aria-pressed')).toBe('false');
    w.unmount();
  });
  it('주소 ?art=로 바로 들어오면 작품 앞, Esc면 전시실로(주소에서 art 빠짐)', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }], '/v1/gallery': gal, '/v1/artworks': [] });
    const w = await open(MuseumView, '/app/hall?child=1&art=8');
    await flushPromises();
    expect(w.find('.wl-title').text()).toBe('해님');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(router.currentRoute.value.query.art).toBeUndefined();
    expect(w.find('.wl-title').exists()).toBe(false);
    expect(w.find('.hall-title').text()).toBe(ko.museum.hallTitle('하늘'));
    w.unmount();
  });
  it('세관은 흰 매트 액자, 세관 벽은 이름 있는 넘김 영역, [← 홈으로]', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }], '/v1/gallery': gal, '/v1/artworks': [] });
    const w = await open(MuseumView, '/app/hall');
    await flushPromises();
    expect(w.find('.to-home').attributes('href')).toBe('/app');
    expect(w.findAll('.room .artframe')).toHaveLength(2);
    expect(w.findAll('[role="region"]').map((r) => r.attributes('aria-label'))).toEqual([ko.museum.hangOf(5), ko.museum.hangOf(6)]);
    w.unmount();
  });
  it('전시 작품이 없으면 빈 액자 걸이와 "첫 그림을 걸어 볼까요?"', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }], '/v1/gallery': { childId: '1', groups: [] }, '/v1/artworks': [] });
    const w = await open(MuseumView, '/app/hall');
    await flushPromises();
    expect(w.text()).toContain(ko.museum.emptyTitle);
    expect(w.findAll('.artframe.empty').length).toBeGreaterThan(0);
    w.unmount();
  });
});

describe('홈 /app — 아날로그 감성(D26 ⑥, SD_02 §17-3)', () => {
  const gal = { childId: '1', groups: [
    { ageAtMaking: 5, items: [{ id: '8', kind: 'frame', originalUrl: '/v1/files/o8', title: '해님', madeOn: '2025-03-01', ageAtMaking: 5, childWords: '해가 웃어' }] },
    { ageAtMaking: 6, items: [{ id: '7', kind: 'frame', originalUrl: '/v1/files/o', title: '강아지', madeOn: '2026-09-01', ageAtMaking: 6, childWords: null }] },
  ] };
  it('첫 화면에 최근 작품, 숫자 줄(작품 수·세관 수·첫 그림), 작품 줄은 제작일 순, 한마디 패널, 누르면 전시실 작품 앞', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }], '/v1/gallery': gal, '/v1/artworks': [] });
    const w = await open(PaperHomeView, '/app');
    await flushPromises();
    expect(w.find('.title').text()).toBe(ko.museum.hall('하늘'));
    expect(w.find('.hero-art').attributes('aria-label')).toBe(`${ko.museum.latest} - 강아지`);
    expect(w.findAll('.stats b').map((b) => b.text())).toEqual(['2점', '2개', '2025.03']);
    expect(w.findAll('.polaroid').map((b) => b.attributes('aria-label'))).toEqual(['해님', '강아지']);
    expect(w.find('.words').text()).toBe('“해가 웃어”');
    expect(w.text()).not.toContain('바꿨어요');
    await w.find('.hero-art').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/app/hall');
    expect(router.currentRoute.value.query).toMatchObject({ art: '7', child: '1' });
    w.unmount();
  });
  it('작품이 없으면 빈 폴라로이드와 "첫 그림을 걸어 볼까요?", 숫자 줄·작품 줄은 없음', async () => {
    serve({ '/v1/children': [{ id: '1', alias: '하늘' }], '/v1/gallery': { childId: '1', groups: [] }, '/v1/artworks': [] });
    const w = await open(PaperHomeView, '/app');
    await flushPromises();
    expect(w.text()).toContain(ko.museum.emptyTitle);
    expect(w.find('.stats').exists()).toBe(false);
    expect(w.find('.reel').exists()).toBe(false);
    w.unmount();
  });
});

describe('S0w 입장(제안 SD_02 §17-2)', () => {
  it('첫 방문이면 입장 화면, [시작하기](D53) 뒤에는 저장값으로 건너뛰고 next를 로그인에 넘긴다', async () => {
    localStorage.removeItem('uam.entered');
    expect(isFirstVisit()).toBe(true);
    const w = await open(WelcomeView, '/app/welcome?next=/app/upload');
    await btn(w, hc.start)!.trigger('click');
    await flushPromises();
    expect(isFirstVisit()).toBe(false);
    expect(router.currentRoute.value.fullPath).toBe('/app/login?next=/app/upload');
    w.unmount();
    localStorage.removeItem('uam.entered');
  });
});

describe('S0o 팀원 로그인(T055)', () => {
  it('팀원 API로 로그인하고 next로 간다 — 가입·보호자 링크 없음', async () => {
    serve({ 'POST /v1/ops/auth/login': () => json({ roles: ['operator'] }), '/v1/ops/me': { emailMasked: 'a***', roles: ['operator'] } });
    const w = await open(OpsLoginView, '/ops/login?next=/ops/models');
    expect(w.find('a[href^="/app"]').exists()).toBe(false);
    await w.find('#ol-email').setValue('ops@ex.com');
    await w.find('#ol-pw').setValue('12345678');
    await btn(w, ko.auth.login)!.trigger('click');
    await flushPromises();
    expect(calls('POST', '/v1/ops/auth/login')).toHaveLength(1);
    expect(router.currentRoute.value.fullPath).toBe('/ops/models');
    w.unmount();
  });
  it('불일치는 G1 블록, 로그인 화면으로 다시 보내지 않는다', async () => {
    serve({ 'POST /v1/ops/auth/login': () => problem(401, { code: 'unauthorized', reason: 'bad_credentials', gate: 'G1' }) });
    const w = await open(OpsLoginView, '/ops/login');
    await w.find('#ol-email').setValue('ops@ex.com');
    await w.find('#ol-pw').setValue('wrong-pass');
    await btn(w, ko.auth.login)!.trigger('click');
    await flushPromises();
    expect(w.find('[data-gate="G1"]').exists()).toBe(true);
    w.unmount();
  });
});

describe('S9 삭제(T101)', () => {
  it('확인 전에는 보내지 않고, 삭제하면 진행을 폴링해 G19 보류 → 삭제했어요', async () => {
    const states = ['waiting_stop', 'done'];
    serve({
      '/v1/artworks/7': { ...base, state: 'processing' },
      'DELETE /v1/artworks/7': () => new Response(null, { status: 202 }),
      '/v1/artworks/7/deletion': () => json({ state: states.shift() ?? 'done', gate: null }),
    });
    const w = await open(ArtworkDetailView, '/app/artworks/7');
    await btn(w, ko.del.artwork)!.trigger('click');
    expect(w.text()).toContain(ko.del.keeps);
    expect(calls('DELETE', '/v1/artworks/7')).toHaveLength(0);
    await w.find('[role="alertdialog"] .btn-primary').trigger('click');
    await flushPromises();
    expect(calls('DELETE', '/v1/artworks/7')).toHaveLength(1);
    expect(w.find('[data-gate="G19"]').exists()).toBe(true);
    expect(w.text()).toContain(ko.del.noWait);
    w.unmount();
  });
  it('착수 실패는 G18 "아무것도 바뀌지 않았어요"', async () => {
    serve({ '/v1/artworks/7': { ...base, state: 'processing' }, 'DELETE /v1/artworks/7': () => problem(503, { code: 'not_saved', reason: 'deletion_failed' }) });
    const w = await open(ArtworkDetailView, '/app/artworks/7');
    await btn(w, ko.del.artwork)!.trigger('click');
    await w.find('[role="alertdialog"] .btn-primary').trigger('click');
    await flushPromises();
    expect(w.find('[data-gate="G18"]').text()).toContain('아무것도 바뀌지 않았어요');
    w.unmount();
  });
});

describe('S1b~S1d 공동 보호자(T107)', () => {
  const owner = [{ id: '1', role: 'owner', emailMasked: 'ha***', isMe: true }];
  it('만든 보호자·한 명: [초대 링크 복사하기] → 본문 없이 링크를 받아 복사, "카카오톡으로 보내 주세요"(D36)', async () => {
    const link = 'https://p1.test/app/invite?token=abcdefghijkl';
    serve({ '/v1/family/members': owner, '/v1/family/invites': [], 'POST /v1/family/invites': () => Response.json({ id: '9', link, expiresAt: '2026-10-07T00:00:00Z' }, { status: 201 }) });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const w = await open(FamilyView, '/app/family');
    expect(w.find('#fm-email').exists()).toBe(false);                      // 초대 이메일 칸은 없다
    await btn(w, ko.kakao.inviteCopy)!.trigger('click');
    await flushPromises();
    expect(JSON.parse(String(calls('POST', '/v1/family/invites')[0]![1]!.body))).toEqual({});
    expect(writeText).toHaveBeenCalledWith(link);
    expect(w.text()).toContain(ko.kakao.copied);
    vi.unstubAllGlobals();
    w.unmount();
  });
  it('복사가 막힌 브라우저면 링크를 보여 길게 눌러 복사하게 한다', async () => {
    const link = 'https://p1.test/app/invite?token=zyxwvutsrqpo';
    serve({ '/v1/family/members': owner, '/v1/family/invites': [], 'POST /v1/family/invites': () => Response.json({ id: '9', link, expiresAt: '2026-10-07T00:00:00Z' }, { status: 201 }) });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const w = await open(FamilyView, '/app/family');
    await btn(w, ko.kakao.inviteCopy)!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain(ko.kakao.copyManual);
    expect((w.find('input[readonly]').element as HTMLInputElement).value).toBe(link);
    vi.unstubAllGlobals();
    w.unmount();
  });
  it('두 명 찼으면 초대는 "보호자는 두 명까지예요" 비활성, 해제는 확인 창 뒤', async () => {
    serve({ '/v1/family/members': [...owner, { id: '2', role: 'co', emailMasked: 'pa***', isMe: false }], '/v1/family/invites': [],
      'DELETE /v1/family/members/2': () => new Response(null, { status: 204 }) });
    const w = await open(FamilyView, '/app/family');
    expect(btn(w, ko.kakao.inviteCopy)!.text()).toContain(ko.family.full);
    await btn(w, ko.family.release)!.trigger('click');
    expect(w.text()).toContain(ko.family.releaseConfirm);
    expect(calls('DELETE', '/v1/family/members/2')).toHaveLength(0);
    await w.find('[role="alertdialog"] .btn-primary').trigger('click');
    await flushPromises();
    expect(calls('DELETE', '/v1/family/members/2')).toHaveLength(1);
    w.unmount();
  });
  it('공동 보호자 화면: 초대·해제 없이 나가기만, 나가면 로그인으로', async () => {
    serve({ '/v1/family/members': [{ id: '1', role: 'owner', emailMasked: 'ha***', isMe: false }, { id: '2', role: 'co', emailMasked: 'pa***', isMe: true }],
      'POST /v1/family/leave': () => new Response(null, { status: 204 }) });
    const w = await open(FamilyView, '/app/family');
    expect(btn(w, ko.kakao.inviteCopy)).toBeUndefined();
    expect(btn(w, ko.family.release)).toBeUndefined();
    expect(calls('GET', '/v1/family/invites')).toHaveLength(0);
    await btn(w, ko.family.leave)!.trigger('click');
    await w.find('[role="alertdialog"] .btn-primary').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/app/login');
    w.unmount();
  });
  it('S1c: 가족 없는 계정은 수락 → S4(합류 안내), 이메일이 다르면 G28 블록', async () => {
    serve({ '/v1/me': { emailMasked: 'pa***', hasFamily: false, role: null }, 'POST /v1/family/invites/accept': () => new Response(null, { status: 204 }) });
    const w = await open(InviteAcceptView, '/app/invite?token=tok123');
    await btn(w, ko.family.accept)!.trigger('click');
    await flushPromises();
    expect(JSON.parse(String(calls('POST', '/v1/family/invites/accept')[0]![1]!.body))).toEqual({ token: 'tok123' });
    expect(router.currentRoute.value.fullPath).toBe('/app?joined=1');
    w.unmount();
    serve({ '/v1/me': { emailMasked: 'ma***', hasFamily: false, role: null },
      'POST /v1/family/invites/accept': () => problem(403, { code: 'forbidden_role', reason: 'invite_email_mismatch', gate: 'G28' }) });
    const w2 = await open(InviteAcceptView, '/app/invite?token=tok123');
    await btn(w2, ko.family.accept)!.trigger('click');
    await flushPromises();
    expect(w2.find('[data-gate="G28"]').text()).toContain('초대받은 이메일로 로그인해 주세요');
    w2.unmount();
  });
  it('S1c: 이미 가족이 있는 만든 보호자는 수락이 사유 달린 비활성 + 나갈 수 없다는 안내', async () => {
    serve({ '/v1/me': { emailMasked: 'ma***', hasFamily: true, role: 'owner' } });
    const w = await open(InviteAcceptView, '/app/invite?token=tok123');
    await flushPromises();
    expect(btn(w, ko.family.accept)!.text()).toContain(ko.family.leaveFirst);
    expect(w.text()).toContain(ko.family.ownerCannotLeave);
    w.unmount();
  });
  it('S1d: G0 블록과 새 가족 공간 만들기 → S1(아이 등록 안내)', async () => {
    serve({ 'POST /v1/family': () => new Response(null, { status: 201 }), '/v1/me': { emailMasked: 'pa***', hasFamily: true, role: 'owner' } });
    const w = await open(NoFamilyView, '/app/no-family');
    expect(w.find('[data-gate="G0"]').exists()).toBe(true);
    await btn(w, ko.family.create)!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/app/children?verified=1');
    w.unmount();
  });
});

describe('S0c 계정 - 비밀번호 변경(T161)', () => {
  it('현재 비밀번호가 비면 사유 달린 비활성, 바꾸면 세 칸을 보내고 안내', async () => {
    serve({ 'POST /v1/auth/password': () => new Response(null, { status: 204 }) });
    const { default: AccountView } = await import('../app/views/AccountView.vue');
    const w = await open(AccountView, '/app/account');
    expect(btn(w, ko.auth.changePw)!.text()).toContain(ko.auth.needCurrent);
    await w.find('#ac-cur').setValue('old-pass-123');
    await w.find('#ac-pw').setValue('new-pass-456');
    await w.find('#ac-pw2').setValue('new-pass-456');
    await btn(w, ko.auth.changePw)!.trigger('click');
    await flushPromises();
    expect(JSON.parse(String(calls('POST', '/v1/auth/password')[0]![1]!.body))).toEqual({ currentPassword: 'old-pass-123', password: 'new-pass-456', passwordConfirm: 'new-pass-456' });
    expect(w.text()).toContain(ko.auth.pwChanged);
    w.unmount();
  });
  it('현재 비밀번호가 틀리면 C2 블록, [로그인 정보를 잊었어요]로 찾기', async () => {
    serve({ 'POST /v1/auth/password': () => problem(422, { code: 'validation_failed', reason: 'current_password_mismatch' }) });
    const { default: AccountView } = await import('../app/views/AccountView.vue');
    const w = await open(AccountView, '/app/account');
    await w.find('#ac-cur').setValue('wrong-pass');
    await w.find('#ac-pw').setValue('new-pass-456');
    await w.find('#ac-pw2').setValue('new-pass-456');
    await btn(w, ko.auth.changePw)!.trigger('click');
    await flushPromises();
    expect(w.find('.gblock').text()).toContain('현재 비밀번호가 맞지 않아요');
    await w.findAll('.gblock button').find((b) => b.text() === ko.auth.forgot)!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/app/recovery');
    w.unmount();
  });
});
