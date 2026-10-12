import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { inject } from 'vitest';
import * as OpenApiValidator from 'express-openapi-validator';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { buildRouters } from '../../src/routes.js';
import { LocalFsDriver } from '../../src/storage/LocalFsDriver.js';
import { memoryMailer } from '../../src/modules/mail/mailer.js';
import { testPool } from './db.js';
import type { ModelApi } from '../../src/modules/ops/modelApi.js';
import type { CaptionInput, CaptionReply, LlmReady } from '../../src/modules/captions/llmServer.js';

/** 시험용 llm-server — replies를 차례로 돌려준다(비면 마지막 값). 받은 입력은 calls에 남는다(BR-CAP-01 확인). */
export function fakeLlm() {
  const f = {
    replies: [] as CaptionReply[], calls: [] as CaptionInput[], readyBody: null as LlmReady | null,
    async caption(input: CaptionInput) { f.calls.push(input); return (f.replies.length > 1 ? f.replies.shift() : f.replies[0]) ?? { outcome: 'engine_down' as const }; },
    async ready() { return f.readyBody; },
  };
  return f;
}

/** 시험용 model-api — models를 바꿔 끼워 적재 상태를 흉내 낸다(null = 응답 없음). */
export function fakeModelApi() {
  // 응답은 model-api 계약 ModelLoadStatus 모양으로 채운다(필수 modelId·licenseConfirmed·hint — T024 응답 검증)
  const full = (m: Record<string, unknown>) => ({ activeVersion: null, execDevice: null, runtime: null, licenseConfirmed: false, load: null, hint: null, ...m });
  const f = {
    list: null as Record<string, unknown>[] | null, warmStatus: 202,
    async models() { return f.list && f.list.map(full); },
    async warmup(id: string) { return { status: id === 'M6' ? 409 : f.warmStatus, body: full({ modelId: id, load: { state: 'loading' }, hint: 'model_loading' }) }; },
  };
  return f;
}

/** 계약(contracts/openapi.yaml)과 어긋난 응답 — 시험 모드 응답 검증(T024). 파일마다 비어 있어야 한다 */
export const contractViolations: string[] = [];
const SPEC = path.resolve(__dirname, '..', '..', '..', 'contracts', 'openapi.yaml');
const responseValidator = () => OpenApiValidator.middleware({
  apiSpec: SPEC, validateRequests: false, validateSecurity: false, fileUploader: false, ignoreUndocumented: true, validateApiSpec: false,
  validateResponses: {
    onError: (err, body, req) => {
      // D21: 보호자·운영 경로 공통 오류(401, 403 forbidden_role, 409 no_family)는 계약 머리말에만 적는다
      const b = body as { status?: number; reason?: string } | undefined;
      if (/status code '(401|403)'/.test(err.message)) return;
      if (/status code '409'/.test(err.message) && b?.reason === 'no_family') return;
      // 경로·쿼리 입력·JSON 본문 공통 오류(계약 머리말, 2026-09-30) — 422 validation_failed는 경로마다 적지 않는다
      if (/status code '422'/.test(err.message) && (b as { code?: string } | undefined)?.code === 'validation_failed') return;
      contractViolations.push(`${req.method} ${req.path}: ${err.message}`);
    },
  },
});

/** 시험용 카카오(D36) — 코드가 숫자면 그 값을 회원번호로, 'fail'이면 실패. configured를 바꿔 키 미설정을 흉내 낸다. */
export function fakeKakao() {
  const f = {
    configured: true,
    authorizeUrl: (state: string) => `https://kauth.test/oauth/authorize?state=${encodeURIComponent(state)}`,
    async memberId(code: string) { if (!/^\d+$/.test(code)) throw new Error('kakao_token'); return code; },
  };
  return f;
}

export function testApp(env: Record<string, string> = {}) {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'uams-'));
  const cfg = loadConfig({
    DB_SOCKET: inject('DB_SOCKET'), DB_USER: 'root', DB_NAME: 'uam_test', SESSION_SECRET: 'test-session-secret',
    AUTH_HMAC_SECRET: 'test-hmac', STORAGE_ROOT: store, SECURE_COOKIES: 'false', APP_BASE_URL: 'http://app.test',
    MODEL_MANIFEST: path.join(store, 'manifest.yaml'), ...env,
  } as NodeJS.ProcessEnv);
  const db = testPool();
  const storage = new LocalFsDriver(store);
  const mailer = memoryMailer();
  const modelApi = fakeModelApi();
  const llm = fakeLlm();
  const kakao = fakeKakao();
  const express = createApp({ db, cfg, storage, before: responseValidator(), routers: buildRouters({ db, cfg, storage, mailer, modelApi: modelApi as unknown as ModelApi, llm, kakao, captionRetryDelaysMs: [0, 0] }) });
  // 시험 파일마다 서버 하나를 띄워 계속 쓴다(요청마다 임시 서버를 여닫으면 드물게 연결이 끊긴다)
  const app = express.listen(0, '127.0.0.1');
  const close = async () => { await new Promise((r) => app.close(r)); await db.end(); };
  return { app, db, cfg, storage, mailer, store, close, modelApi, llm, kakao };
}

export const tokenOf = (link?: string) => new URL(link!).searchParams.get('token')!;
