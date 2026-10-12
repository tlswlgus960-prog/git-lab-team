// Local development entry point. Server deployments keep their own environment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function localEnvironment(root = ROOT, inherited = process.env) {
  const filename = path.join(root, '.env');
  const file = fs.existsSync(filename) ? parseEnv(fs.readFileSync(filename, 'utf8')) : {};
  const env = { ...file, ...inherited };
  const defaults = {
    STORAGE_ROOT: '.data/store', MODEL_ROOT: 'models', MODEL_MANIFEST: 'models/manifest.yaml',
    CONTRACTS_DIR: 'contracts', UAM_RUN_DIR: 'serving/.run',
  };
  for (const [key, fallback] of Object.entries(defaults)) {
    env[key] = path.resolve(root, env[key] || fallback);
  }
  for (const key of ['M3_AD_PYTHON', 'M3_AD_ROOT', 'M7_PYTHON']) {
    if (env[key]) env[key] = path.resolve(root, env[key]);
  }
  env.APP_API_URL ||= `http://127.0.0.1:${env.APP_PORT || 9521}`;
  env.MODEL_API_INTERNAL_URL ||= `http://127.0.0.1:${env.MODEL_API_PORT || 9541}`;
  env.MODEL_API_URL ||= env.MODEL_API_INTERNAL_URL;
  env.APP_BASE_URL ||= `http://127.0.0.1:${env.WEB_PORT || 9501}`;
  return env;
}

export function initialize(root = ROOT) {
  const template = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const content = template.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(32).toString('hex')}`)
    .replace(/^AUTH_HMAC_SECRET=.*$/m, `AUTH_HMAC_SECRET=${randomBytes(32).toString('hex')}`);
  fs.writeFileSync(path.join(root, '.env'), content, { flag: 'wx', mode: 0o600 });
}

export function commandFor(action, env, root = ROOT, platform = process.platform) {
  const python = env.UAM_PYTHON || path.join(root, 'serving', '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const tsx = path.join(root, 'api/node_modules/tsx/dist/cli.mjs');
  const actions = {
    web: ['web', process.execPath, [path.join(root, 'web/node_modules/vite/bin/vite.js')]],
    api: ['api', process.execPath, [tsx, 'watch', 'src/server.ts']],
    migrate: ['api', process.execPath, [tsx, 'scripts/migrate.ts']],
    sweeper: ['api', process.execPath, [tsx, 'src/sweeper/main.ts']],
    model: ['serving', python, ['-m', 'model_api.main']],
    worker: ['serving', python, ['-m', 'workers.main', '--group', 'cpu_vision']],
    gpu: ['serving', python, ['-m', 'workers.main', '--group', 'gpu']],
    llm: ['serving', python, ['-m', 'llm_server.main']],
  };
  if (!actions[action]) throw new Error(`Unknown command: ${action}. Use init or ${Object.keys(actions).join(', ')}.`);
  const [directory, executable, args] = actions[action];
  return { cwd: path.join(root, directory), executable, args };
}

export function main(action) {
  if (action === 'init') {
    initialize();
    console.log('Created .env. Set your local DB user/password before running db:migrate.');
    return;
  }
  const env = localEnvironment();
  if (!fs.existsSync(path.join(ROOT, '.env'))) throw new Error('Run npm run init first, then configure the local database in .env.');
  const command = commandFor(action, env);
  const child = spawn(command.executable, command.args, { cwd: command.cwd, env, stdio: 'inherit', shell: false });
  child.on('error', (error) => {
    console.error(`Cannot start ${action}: ${error.code}. Install dependencies using README.md.`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv[2]); }
  catch (error) {
    console.error(error.code === 'EEXIST' ? '.env already exists; preserved without changes.' : error.message);
    process.exitCode = 1;
  }
}
