// 평가 묶음 일괄 등록 운영 CLI(T164, FR-17, BR-MDL-04, G20, UC9 A6). 모델을 켜려면(G22) 평가 항목이 있어야 한다.
//   npm run ops:eval-items -- import --manifest ../eval/items/manifest.yaml --dir <사진 폴더> --by <평가 담당 이메일> [--dry-run]
//   npm run ops:eval-items -- status --manifest ../eval/items/manifest.yaml
// - 매니페스트 items 가운데 id가 비어 있는 항목만 등록하고, 받은 item_id를 매니페스트에 되적는다(주석·순서 유지).
// - G20: maker(만든 팀원) 필수. 등록자는 평가 담당 역할이어야 한다. 사진은 화면 등록과 같은 검사(validateUpload)를 거치고 evalset/ 소유로 저장한다.
// - 실제 아이 사진·공개 이미지는 넣지 않는다(BR-MDL-04) — 확인 책임은 maker에게 있고 CLI는 이름이 비면 거부한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import YAML from 'yaml';
import { loadConfig } from '../../src/config.js';
import { LocalFsDriver } from '../../src/storage/LocalFsDriver.js';
import { validateUpload } from '../../src/modules/artworks/validateUpload.js';

const CATEGORIES = ['person', 'non_person', 'capture_condition', 'sculpture', 'caption_input'] as const;
const PATHS = ['animated', 'relief', 'frame', 'sculpture', 'caption'] as const;

export interface ManifestItem {
  id?: number | string | null; category: string; expected_path: string; maker?: string; file?: string; text?: string; note?: string;
}

/** 등록 전 검사 — 문제면 사유 코드, 통과면 null. */
export function checkItem(it: ManifestItem): string | null {
  if (!CATEGORIES.includes(it.category as never)) return 'category';
  if (!PATHS.includes(it.expected_path as never)) return 'expected_path';
  if (!it.maker || !String(it.maker).trim()) return 'maker_missing'; // G20 팀원 제작 확인
  if (it.category === 'caption_input') return it.text?.trim() && !it.file ? null : 'caption_needs_text_only';
  return it.file ? null : 'photo_missing';
}

export async function importItems(opts: { manifest: string; dir: string; by: string; dryRun?: boolean; env?: NodeJS.ProcessEnv }) {
  const cfg = loadConfig(opts.env);
  const doc = YAML.parseDocument(await fs.readFile(opts.manifest, 'utf8'));
  const items = (doc.get('items') as YAML.YAMLSeq | undefined);
  const list = (items?.toJSON() ?? []) as ManifestItem[];
  const c = cfg.db;
  const conn = await mysql.createConnection({ host: c.socketPath ? undefined : c.host, port: c.socketPath ? undefined : c.port, socketPath: c.socketPath, user: c.user, password: c.password, database: c.database });
  const storage = new LocalFsDriver(cfg.storageRoot);
  const done: { index: number; id: number }[] = [];
  const skipped: { index: number; reason: string }[] = [];
  try {
    const [m] = await conn.query(
      `SELECT t.member_id FROM team_member t JOIN team_member_role r ON r.member_id = t.member_id
        WHERE t.email = ? AND r.role = 'evaluator' AND t.disabled_at IS NULL`, [opts.by]);
    const memberId = (m as { member_id: number }[])[0]?.member_id;
    if (!memberId) throw new Error(`평가 담당 팀원이 아님: ${opts.by}`);
    for (const [i, it] of list.entries()) {
      if (it.id) continue;
      const bad = checkItem(it);
      if (bad) { skipped.push({ index: i, reason: bad }); continue; }
      let objectId: number | null = null;
      let key: string | null = null;
      let photo: { buf: Buffer; ext: string } | null = null;
      if (it.category !== 'caption_input') {
        let buf: Buffer;
        try { buf = await fs.readFile(path.join(opts.dir, it.file!)); } catch { skipped.push({ index: i, reason: 'file_not_found' }); continue; }
        try { photo = { buf, ext: (await validateUpload(buf)).ext }; } catch { skipped.push({ index: i, reason: 'photo_invalid' }); continue; }
      }
      if (opts.dryRun) { done.push({ index: i, id: 0 }); continue; } // 시험: 같은 검사까지만, 쓰지 않음
      if (photo) {
        key = `evalset/${randomUUID().replace(/-/g, '')}.${photo.ext}`;
        await storage.putNew(key, photo.buf);
      }
      try {
        await conn.beginTransaction();
        if (key) {
          const [o] = await conn.query(`INSERT INTO stored_object (owner_kind, object_kind, object_key) VALUES ('eval_set', 'eval_input', ?)`, [key]);
          objectId = (o as { insertId: number }).insertId;
        }
        const [ins] = await conn.query(
          `INSERT INTO eval_item (category, expected_path, object_id, input_text, created_by, maker_attested) VALUES (?, ?, ?, ?, ?, TRUE)`,
          [it.category, it.expected_path, objectId, it.category === 'caption_input' ? it.text!.trim() : null, memberId]);
        await conn.commit();
        done.push({ index: i, id: (ins as { insertId: number }).insertId });
      } catch (e) {
        await conn.rollback();
        if (key) await storage.delete(key).catch(() => undefined);
        skipped.push({ index: i, reason: `db:${(e as { code?: string }).code ?? 'error'}` });
      }
    }
  } finally { await conn.end(); }
  if (!opts.dryRun && done.length) {
    for (const d of done) (items!.items[d.index] as YAML.YAMLMap).set('id', d.id);
    await fs.writeFile(opts.manifest, doc.toString());
  }
  return { done, skipped };
}

export async function status(manifestPath: string) {
  const doc = YAML.parse(await fs.readFile(manifestPath, 'utf8')) as { targets?: Record<string, number>; items?: ManifestItem[] };
  const count = (cat: string, reg: boolean) => (doc.items ?? []).filter((x) => x.category === cat && Boolean(x.id) === reg).length;
  return Object.entries(doc.targets ?? {}).map(([cat, target]) => ({ category: cat, registered: count(cat, true), pending: count(cat, false), target }));
}

if (process.argv[1]?.endsWith('eval-items.ts')) {
  const [cmd, ...argv] = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const manifest = arg('manifest') ?? '../eval/items/manifest.yaml';
  if (cmd === 'status') {
    console.table(await status(manifest));
  } else if (cmd === 'import' && arg('dir') && arg('by')) {
    const r = await importItems({ manifest, dir: arg('dir')!, by: arg('by')!, dryRun: argv.includes('--dry-run') });
    console.log(`등록 ${r.done.length}건${argv.includes('--dry-run') ? '(시험 — 쓰지 않음)' : ''} · 건너뜀 ${r.skipped.length}건`);
    for (const s of r.skipped) console.log(`  항목 ${s.index + 1}: ${s.reason}`);
  } else {
    console.error('사용법: ops:eval-items import --manifest <yaml> --dir <사진 폴더> --by <평가 담당 이메일> [--dry-run] | status --manifest <yaml>');
    process.exit(2);
  }
}
