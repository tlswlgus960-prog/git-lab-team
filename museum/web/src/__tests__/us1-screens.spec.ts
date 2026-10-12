// T052·T053·T054 시험: S0 가입·확인, S0a 로그인, S0b 찾기·재설정, S1 아이 관리(SD_02 §4·§4-5, UC1·UC13·UC14).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { Component } from 'vue';
import SignupView from '../app/views/SignupView.vue';
import VerifyView from '../app/views/VerifyView.vue';
import LoginView from '../app/views/LoginView.vue';
import RecoveryView from '../app/views/RecoveryView.vue';
import ResetView from '../app/views/ResetView.vue';
import ChildrenView from '../app/views/ChildrenView.vue';
import { ko } from '../copy/ko';

const Stub = { template: '<div />' };
const problem = (status: number, body: object) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, ...body }), { status, headers: { 'content-type': 'application/problem+json' } });
const noContent = (status = 204) => new Response(null, { status });

let router: Router;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setActivePinia(createPinia());
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: Stub }] });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function open(view: Component, url: string) {
  await router.push(url);
  await router.isReady();
  const w = mount(view, { global: { plugins: [router], stubs: { RouterLink: { props: ['to'], template: '<a :href="String(to)"><slot /></a>' } } }, attachTo: document.body });
  await flushPromises();
  return w;
}
const bodyOf = (i: number) => JSON.parse(String(fetchMock.mock.calls[i]![1]!.body));
const btn = (w: ReturnType<typeof mount>, label: string) => w.findAll('button').find((b) => b.text().startsWith(label))!;

describe('S0 가입(T052)', () => {
  it('입력 전에는 가입이 사유 달린 비활성이고, 문구는 C_화면문구의 검사 문장이다', async () => {
    const w = await open(SignupView, '/app/signup');
    const b = btn(w, ko.auth.signup);
    expect(b.attributes('aria-disabled')).toBe('true');
    expect(b.text()).toContain(ko.auth.needEmail);
    await w.find('#su-email').setValue('ha@ex.com');
    await w.find('#su-pw').setValue('1234');
    expect(btn(w, ko.auth.signup).text()).toContain(ko.auth.shortPassword);
    await w.find('#su-pw').setValue('12345678');
    await w.find('#su-pw2').setValue('12345679');
    expect(btn(w, ko.auth.signup).text()).toContain(ko.auth.mismatch);
    expect(fetchMock).not.toHaveBeenCalled();
    w.unmount();
  });
  it('가입하면 이메일·비밀번호만 보내고, 결과와 관계없이 "메일함을 확인해 주세요"를 보인다', async () => {
    fetchMock.mockResolvedValue(noContent(202));
    const w = await open(SignupView, '/app/signup');
    await w.find('#su-email').setValue(' ha@ex.com ');
    await w.find('#su-pw').setValue('12345678');
    await w.find('#su-pw2').setValue('12345678');
    await btn(w, ko.auth.signup).trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls[0]![0]).toBe('/v1/auth/signup');
    expect(bodyOf(0)).toEqual({ email: 'ha@ex.com', password: '12345678', passwordConfirm: '12345678' });
    expect(w.text()).toContain(ko.auth.checkMailbox);
    expect(w.text()).toContain(ko.auth.mailboxHint);
    expect(w.text()).not.toMatch(/이미 가입된|가입되어 있/);
    w.unmount();
  });
  it('메일 링크가 무효면 G27 블록, 다시 받기를 고르면 이메일 칸과 재발송', async () => {
    fetchMock.mockResolvedValueOnce(problem(400, { code: 'token_invalid', reason: 'token_invalid', gate: 'G27' })).mockResolvedValue(noContent(202));
    const w = await open(VerifyView, '/app/verify?token=old');
    expect(w.find('[data-gate="G27"]').text()).toContain('링크를 쓸 수 없어요');
    await btn(w, '메일 다시 받기').trigger('click');
    await w.find('#vf-email').setValue('ha@ex.com');
    await btn(w, ko.auth.resendVerify).trigger('click');
    await flushPromises();
    expect(fetchMock.mock.calls[1]![0]).toBe('/v1/auth/email/verify/resend');
    expect(w.text()).toContain(ko.auth.checkMailbox);
    w.unmount();
  });
  it('메일 링크가 맞으면 S1로 가서 "이제 아이를 등록해 주세요"', async () => {
    fetchMock.mockResolvedValueOnce(noContent()).mockResolvedValueOnce(Response.json({ hasFamily: true }));
    const w = await open(VerifyView, '/app/verify?token=ok');
    expect(router.currentRoute.value.fullPath).toBe('/app/children?verified=1');
    w.unmount();
  });
});

const providers = (kakao = true) => Response.json({ kakao, emailSignup: false });
/** 이메일 로그인 칸은 "이메일로 로그인(기존 회원)"을 눌러야 펼쳐진다(D36, SD_02 §17-7) */
async function openEmailLogin(url: string) {
  const w = await open(LoginView, url);
  await flushPromises();
  await btn(w, ko.kakao.emailLogin).trigger('click');
  return w;
}

describe('S0a 로그인 — 카카오가 기본(D36)', () => {
  it('키가 있으면 [카카오로 시작하기] → /v1/auth/kakao/start, 메일 관련 문구·링크가 없다', async () => {
    fetchMock.mockResolvedValueOnce(providers(true));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const w = await open(LoginView, '/app/login');
    await flushPromises();
    await btn(w, ko.kakao.start).trigger('click');
    expect(assign).toHaveBeenCalledWith('/v1/auth/kakao/start');
    for (const t of ['메일을 확인', '메일 다시 받기', '로그인 정보 찾기']) expect(w.text()).not.toContain(t);
    expect(w.find('#li-email').exists()).toBe(false);
    vi.unstubAllGlobals();
    w.unmount();
  });
  it('키가 없으면 버튼은 "준비 중이에요"로 비활성, 이메일 로그인은 그대로', async () => {
    fetchMock.mockResolvedValueOnce(providers(false));
    const w = await openEmailLogin('/app/login');
    expect(btn(w, ko.kakao.start).attributes('aria-disabled')).toBe('true');
    expect(w.text()).toContain(ko.kakao.preparing);
    expect(w.find('#li-email').exists()).toBe(true);
    w.unmount();
  });
  it('카카오에서 취소하고 오면 "로그인을 취소했어요. 다시 해 볼까요?"', async () => {
    fetchMock.mockResolvedValueOnce(providers(true));
    const w = await open(LoginView, '/app/login?kakao=cancelled');
    await flushPromises();
    expect(w.text()).toContain(ko.kakao.cancelled);
    expect(btn(w, ko.kakao.start).exists()).toBe(true);
    w.unmount();
  });
});

describe('S0a 로그인 — 이메일(기존 회원, T053)', () => {
  it('성공하면 next로, 가족이 없으면 S1d로', async () => {
    fetchMock.mockResolvedValueOnce(providers()).mockResolvedValueOnce(noContent()).mockResolvedValueOnce(Response.json({ hasFamily: true }));
    let w = await openEmailLogin('/app/login?next=/app/gallery');
    await w.find('#li-email').setValue('ha@ex.com');
    await w.find('#li-pw').setValue('12345678');
    await btn(w, ko.auth.login).trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/app/gallery');
    w.unmount();
    fetchMock.mockResolvedValueOnce(providers()).mockResolvedValueOnce(noContent()).mockResolvedValueOnce(Response.json({ hasFamily: false }));
    w = await openEmailLogin('/app/login');
    await w.find('#li-email').setValue('ha@ex.com');
    await w.find('#li-pw').setValue('12345678');
    await btn(w, ko.auth.login).trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/app/no-family');
    w.unmount();
  });
  it('불일치는 한 문구 C2(가입 여부 비노출), 비밀번호는 지운다', async () => {
    fetchMock.mockResolvedValueOnce(providers()).mockResolvedValue(problem(401, { code: 'unauthorized', reason: 'bad_credentials' }));
    const w = await openEmailLogin('/app/login');
    await w.find('#li-email').setValue('ha@ex.com');
    await w.find('#li-pw').setValue('wrongpass');
    await btn(w, ko.auth.login).trigger('click');
    await flushPromises();
    expect(w.find('.gblock').text()).toContain('이메일 또는 비밀번호가 맞지 않아요');
    expect(w.find('[data-gate="G0"]').exists()).toBe(true);
    expect(w.findAll('a, button').filter((x) => x.text() === ko.auth.forgot).length).toBe(0); // 메일을 보내지 않는다(D36)
    expect((w.find('#li-pw').element as HTMLInputElement).value).toBe('');
    expect(router.currentRoute.value.path).toBe('/app/login');
    w.unmount();
  });
  it('확인 전 이메일 계정은 메일 다시 받기 없이 안내만(D36 — 메일을 보내지 않는다)', async () => {
    fetchMock.mockResolvedValueOnce(providers()).mockResolvedValueOnce(problem(403, { code: 'email_unverified', reason: 'email_unverified' }));
    const w = await openEmailLogin('/app/login');
    await w.find('#li-email').setValue('ha@ex.com');
    await w.find('#li-pw').setValue('12345678');
    await btn(w, ko.auth.login).trigger('click');
    await flushPromises();
    expect(w.text()).toContain(ko.kakao.unverified);
    expect(w.findAll('button').some((b) => b.text() === ko.auth.resendVerify)).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/verify/resend'))).toBe(false);
    w.unmount();
  });
});

describe('S0b 찾기·재설정(T053)', () => {
  it('찾기는 응답과 관계없이 같은 안내(무응답이어도)', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const w = await open(RecoveryView, '/app/recovery');
    await w.find('#rc-email').setValue('ha@ex.com');
    await btn(w, ko.auth.recoverySend).trigger('click');
    await flushPromises();
    expect(w.text()).toContain(ko.auth.recoverySent);
    expect(w.text()).toContain(ko.auth.recoveryOnce);
    w.unmount();
  });
  it('재설정 성공이면 로그인 화면에 "이메일과 새 비밀번호로 로그인해 주세요"', async () => {
    fetchMock.mockResolvedValue(noContent());
    const w = await open(ResetView, '/app/reset?token=t1');
    await w.find('#rs-pw').setValue('newpass12');
    await w.find('#rs-pw2').setValue('newpass12');
    await btn(w, ko.auth.save).trigger('click');
    await flushPromises();
    expect(bodyOf(0)).toEqual({ token: 't1', password: 'newpass12', passwordConfirm: 'newpass12' });
    expect(router.currentRoute.value.fullPath).toBe('/app/login?reset=1');
    w.unmount();
    const l = await open(LoginView, '/app/login?reset=1');
    expect(l.text()).toContain(ko.auth.resetDone);
    l.unmount();
  });
  it('링크 무효면 G27 블록 → 찾기부터 다시', async () => {
    fetchMock.mockResolvedValue(problem(400, { code: 'token_invalid', reason: 'token_invalid', gate: 'G27' }));
    const w = await open(ResetView, '/app/reset?token=used');
    await w.find('#rs-pw').setValue('newpass12');
    await w.find('#rs-pw2').setValue('newpass12');
    await btn(w, ko.auth.save).trigger('click');
    await flushPromises();
    expect(w.find('[data-gate="G27"]').exists()).toBe(true);
    await btn(w, '메일 다시 받기').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/app/recovery');
    w.unmount();
  });
});

describe('S1 아이 관리(T054)', () => {
  it('별칭 칸 하나만 있고 실명·생년월일 칸이 없다, 아이가 없으면 올리기가 사유 달린 비활성', async () => {
    fetchMock.mockResolvedValue(Response.json([]));
    const w = await open(ChildrenView, '/app/children?verified=1');
    expect(w.findAll('input').length).toBe(1);
    expect(w.text()).toContain(ko.auth.verified);
    expect(w.text()).toContain(ko.child.notCollected);
    const up = btn(w, ko.child.toUpload);
    expect(up.attributes('aria-disabled')).toBe('true');
    expect(up.text()).toContain(ko.child.needChild);
    w.unmount();
  });
  it('남은 글자를 세고, 20자를 넘으면 저장이 G4 사유로 비활성', async () => {
    fetchMock.mockResolvedValue(Response.json([]));
    const w = await open(ChildrenView, '/app/children');
    await w.find('#ch-alias').setValue('  하늘  ');
    expect(w.find('#ch-alias-n').text()).toContain('남은 글자 18/20');
    await w.find('#ch-alias').setValue('가'.repeat(21));
    const save = btn(w, ko.child.save);
    expect(save.attributes('aria-disabled')).toBe('true');
    expect(save.text()).toContain('별칭은 20자까지예요');
    w.unmount();
  });
  it('같은 별칭이면 저장은 되고 A5 안내(그대로 두기·별칭 고치기)를 보인다', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([{ id: '1', alias: '하*', artworkCount: 12 }]))
      .mockResolvedValueOnce(Response.json({ id: '2', alias: '하*', aliasDuplicate: true }, { status: 201 }))
      .mockResolvedValueOnce(Response.json([{ id: '1', alias: '하*', artworkCount: 12 }, { id: '2', alias: '하*', artworkCount: 0 }]));
    const w = await open(ChildrenView, '/app/children');
    await w.find('#ch-alias').setValue(' 하* ');
    await btn(w, ko.child.save).trigger('click');
    await flushPromises();
    expect(bodyOf(1)).toEqual({ alias: '하*' });
    expect(w.text()).toContain(ko.child.count(2));
    expect(w.text()).toContain(ko.child.dup('하*'));
    await w.find('.notice-block').findAll('button').find((x) => x.text() === ko.child.edit)!.trigger('click'); // A5 안내의 [별칭 고치기]
    expect(w.find('h2').text()).toBe(ko.child.edit);
    expect((w.find('#ch-alias').element as HTMLInputElement).value).toBe('하*');
    w.unmount();
  });
  it('저장 실패(G3)는 차단 블록, 입력값을 남긴다', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(problem(503, { code: 'not_saved', reason: 'child_not_saved', gate: 'G3' }));
    const w = await open(ChildrenView, '/app/children');
    await w.find('#ch-alias').setValue('바*');
    await btn(w, ko.child.save).trigger('click');
    await flushPromises();
    expect(w.find('[data-gate="G3"]').text()).toContain('저장되지 않았어요');
    expect((w.find('#ch-alias').element as HTMLInputElement).value).toBe('바*');
    w.unmount();
  });
});
