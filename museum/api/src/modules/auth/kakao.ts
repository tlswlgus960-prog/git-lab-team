// 카카오 로그인 연결부(research R-26, D36). 인가 코드 → 액세스 토큰 → 회원번호. 토큰은 쓰고 버린다(저장·로그 안 함).
// 받는 값은 회원번호(id)뿐 — 동의 항목을 요청하지 않는다. 시험은 이 인터페이스를 가짜로 바꿔 끼운다.
import type { Config } from '../../config.js';

export interface KakaoClient {
  configured: boolean;
  authorizeUrl(state: string): string;
  /** 인가 코드 → 회원번호. 실패하면 Error(원인 코드만) */
  memberId(code: string): Promise<string>;
}

export function httpKakao(cfg: Config['kakao'], timeoutMs = 5000): KakaoClient {
  const configured = Boolean(cfg.restApiKey && cfg.clientSecret);
  return {
    configured,
    authorizeUrl(state) {
      const q = new URLSearchParams({ client_id: cfg.restApiKey, redirect_uri: cfg.redirectUri, response_type: 'code', state });
      return `${cfg.authBase}/oauth/authorize?${q}`;
    },
    async memberId(code) {
      const tok = await fetch(`${cfg.authBase}/oauth/token`, {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.restApiKey, client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri, code }),
      }).catch(() => null);
      if (!tok?.ok) throw new Error('kakao_token');
      const accessToken = ((await tok.json().catch(() => ({}))) as { access_token?: string }).access_token;
      if (!accessToken) throw new Error('kakao_token');
      const me = await fetch(`${cfg.apiBase}/v2/user/me`, {
        headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null);
      if (!me?.ok) throw new Error('kakao_me');
      const id = ((await me.json().catch(() => ({}))) as { id?: number | string }).id;
      if (id === undefined || id === null || !/^\d{1,20}$/.test(String(id))) throw new Error('kakao_me');
      return String(id);
    },
  };
}
