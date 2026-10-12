// API 서비스 점검(계약 대응표 2~5행, 2026-09-30) — 스키마 전수 점검: contracts/openapi.yaml의 입력 규칙에서
// 이상한 값을 만들어 모든 경로에 보내고, 서버가 422(또는 계약에 적힌 4xx)와 "무엇을 고쳐 보내라"는 안내로 거절하는지 잰다.
// 측정 도구다 — `SWEEP=1 npx vitest run tests/checklist/schema-sweep.test.ts`일 때만 돈다. 실패로 끝나지 않고 결과를 ops/checklist/schema-sweep.json에 쓴다(SWEEP_OUT로 바꿀 수 있다).
// 요청 검증은 시험 앱도 운영과 같다(helpers/app.ts validateRequests:false — 응답 계약만 본다).
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import YAML from 'yaml';
import { afterAll, describe, it } from 'vitest';
import { resetData } from '../helpers/db.js';
import { contractViolations, testApp } from '../helpers/app.js';
import { familyWithChild, png, seedModels, simulateResult, staff, upload } from '../helpers/fixtures.js';

type S = Record<string, any>;
const ROOT = path.resolve(__dirname, '../../..');
const SPEC = YAML.parse(fs.readFileSync(path.join(ROOT, 'contracts/openapi.yaml'), 'utf8')) as S;
const OUT = process.env.SWEEP_OUT ?? path.join(ROOT, 'ops/checklist/schema-sweep.json');
const deref = (s: S | undefined): S => {
  if (!s) return {};
  if (s.$ref) return deref(s.$ref.split('/').slice(1).reduce((o: S, k: string) => o[k], SPEC));
  if (s.allOf) return s.allOf.map(deref).reduce((a: S, b: S) => ({ ...a, ...b, properties: { ...a.properties, ...b.properties }, required: [...(a.required ?? []), ...(b.required ?? [])] }), {});
  return s;
};
const typeOf = (s: S) => (Array.isArray(s.type) ? s.type.find((x: string) => x !== 'null') : s.type) ?? (s.enum ? 'string' : 'string');
const nullable = (s: S) => Array.isArray(s.type) && s.type.includes('null');

/** 계약에 맞는 그럴듯한 값 — 다른 칸을 정상으로 두고 한 칸만 망가뜨리기 위해 */
function sample(s0: S, name = ''): unknown {
  const s = deref(s0);
  if (s.example !== undefined) return s.example;
  if (s.enum) return s.enum.find((e: unknown) => e !== null);
  const t = typeOf(s);
  if (t === 'object') return Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => (s.required ?? []).includes(k)).map(([k, v]) => [k, sample(v as S, k)]));
  if (t === 'array') return [sample(s.items ?? {})].slice(0, Math.max(1, s.minItems ?? 1));
  if (t === 'integer' || t === 'number') return s.minimum ?? 1;
  if (t === 'boolean') return true;
  if (s.format === 'date') return new Date(Date.now() - 86400000 * 30).toISOString().slice(0, 10);
  if (s.format === 'email' || /email/i.test(name)) return 'sweep@test.local';
  if (/password/i.test(name)) return 'correct-horse-1';
  return 'x'.repeat(Math.max(1, s.minLength ?? 1));
}

/** 한 칸을 망가뜨리는 방법들 — [이름, 값] */
function breakers(s0: S): [string, unknown][] {
  const s = deref(s0), t = typeOf(s), out: [string, unknown][] = [];
  if (t === 'string') {
    out.push(['타입 불일치(숫자)', 12345], ['공백만', '   ']);
    if (s.maxLength) out.push([`길이 초과(${s.maxLength + 1})`, '가'.repeat(s.maxLength + 1)]);
    if (s.enum) out.push(['목록 밖 값', '__nope__']);
    if (s.format === 'date') out.push(['날짜 형식 아님', '2026-13-45'], ['미래 날짜', new Date(Date.now() + 86400000 * 400).toISOString().slice(0, 10)]);
    if (s.format === 'email') out.push(['이메일 형식 아님', 'not-an-email']);
    if (s.pattern) out.push(['패턴 불일치', '!!!']);
  } else if (t === 'integer' || t === 'number') {
    out.push(['타입 불일치(문자)', 'abc']);
    if (t === 'integer') out.push(['정수 아님', 1.5]);
    if (s.minimum !== undefined) out.push([`최솟값 미만(${s.minimum - 1})`, s.minimum - 1]);
    if (s.maximum !== undefined) out.push([`최댓값 초과(${s.maximum + 1})`, s.maximum + 1]);
  } else if (t === 'boolean') out.push(['타입 불일치(문자)', 'yes']);
  else if (t === 'array') {
    out.push(['타입 불일치(문자)', 'x']);
    if (s.maxItems !== undefined) out.push([`개수 초과(${s.maxItems + 1})`, Array(s.maxItems + 1).fill(sample(s.items ?? {}))]);
    if ((s.minItems ?? 0) > 0) out.push(['빈 목록', []]);
  } else if (t === 'object') out.push(['타입 불일치(문자)', 'x']);
  if (!nullable(s)) out.push(['null', null]);
  return out;
}

interface Row { op: string; case: string; status: number; code?: string; reason?: string; fields: boolean; detail: boolean; verdict: string }
const rows: Row[] = [];
const verdict = (st: number, contractCodes: string[], reason?: string, op = '', label = '') =>
  st === 400 && reason === 'bad_json' ? '△ 400(계약 공통 bad_json)'
  : st === 200 && op === 'PUT /v1/artworks/{artworkId}/story' && !/날짜|길이|타입|null|목록/.test(label) ? '△ 200(임시 저장 D22)'
  : st === 422 ? 'O 422' : st >= 500 ? 'X 서버 오류' : st >= 200 && st < 300 ? 'X 받아들임' : st === 400 ? (contractCodes.includes('400') ? '△ 400(계약)' : 'X 400') : `? ${st}(다른 문)`;

const t = testApp();
afterAll(async () => {
  if (!process.env.SWEEP) return t.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const violations = contractViolations.splice(0);   // 이 도구는 측정만 — 계약 어긋남도 결과에 싣는다
  fs.writeFileSync(OUT, JSON.stringify({ measuredAt: new Date().toISOString(), rows, contractViolations: violations }, null, 1));
  await t.close();
});

const OPS: [string, string, S][] = [];
for (const [p, item] of Object.entries(SPEC.paths as S))
  for (const [m, op] of Object.entries(item as S))
    if (['get', 'post', 'put', 'patch', 'delete'].includes(m)) OPS.push([m, p, { ...(op as S), parameters: [...((item as S).parameters ?? []), ...((op as S).parameters ?? [])] }]);

describe.skipIf(!process.env.SWEEP)('스키마 전수 점검', () => {
  for (const [m, p, op] of OPS) {
    const params = (op.parameters as S[]).map(deref).filter((x) => x.in === 'query' || x.in === 'path');
    const json = op.requestBody?.content?.['application/json']?.schema;
    const multipart = op.requestBody?.content?.['multipart/form-data']?.schema;
    if (!params.length && !json && !multipart) continue;
    it(`${m.toUpperCase()} ${p}`, async () => {
      await resetData(t.db); t.mailer.sent.length = 0; await seedModels(t.db, ['M1', 'M2', 'M3', 'M5', 'M6']);
      const f = await familyWithChild(t, 'sweep-g@test.local');
      const up = await upload(f.a, f.childId, await png()).expect(202);
      await simulateResult(t.db, up.body.id, 'animated');
      const st = await staff(t, 'sweep-s@test.local', ['operator', 'evaluator', 'integrator']);
      const sec = (op.security ?? SPEC.security ?? []).map((x: S) => Object.keys(x)[0]);
      const agent = sec.includes('staffSession') ? st.a : sec.includes('guardianSession') ? f.a : request.agent(t.app);
      const ids: Record<string, string> = { childId: f.childId, artworkId: up.body.id, modelId: 'M1', child: f.childId };
      const codes = Object.keys(op.responses ?? {});
      const base = () => Object.fromEntries(params.map((x) => [x.name, ids[x.name] ?? String(sample(x.schema ?? {}, x.name))]));
      const send = async (label: string, pv: Record<string, string | undefined>, body?: unknown, raw?: string) => {
        const url = p.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(pv[k] ?? '')) ;
        const qs = new URLSearchParams(Object.entries(pv).filter(([k, v]) => v !== undefined && params.find((x) => x.name === k)?.in === 'query') as [string, string][]).toString();
        let req = (agent as any)[m](url + (qs ? `?${qs}` : ''));
        if (multipart) req = body === 'no-file' ? req.field('childId', f.childId) : req.attach('photo', Buffer.from('not an image'), 'x.png').field('childId', f.childId);
        else if (raw !== undefined) req = req.set('content-type', 'application/json').send(raw);
        else if (body !== undefined) req = req.send(body as object);
        if (m === 'post' && p === '/v1/artworks') req = req.set('Idempotency-Key', `sweep-${rows.length}-${Date.now()}`);
        const r = await req;
        const b = (r.body ?? {}) as S;
        rows.push({ op: `${m.toUpperCase()} ${p}`, case: label, status: r.status, code: b.code, reason: b.reason, fields: Array.isArray(b.fields) && b.fields.length > 0,
          detail: typeof b.detail === 'string' && b.detail.length > 0, verdict: verdict(r.status, codes, b.reason, `${m.toUpperCase()} ${p}`, label) });
      };
      // 경로·쿼리 칸
      for (const x of params) {
        if (x.required && x.in === 'query') await send(`쿼리 ${x.name} 없음`, { ...base(), [x.name]: undefined }, json ? sample(json) : undefined);
        for (const [n, v] of [['타입 불일치(문자)', 'abc'], ['음수', '-1'], ['아주 큰 수', '99999999999999999999']] as const)
          if (['integer', 'number'].includes(typeOf(deref(x.schema ?? {}))) || /Id$|^child$/.test(x.name)) await send(`${x.in} ${x.name} ${n}`, { ...base(), [x.name]: v }, json ? sample(json) : undefined);
        if (deref(x.schema ?? {}).format === 'date') await send(`${x.in} ${x.name} 날짜 형식 아님`, { ...base(), [x.name]: '2026-13-45' }, json ? sample(json) : undefined);
      }
      // JSON 본문 칸
      if (json) {
        const s = deref(json), good = sample(s) as S;
        await send('본문 빈 객체', base(), {});
        await send('본문 JSON 깨짐', base(), undefined, '{"a":');
        await send('본문 배열', base(), []);
        await send('모르는 칸 추가', base(), { ...good, __unknown: 1 });
        for (const k of s.required ?? []) { const { [k]: _drop, ...rest } = good; await send(`필수 ${k} 없음`, base(), rest); }
        for (const [k, v] of Object.entries(s.properties ?? {})) {
          const typo = k.length > 1 ? `${k}${k.at(-1)}` : `${k}_`;
          if ((s.required ?? []).includes(k)) { const { [k]: val, ...rest } = good; await send(`칸 이름 오타 ${k}→${typo}`, base(), { ...rest, [typo]: val ?? sample(v as S, k) }); }
          for (const [n, bad] of breakers(v as S)) await send(`${k} ${n}`, base(), { ...good, [k]: bad });
        }
      }
      if (multipart) { await send('파일 없음', base(), 'no-file'); await send('이미지 아닌 파일', base(), 'bad-file'); }
    });
  }
});
