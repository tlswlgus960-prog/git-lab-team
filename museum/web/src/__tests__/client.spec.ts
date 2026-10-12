// T036 시험: Problem → ApiError·BlockNotice(reason+gate 사상), 401 → 로그인, 409 no_family → S1d, 네트워크 실패는 전역 실패.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setNavigator, toBlock } from '../api/client';

const problem = (status: number, body: object) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, ...body }), { status, headers: { 'content-type': 'application/problem+json' } });

afterEach(() => { vi.unstubAllGlobals(); setNavigator(null); });
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error('오류가 나야 한다'); }, (x: unknown) => x as ApiError);

describe('API 클라이언트', () => {
  it('성공 JSON과 204를 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ hasFamily: true })).mockResolvedValueOnce(new Response(null, { status: 204 })));
    expect(await api.get('/v1/me')).toEqual({ hasFamily: true });
    expect(await api.post('/v1/auth/logout')).toBeUndefined();
  });
  it('차단은 code가 아니라 reason+gate로 문구를 고른다(초대 이메일 불일치)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem(403, { code: 'forbidden_role', reason: 'invite_email_mismatch', gate: 'G28' })));
    const e = await fail(api.post('/v1/family/invites/accept', { body: { token: 'x' } }));
    const b = toBlock(e);
    expect(b).toMatchObject({ gate: 'G28', reason: '초대받은 이메일로 로그인해 주세요', self: true });
  });
  it('해제 주체가 다른 사람이면 self=false(대안만)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem(409, { code: 'conflict', reason: 'model_disabled', gate: 'G8' })));
    const b = toBlock(await fail(api.post('/v1/artworks/1/confirm')));
    expect(b.self).toBe(false);
    expect(b.releaser).toContain('평가 담당');
  });
  it('401은 로그인으로, 운영 경로는 운영 로그인으로, 409 no_family는 S1d로', async () => {
    const nav = { toLogin: vi.fn(), toNoFamily: vi.fn() };
    setNavigator(nav);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(problem(401, { code: 'unauthorized', reason: 'login_required', gate: 'G0' }))
      .mockResolvedValueOnce(problem(401, { code: 'unauthorized', reason: 'login_required', gate: 'G1' }))
      .mockResolvedValueOnce(problem(409, { code: 'conflict', reason: 'no_family', gate: 'G0' })));
    await api.get('/v1/artworks').catch(() => null);
    await api.get('/v1/ops/me').catch(() => null);
    await api.get('/v1/children').catch(() => null);
    expect(nav.toLogin.mock.calls).toEqual([['app'], ['ops']]);
    expect(nav.toNoFamily).toHaveBeenCalledOnce();
  });
  it('noRedirect면 이동하지 않는다', async () => {
    const nav = { toLogin: vi.fn(), toNoFamily: vi.fn() };
    setNavigator(nav);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem(401, { code: 'unauthorized', reason: 'bad_credentials', gate: 'G0' })));
    const e = await fail(api.post('/v1/auth/login', { noRedirect: true }));
    expect(nav.toLogin).not.toHaveBeenCalled();
    expect(toBlock(e).reason).toBe('이메일 또는 비밀번호가 맞지 않아요');
  });
  it('네트워크 실패는 status 0, unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const e = await fail(api.get('/v1/artworks'));
    expect(e.status).toBe(0);
    expect(e.unavailable).toBe(true);
  });
  it('쿼리를 붙이고 JSON 본문을 보낸다', async () => {
    const f = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', f);
    await api.put('/v1/artworks/1/story', { body: { title: '바다' }, query: { a: 1, b: undefined } });
    expect(f.mock.calls[0]?.[0]).toBe('/v1/artworks/1/story?a=1');
    expect(f.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT', body: '{"title":"바다"}', credentials: 'same-origin' });
  });
});
