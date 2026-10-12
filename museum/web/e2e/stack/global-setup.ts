// E2E 전용 스택(T044·T059·T075·T087·T138, R-19): 임시 MariaDB(소켓만) + 별도 app-api + 별도 Mailpit + CPU 워커 + sweeper.
// 팀 DB·p1(app-api 9521, Mailpit 1025/8025, model-api 9541)에는 절대 붙지 않는다. model-api는 닫힌 포트를 가리킨다.
// 포트: app-api E2E_API_PORT(9621) · Mailpit SMTP E2E_SMTP_PORT(1125) · 웹 수신함 E2E_MAIL_PORT(8125).
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_PORT, KAKAO_PORT, MAIL_PORT, SMTP_PORT, STAFF, WEB_PORT } from './ports';
import { startKakaoFake } from './kakao-fake';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const API = path.join(ROOT, 'api');
const procs: ChildProcess[] = [];

async function waitFor(check: () => Promise<boolean> | boolean, what: string, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { if (await check()) return; } catch { /* 아직 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`E2E 스택: ${what} 기동 시간 초과`);
}
const up = (url: string) => async () => (await fetch(url)).status < 500;

export default async function globalSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uame2e-'));
  const data = path.join(dir, 'data');
  const sock = path.join(dir, 's.sock');
  const store = path.join(dir, 'store');
  fs.mkdirSync(store);
  const log = (n: string) => fs.openSync(path.join(dir, `${n}.log`), 'a');

  execFileSync('mariadb-install-db', [`--datadir=${data}`, '--auth-root-authentication-method=normal', '--skip-test-db'], { stdio: 'ignore' });
  procs.push(spawn('mariadbd', [`--datadir=${data}`, `--socket=${sock}`, '--skip-networking', `--pid-file=${path.join(dir, 'm.pid')}`, `--log-error=${path.join(dir, 'err.log')}`], { stdio: 'ignore' }));
  await waitFor(() => fs.existsSync(sock), 'MariaDB');
  execFileSync('mariadb', ['--socket', sock, '-uroot', '-e', 'CREATE DATABASE uam_e2e CHARACTER SET utf8mb4'], { stdio: 'ignore' });

  const env = {
    ...process.env,
    DB_SOCKET: sock, DB_USER: 'root', DB_PASSWORD: '', DB_NAME: 'uam_e2e',
    APP_PORT: String(API_PORT), SESSION_SECRET: 'e2e-session-secret', AUTH_HMAC_SECRET: 'e2e-hmac',
    STORAGE_ROOT: store, SECURE_COOKIES: 'false', APP_BASE_URL: `http://127.0.0.1:${WEB_PORT}`,
    MAIL_SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}`, MAIL_FROM: 'no-reply@e2e.test',
    // 카카오 로그인(D36)은 가짜 카카오로 — 실제 카카오·실제 키를 쓰지 않는다
    KAKAO_REST_API_KEY: 'e2e-kakao-key', KAKAO_CLIENT_SECRET: 'e2e-kakao-secret',
    KAKAO_AUTH_BASE: `http://127.0.0.1:${KAKAO_PORT}`, KAKAO_API_BASE: `http://127.0.0.1:${KAKAO_PORT}`,
    MODEL_API_INTERNAL_URL: 'http://127.0.0.1:9', LLM_SERVER_URL: 'http://127.0.0.1:9', CAPTION_ENABLED: 'false',
  };
  execFileSync(path.join(API, 'node_modules/.bin/tsx'), ['scripts/migrate.ts'], { cwd: API, env, stdio: 'ignore' });
  // 운영 화면 시험용 팀원(세 역할 모두) — 운영 CLI 그대로(T018), 비밀번호는 표준 입력
  execFileSync(path.join(API, 'node_modules/.bin/tsx'), ['scripts/ops/staff.ts', 'add', '--email', STAFF.email, '--role', 'operator,evaluator,integrator'],
    { cwd: API, env, input: STAFF.password, stdio: ['pipe', 'ignore', 'ignore'] });

  const kakaoFake = await startKakaoFake(KAKAO_PORT);
  procs.push(spawn(path.join(os.homedir(), '.local/bin/mailpit'), ['--smtp', `127.0.0.1:${SMTP_PORT}`, '--listen', `127.0.0.1:${MAIL_PORT}`, '--database', path.join(dir, 'mail.db')], { stdio: ['ignore', log('mailpit'), log('mailpit')] }));
  procs.push(spawn(path.join(API, 'node_modules/.bin/tsx'), ['src/server.ts'], { cwd: API, env, stdio: ['ignore', log('api'), log('api')] }));
  // 삭제(S9)를 끝까지 처리하는 sweeper(10초 주기, pm2 'sweeper'와 같은 진입점)
  procs.push(spawn(path.join(API, 'node_modules/.bin/tsx'), ['src/sweeper/main.ts'], { cwd: API, env, stdio: ['ignore', log('sweeper'), log('sweeper')] }));
  // 액자 경로(frame_compose)를 처리하는 CPU 워커 — 모델 없이 도는 단계만 실제로 돈다(활성 모델 없음, p1과 같음)
  const run = path.join(dir, 'run');
  fs.mkdirSync(run);
  procs.push(spawn(path.join(ROOT, 'serving/.venv/bin/python'), ['-m', 'workers.main', '--group', 'cpu_vision'], {
    cwd: path.join(ROOT, 'serving'), env: { ...env, UAM_RUN_DIR: run, GPU_ENABLED: 'false' }, stdio: ['ignore', log('worker'), log('worker')],
  }));
  await waitFor(up(`http://127.0.0.1:${MAIL_PORT}/api/v1/info`), 'Mailpit');
  await waitFor(up(`http://127.0.0.1:${API_PORT}/live`), 'app-api');

  process.env.E2E_DB_SOCKET = sock; // 흐름 시험이 상태를 직접 확인할 때만(쓰기 금지 원칙은 시험 파일에서)
  process.env.E2E_DIR = dir;
  return async () => {
    kakaoFake.close();
    // 끝나기를 기다린 뒤 지운다(MariaDB가 닫히며 파일을 쓰는 중이면 ENOTEMPTY)
    await Promise.all(procs.reverse().map((p) => new Promise<void>((r) => {
      if (p.exitCode !== null || p.signalCode) return r();
      const t = setTimeout(() => { p.kill('SIGKILL'); r(); }, 10000);
      p.once('exit', () => { clearTimeout(t); r(); });
      p.kill('SIGTERM');
    })));
    if (!process.env.E2E_KEEP) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
}
