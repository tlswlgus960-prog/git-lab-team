// T164 평가 묶음 일괄 등록 CLI: id 없는 항목만 등록하고 되적기, G20(maker 필수·평가 담당만), 사진은 evalset/ 소유.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { png, staff } from './helpers/fixtures.js';
import { importItems, status } from '../scripts/ops/eval-items.js';

const t = testApp();
afterAll(async () => t.close());
beforeEach(async () => resetData(t.db));
const env = () => ({ DB_SOCKET: inject('DB_SOCKET'), DB_USER: 'root', DB_NAME: 'uam_test', STORAGE_ROOT: t.store } as NodeJS.ProcessEnv);

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uamev-'));
  fs.writeFileSync(path.join(dir, 'p01.png'), await png());
  fs.writeFileSync(path.join(dir, 'bad.txt'), 'not an image');
  const manifest = path.join(dir, 'manifest.yaml');
  fs.writeFileSync(manifest, `# 평가 묶음 (주석 유지 확인)
targets:
  person: 2
  caption_input: 1
items:
  - {id: null, category: person, expected_path: animated, maker: 최호준, file: p01.png, note: 막대 사람}
  - {id: null, category: person, expected_path: animated, file: p01.png}
  - {id: null, category: person, expected_path: animated, maker: 이제민, file: bad.txt}
  - {id: null, category: caption_input, expected_path: caption, maker: 신지현, text: 공룡 강아지}
`);
  return { dir, manifest };
}

describe('ops:eval-items (T164)', () => {
  it('평가 담당만, maker 없는 항목·이미지 아닌 파일은 건너뛰고, 등록한 id를 되적는다(주석 유지). 다시 돌리면 새로 등록하지 않는다', async () => {
    await staff(t, 'ev@test.local', ['evaluator']);
    await staff(t, 'op@test.local', ['operator']);
    const { dir, manifest } = await setup();
    await expect(importItems({ manifest, dir, by: 'op@test.local', env: env() })).rejects.toThrow('평가 담당');
    const r = await importItems({ manifest, dir, by: 'ev@test.local', env: env() });
    expect(r.done).toHaveLength(2);
    expect(r.skipped.map((s) => s.reason)).toEqual(['maker_missing', 'photo_invalid']);
    const text = fs.readFileSync(manifest, 'utf8');
    expect(text).toContain('# 평가 묶음 (주석 유지 확인)');
    const items = YAML.parse(text).items as { id: number | null }[];
    expect(items.map((i) => Boolean(i.id))).toEqual([true, false, false, true]);
    const [rows] = await t.db.query(`SELECT i.category, i.maker_attested, o.owner_kind, o.object_key FROM eval_item i LEFT JOIN stored_object o ON o.object_id = i.object_id ORDER BY i.item_id`);
    const list = rows as { category: string; maker_attested: number; owner_kind: string | null; object_key: string | null }[];
    expect(list.map((x) => x.category)).toEqual(['person', 'caption_input']);
    expect(list[0]).toMatchObject({ owner_kind: 'eval_set', maker_attested: 1 });
    expect(list[0]!.object_key).toMatch(/^evalset\/[0-9a-f]{32}\.png$/);
    expect(fs.existsSync(path.join(t.store, list[0]!.object_key!))).toBe(true);
    expect((await importItems({ manifest, dir, by: 'ev@test.local', env: env() })).done).toHaveLength(0);
    expect(await status(manifest)).toEqual([
      { category: 'person', registered: 1, pending: 2, target: 2 },
      { category: 'caption_input', registered: 1, pending: 0, target: 1 },
    ]);
  });
  it('--dry-run은 아무것도 쓰지 않는다', async () => {
    await staff(t, 'ev2@test.local', ['evaluator']);
    const { dir, manifest } = await setup();
    const before = fs.readFileSync(manifest, 'utf8');
    expect((await importItems({ manifest, dir, by: 'ev2@test.local', dryRun: true, env: env() })).done).toHaveLength(2);
    expect(fs.readFileSync(manifest, 'utf8')).toBe(before);
    const [[n]] = (await t.db.query(`SELECT COUNT(*) n FROM eval_item`)) as unknown as [{ n: number }[]];
    expect(Number(n.n)).toBe(0);
  });
});
