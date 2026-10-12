// 앱 부트스트랩(T024): 라우터 마운트, /live, Problem Details 오류 처리(R-10), 허용 목록 로그(BR-PRV-01).
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type { Pool } from 'mysql2/promise';
import type { Config } from './config.js';
import { log } from './lib/logger.js';
import { ZodError } from 'zod';
import { Problem, parseSignal, zodFields } from './lib/problem.js';
import { paramGuard } from './lib/paramGuard.js';
import { requestContext } from './lib/requestContext.js';
import type { StoragePort } from './storage/LocalFsDriver.js';
import { filesRouter } from './modules/files/routes.js';

export interface AppDeps {
  db: Pool; cfg: Config; storage: StoragePort; routers?: express.Router[];
  /** 라우터 앞에 끼우는 미들웨어 — 시험 모드의 응답 계약 검증(T024, R-19)만 쓴다. 운영 빌드는 비워 둔다 */
  before?: express.RequestHandler[];
}

export function createApp({ db, cfg, storage, routers = [], before = [] }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    // 요청 번호(계약 머리말, 점검표 L1): 형식이 맞는 X-Request-ID는 그대로, 아니면 새로 — 응답 헤더·오류 본문·로그 줄이 같은 값
    const given = req.get('x-request-id');
    req.requestId = given && /^[A-Za-z0-9._-]{1,128}$/.test(given) ? given : randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    const t0 = Date.now();
    res.on('finish', () => log.info({ requestId: req.requestId, method: req.method, route: req.route?.path ?? 'unmatched', status: res.statusCode, durationMs: Date.now() - t0 }));
    requestContext.run({ requestId: req.requestId }, next); // 이 요청에서 비동기로 찍는 로그 줄도 같은 번호
  });
  app.use(cookieParser());
  app.use(express.json({ limit: '64kb' }));

  for (const m of before) app.use(m);
  app.use(paramGuard(cfg.contractsDir)); // 경로·쿼리 입력 공통 오류(계약 머리말) — 라우터·로그인 확인보다 먼저
  app.use(filesRouter(db, cfg, storage));
  for (const r of routers) app.use(r);

  app.use((_req, _res, next) => next(new Problem('not_found')));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let p: Problem;
    if (err instanceof Problem) p = err;
    else if (err instanceof ZodError) p = new Problem('validation_failed', 'invalid_fields', undefined, zodFields(err)); // 본문 검사 실패는 503이 아니다(계약 머리말)
    else if ((err as { type?: string }).type === 'entity.parse.failed') p = new Problem('invalid_input', 'bad_json');
    else if ((err as { type?: string }).type === 'entity.too.large') p = new Problem('payload_too_large');
    else {
      const sig = parseSignal(err);
      p = sig ? new Problem(sig.gate === 'G11' ? 'validation_failed' : 'conflict', sig.reason, sig.gate) : new Problem('not_saved', 'internal');
      if (!sig) log.error({ requestId: req.requestId, code: 'internal', event: (err as { code?: string }).code ?? 'unknown' });
    }
    res.status(p.status).type('application/problem+json').json(p.body(req.requestId));
  });
  return app;
}
