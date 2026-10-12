// E2E 전용 가짜 카카오(D36, research R-26) — 실제 카카오를 부르지 않고 인가·토큰·회원정보를 흉내 낸다.
// 인가 화면에서 회원번호를 고르고 [동의하고 계속하기] 또는 [취소]를 누르면 redirect_uri로 돌려보낸다(실제 카카오와 같은 쿼리).
import http from 'node:http';

export function startKakaoFake(port: number): Promise<http.Server> {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && u.pathname === '/oauth/authorize') {
      const back = u.searchParams.get('redirect_uri') ?? '';
      const state = u.searchParams.get('state') ?? '';
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width"><title>가짜 카카오</title>
<body style="font-family:sans-serif;padding:24px;background:#fee500"><h1>가짜 카카오 로그인(E2E)</h1>
<form method="get" action="${esc(back)}"><input type="hidden" name="state" value="${esc(state)}">
<label>회원번호 <input name="code" value="${Date.now()}" aria-label="회원번호"></label>
<p><button type="submit">동의하고 계속하기</button></p></form>
<form method="get" action="${esc(back)}"><input type="hidden" name="state" value="${esc(state)}">
<input type="hidden" name="error" value="access_denied"><button type="submit">취소</button></form></body></html>`);
      return;
    }
    if (req.method === 'POST' && u.pathname === '/oauth/token') {
      let body = '';
      req.on('data', (d) => (body += d)).on('end', () => {
        const code = new URLSearchParams(body).get('code') ?? '';
        if (!/^\d+$/.test(code)) { res.writeHead(400).end('{"error":"invalid_grant"}'); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: `tok-${code}`, token_type: 'bearer' }));
      });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/v2/user/me') {
      const m = /^Bearer tok-(\d+)$/.exec(req.headers.authorization ?? '');
      if (!m) { res.writeHead(401).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: Number(m[1]) }));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok(srv)));
}
