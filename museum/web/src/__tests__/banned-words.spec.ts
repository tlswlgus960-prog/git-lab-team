// D48 ② 화면 금지어(SD_02 §17-17): 보호자 화면 문구에 개발자 말이 들어오면 실패한다.
// 대상: ko.ts(운영 부분 · 팀원 전용 사유 제외) + 기능별 copy.ts + 보호자 .vue 화면 틀의 글자. 운영 화면(/ops)은 팀원용이라 뺀다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ko, problemCopy, problemKeys } from '../copy/ko';
import { m3 } from '../app/museum3d/copy';
import { cc } from '../app/character/copy';
import { town, neighbor, home } from '../app/town/copy';
import { sc } from '../app/sound/copy';

// '큐'는 작업 큐만 — '큐레이터'는 보호자 말이다
// '댓글' → 화면 말은 '코멘트'(D46 ⑨)
const BANNED = /G\d+|판정|모델|서버|API|토큰|깊이 정보|단계별 진행|승인됨|워커|큐(?!레이)|에러|댓글/;
const OPS_KO = new Set(['ops', 'apiGuide']); // 운영 화면(/ops)
const OPS_PATHS = ['ko.shell.menu', 'ko.shell.role']; // 팀원 메뉴 · 역할 이름
const OPS_GATES = new Set(['G1', 'G20', 'G21', 'G22', 'G23', 'G30']); // 팀원 화면에서만 나오는 사유

function strings(v: unknown, path: string, out: [string, string][]) {
  if (typeof v === 'string') out.push([path, v]);
  else if (typeof v === 'function') { try { const r = (v as (...a: unknown[]) => unknown)('그림', '그림', 3); if (typeof r === 'string') out.push([path, r]); } catch { /* 인자 모양이 다르면 건너뛴다 */ } }
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
}
const hits = (list: [string, string][]) => list.filter(([p, s]) => BANNED.test(s) && !OPS_PATHS.some((o) => p.startsWith(o))).map(([p, s]) => `${p}: ${s}`);

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'ops' || n === '__tests__' ? [] : vueFiles(p);
    return p.endsWith('.vue') ? [p] : [];
  });
}
// 화면 틀의 글자: 태그 사이 글자와 aria-label · title · placeholder · alt (주석 · {{ }} 식은 뺀다)
function templateText(src: string): string[] {
  const t = src.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? '';
  const clean = t.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, ' ');
  const between = [...clean.matchAll(/>([^<>]+)</g)].map((m) => m[1]!.trim()).filter(Boolean);
  const attrs = [...clean.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]+)"/g)].map((m) => m[1]!);
  return [...between, ...attrs];
}

describe('화면 금지어(D48 ②)', () => {
  it('ko.ts 보호자 문구에 개발자 말이 없다', () => {
    const out: [string, string][] = [];
    for (const [k, v] of Object.entries(ko)) if (!OPS_KO.has(k)) strings(v, `ko.${k}`, out);
    for (const key of problemKeys) {
      const [gate, reason] = key.split(':');
      if (OPS_GATES.has(gate!)) continue;
      const p = problemCopy({ gate, reason });
      strings({ summary: p.summary, reason: p.reason, releaser: p.releaser, actions: p.actions }, key, out);
    }
    expect(hits(out)).toEqual([]);
  });
  it('기능별 copy(캐릭터 · 3D 미술관 · 마을 · 소리)에 개발자 말이 없다', () => {
    const out: [string, string][] = [];
    strings({ m3, cc, town, neighbor, home, sc }, 'copy', out);
    expect(hits(out)).toEqual([]);
  });
  it('보호자 화면 틀(.vue)의 글자에 개발자 말이 없다', () => {
    const root = resolve(process.cwd(), 'src');
    const out: [string, string][] = [];
    for (const f of vueFiles(root)) for (const s of templateText(readFileSync(f, 'utf8'))) out.push([f.slice(root.length + 1), s]);
    expect(hits(out)).toEqual([]);
  });
});
