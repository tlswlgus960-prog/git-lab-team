// 시험용 임시 MariaDB(네트워크 끔, 소켓만). 기준 마이그레이션을 적용하고 소켓 경로를 시험에 넘긴다.
// 팀 DB에는 절대 붙지 않는다(R-19).
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { migrate } from '../../scripts/migrate.js';

let proc: ChildProcess | undefined;
let dir: string | undefined;

export async function setup({ provide }: { provide: (k: 'DB_SOCKET', v: string) => void }) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uamb-'));
  const data = path.join(dir, 'data');
  const sock = path.join(dir, 's.sock');
  execFileSync('mariadb-install-db', [`--datadir=${data}`, '--auth-root-authentication-method=normal', '--skip-test-db'], { stdio: 'ignore' });
  proc = spawn('mariadbd', [`--datadir=${data}`, `--socket=${sock}`, '--skip-networking', `--pid-file=${path.join(dir, 'm.pid')}`, `--log-error=${path.join(dir, 'err.log')}`], { stdio: 'ignore' });
  for (let i = 0; i < 80 && !fs.existsSync(sock); i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 300));
  const root = await mysql.createConnection({ socketPath: sock, user: 'root' });
  await root.query('CREATE DATABASE uam_test CHARACTER SET utf8mb4');
  await root.changeUser({ database: 'uam_test' });
  await migrate(root);
  await root.end();
  provide('DB_SOCKET', sock);
}

export async function teardown() {
  proc?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

declare module 'vitest' {
  export interface ProvidedContext { DB_SOCKET: string }
}
