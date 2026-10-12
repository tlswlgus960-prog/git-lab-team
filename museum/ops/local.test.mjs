import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandFor, initialize, localEnvironment } from './local.mjs';

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'museum-local-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('all processes share root-relative paths and inherited environment wins', (t) => {
  const root = directory(t);
  fs.writeFileSync(path.join(root, '.env'), 'STORAGE_ROOT="data with spaces"\nAPP_PORT=9801\nMODEL_API_PORT=9802\nDB_PASSWORD="value#with hash"\n');
  const env = localEnvironment(root, { APP_PORT: '9901' });
  assert.equal(env.STORAGE_ROOT, path.join(root, 'data with spaces'));
  assert.equal(env.MODEL_MANIFEST, path.join(root, 'models/manifest.yaml'));
  assert.equal(env.DB_PASSWORD, 'value#with hash');
  assert.equal(env.APP_API_URL, 'http://127.0.0.1:9901');
  assert.equal(env.MODEL_API_INTERNAL_URL, 'http://127.0.0.1:9802');
  for (const action of ['api', 'model', 'worker', 'sweeper']) assert.ok(commandFor(action, env, root).cwd.startsWith(root));
});

test('init generates distinct local secrets and never overwrites user config', (t) => {
  const root = directory(t);
  fs.writeFileSync(path.join(root, '.env.example'), 'SESSION_SECRET=\nAUTH_HMAC_SECRET=\n');
  initialize(root);
  const env = localEnvironment(root, {});
  assert.match(env.SESSION_SECRET, /^[0-9a-f]{64}$/);
  assert.notEqual(env.SESSION_SECRET, env.AUTH_HMAC_SECRET);
  const before = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.throws(() => initialize(root), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), before);
});

test('platform-specific Python and current entry points are used without a shell', () => {
  assert.match(commandFor('model', {}, undefined, 'win32').executable, /Scripts[/\\]python.exe$/);
  assert.match(commandFor('worker', {}, undefined, 'linux').executable, /bin[/\\]python$/);
  assert.deepEqual(commandFor('worker', {}).args, ['-m', 'workers.main', '--group', 'cpu_vision']);
  assert.equal(commandFor('gpu', { UAM_PYTHON: 'custom-python' }).executable, 'custom-python');
  assert.throws(() => commandFor('bad', {}), /Unknown command/);
});
