// 요청 번호(contracts/openapi.yaml 머리말 "요청 번호", 2026-09-30 점검표 L1): 모든 응답 헤더 X-Request-ID,
// 요청 값은 형식이 맞으면 그대로, 없거나 틀리면 UUID. 오류 본문 requestId와 같다.
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers/app.js';

const t = testApp();
afterAll(async () => t.close());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('X-Request-ID', () => {
  it('성공 응답에도 헤더가 있다(없으면 서버가 UUID)', async () => {
    const r = await request(t.app).get('/live').expect(200);
    expect(r.headers['x-request-id']).toMatch(UUID);
  });
  it('요청에 온 값은 그대로 돌려주고, 오류 본문 requestId와 같다', async () => {
    const r = await request(t.app).get('/v1/gallery').set('X-Request-ID', 'client-abc_123.x');
    expect(r.headers['x-request-id']).toBe('client-abc_123.x');
    expect(r.body.requestId).toBe('client-abc_123.x');
  });
  it('형식이 틀린 값(너무 김·허용 밖 글자)은 버리고 새로 만든다', async () => {
    for (const bad of ['x'.repeat(129), 'a b', '<script>']) {
      const r = await request(t.app).get('/live').set('X-Request-ID', bad);
      expect(r.headers['x-request-id']).toMatch(UUID);
    }
  });
});

describe('로그 줄의 요청 번호 — 요청 안에서 비동기로 찍는 줄(메일 발송 등)도', () => {
  it('요청 맥락 안의 비동기 로그 필드에 requestId가 붙는다', async () => {
    const { logFields } = await import('../src/lib/logger.js');
    const { requestContext } = await import('../src/lib/requestContext.js');
    await requestContext.run({ requestId: 'r-async-1' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(logFields({ event: 'mail_sent', code: 'verify' })).toEqual({ requestId: 'r-async-1', event: 'mail_sent', code: 'verify' });
    });
    expect(logFields({ event: 'listening' })).toEqual({ event: 'listening' }); // 요청 밖(기동·sweeper)은 번호 없음
  });
});
