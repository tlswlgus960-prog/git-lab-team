// 사진 자산 규칙(SD_04 §3-3 "사진 자산", 2026-09-30): manifest.json {nodes:[…]}의 노드는 두 형식이다.
//   tip  — <노드>/<desktop|mobile>/<면>.webp, faces[{name,src,w,h,tf}]·camera·box, 예산 desktop 2MB·mobile 900KB (ops/museum/tip2faces.py)
//   cube — <노드>/<1024|2048>/{px,nx,py,ny,pz,nz}.webp, position, 예산 1024판 900KB·2048판 3MB (ops/museum/pano2cube.py)
// 공통: 출처(https)·작가·허용 라이선스·원본 크기. 목록과 폴더가 어긋나거나 용량이 틀리면 실패.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../public/museum/photos');
const CUBE_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const CUBE_BUDGET: Record<string, number> = { '1024': 900 * 1024, '2048': 3 * 1024 * 1024 };
const TIP_BUDGET: Record<string, number> = { desktop: 2 * 1024 * 1024, mobile: 900 * 1024 };
const LICENSE = /^(PD|CC0|CC BY( \d\.\d)?|CC BY-SA( \d\.\d)?)$/;

interface Face { name: string; src: string; w: number; h: number; tf: string }
interface Node {
  id: string; kind?: 'tip' | 'cube'; title: string; source: string; author: string; license: string;
  original?: { width: number; height: number }; bytes?: Record<string, number>;
  position?: { x: number; z: number }; camera?: Record<string, number>; box?: Record<string, number>; faces?: Face[];
}

/** 한 벌(폴더)의 파일이 목록과 같고 예산·용량이 맞는지 */
function checkVariant(errs: string[], w: string, vdir: string, files: string[], label: string, limit: number, recorded: number | undefined) {
  const listed = new Set(files);
  if (fs.existsSync(vdir)) for (const f of fs.readdirSync(vdir)) if (!listed.has(f)) errs.push(`${w}: ${label}/${f} 목록에 없는 면`);
  let total = 0;
  for (const f of files) {
    const p = path.join(vdir, f);
    if (!fs.existsSync(p)) { errs.push(`${w}: ${label}/${f} 없음`); continue; }
    total += fs.statSync(p).size;
  }
  if (total > limit) errs.push(`${w}: ${label} ${total}B > 예산 ${limit}B`);
  if (recorded !== total) errs.push(`${w}: bytes.${label} ${recorded} ≠ 실제 ${total}`);
}

export function checkPhotos(dir: string): string[] {
  const errs: string[] = [];
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) return ['manifest.json 없음'];
  let doc: { nodes?: Node[] };
  try { doc = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { return ['manifest.json이 JSON이 아님']; }
  if (!Array.isArray(doc.nodes)) return ['manifest.json은 {nodes:[…]}'];
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !ids.has(e.name)) errs.push(`${e.name}/: 목록에 없는 노드(출처·라이선스를 적어야 함)`);
    if (e.isFile() && e.name !== 'manifest.json') errs.push(`${e.name}: 노드 폴더 밖 파일`);
  }
  for (const n of doc.nodes) {
    const w = n.id ?? '(id 없음)';
    for (const k of ['id', 'title', 'source', 'author', 'license'] as const) if (!n[k] || typeof n[k] !== 'string') errs.push(`${w}: ${k} 없음`);
    if (n.source && !/^https:\/\//.test(n.source)) errs.push(`${w}: source는 원본 페이지 https URL`);
    if (n.license && !LICENSE.test(n.license)) errs.push(`${w}: 허용 밖 라이선스 "${n.license}"(PD·CC0·CC BY·CC BY-SA만)`);
    const o = n.original;
    if (!o || !(o.width > 0) || !(o.height > 0)) errs.push(`${w}: original{width,height} 없음`);
    const nodeDir = path.join(dir, n.id ?? '');
    if (n.kind === 'tip') {
      if (!n.camera || !['vx', 'vy', 'f'].every((k) => typeof n.camera?.[k] === 'number')) errs.push(`${w}: camera{vx,vy,f} 없음`);
      if (!n.box || !['xl', 'xr', 'yf', 'yc', 'zb'].every((k) => typeof n.box?.[k] === 'number')) errs.push(`${w}: box{xl,xr,yf,yc,zb} 없음`);
      if (!Array.isArray(n.faces) || !n.faces.length) { errs.push(`${w}: faces 없음`); continue; }
      for (const f of n.faces) if (!f.name || !f.src || !(f.w > 0) || !(f.h > 0) || !f.tf) errs.push(`${w}: 면 ${f.name ?? '?'}의 name·src·w·h·tf 빠짐`);
      for (const [v, limit] of Object.entries(TIP_BUDGET)) checkVariant(errs, w, path.join(nodeDir, v), n.faces.map((f) => f.src), v, limit, n.bytes?.[v]);
      continue;
    }
    if (o && o.height > 0 && Math.abs(o.width / o.height - 2) > 0.02) errs.push(`${w}: cube의 original은 2:1 등장방형 크기`);
    if (typeof n.position?.x !== 'number' || typeof n.position?.z !== 'number') errs.push(`${w}: position{x,z} 없음`);
    for (const [size, limit] of Object.entries(CUBE_BUDGET)) checkVariant(errs, w, path.join(nodeDir, size), CUBE_FACES.map((f) => `${f}.webp`), size, limit, n.bytes?.[size]);
  }
  return errs;
}

function fixture(nodes: unknown[], files: Record<string, number>) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-'));
  for (const [f, size] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), Buffer.alloc(size)); }
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ nodes }));
  return d;
}
const common = { title: '그랑드 갤러리', source: 'https://commons.wikimedia.org/wiki/File:x.jpg', author: '작가', license: 'CC BY-SA 4.0' };
const cubeFiles = (id: string, size: string, each: number) => Object.fromEntries(CUBE_FACES.map((f) => [`${id}/${size}/${f}.webp`, each]));
const cube = { ...common, id: 'g-v1', original: { width: 8000, height: 4000 }, position: { x: 0, z: 0 }, bytes: { '1024': 60, '2048': 120 } };
const tipFaces: Face[] = [{ name: 'floor_8', src: 'floor_8.webp', w: 980, h: 400, tf: 'rotateX(90deg)' },
  { name: 'back', src: 'back.webp', w: 980, h: 780, tf: 'translate3d(0,0,-15000px)' }];
const tipFiles = (id: string, v: string, each: number) => Object.fromEntries(tipFaces.map((f) => [`${id}/${v}/${f.src}`, each]));
const tip = { ...common, id: 't-v1', kind: 'tip', original: { width: 2887, height: 2887 }, camera: { vx: 1468, vy: 1896, f: 5780 },
  box: { xl: -5.4, xr: 4.4, yf: 1.5, yc: -6.3, zb: 150 }, faces: tipFaces, bytes: { desktop: 30, mobile: 20 } };
const run = (nodes: unknown[], files: Record<string, number>) => { const d = fixture(nodes, files); const e = checkPhotos(d); fs.rmSync(d, { recursive: true, force: true }); return e; };

describe('사진 자산(SD_04 §3-3)', () => {
  it('실제 폴더: 모든 노드가 목록에 있고 규칙을 지킨다', () => {
    expect(checkPhotos(DIR)).toEqual([]);
  });
  it('tip·cube 올바른 노드는 통과', () => {
    expect(run([tip, cube], { ...tipFiles('t-v1', 'desktop', 15), ...tipFiles('t-v1', 'mobile', 10), ...cubeFiles('g-v1', '1024', 10), ...cubeFiles('g-v1', '2048', 20) })).toEqual([]);
  });
  it('tip: 검사가 실제로 잡는다 — camera 없음·목록 밖 면·면 빠짐·예산 초과', () => {
    const { camera: _c, ...noCam } = tip;
    const errs = run([{ ...noCam, bytes: { desktop: 1, mobile: 1 } }], {
      ...tipFiles('t-v1', 'desktop', 1100 * 1024), 't-v1/desktop/stray.webp': 5, 't-v1/mobile/floor_8.webp': 10,
    }).join('\n');
    expect(errs).toMatch(/t-v1: camera\{vx,vy,f\} 없음/);
    expect(errs).toMatch(/t-v1: desktop\/stray\.webp 목록에 없는 면/);
    expect(errs).toMatch(/t-v1: mobile\/back\.webp 없음/);
    expect(errs).toMatch(/t-v1: desktop \d+B > 예산/);
  });
  it('cube: 검사가 실제로 잡는다 — 권리 불명 라이선스·목록 없는 노드·면 빠짐·예산 초과·용량 불일치', () => {
    const bad = { ...cube, id: 'b-v1', license: '© Louvre', source: 'http://www.louvre.fr/x', bytes: { '1024': 1, '2048': 1 } };
    const errs = run([bad], {
      ...cubeFiles('b-v1', '1024', 200 * 1024), ...Object.fromEntries(Object.entries(cubeFiles('b-v1', '2048', 10)).slice(0, 5)),
      ...cubeFiles('stray-v1', '1024', 10),
    }).join('\n');
    expect(errs).toMatch(/stray-v1\/: 목록에 없는 노드/);
    expect(errs).toMatch(/b-v1: 허용 밖 라이선스/);
    expect(errs).toMatch(/b-v1: source는 원본 페이지 https URL/);
    expect(errs).toMatch(/b-v1: 2048\/nz\.webp 없음/);
    expect(errs).toMatch(/b-v1: 1024 \d+B > 예산/);
    expect(errs).toMatch(/b-v1: bytes\.1024 1 ≠ 실제/);
  });
});
