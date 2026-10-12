// 경로·쿼리 입력 공통 검사(contracts/openapi.yaml 머리말 "경로·쿼리 입력 공통 오류", 2026-09-30 API 서비스 점검표 계약 2·4·5행).
// 계약의 경로 파라미터·쿼리 파라미터 규칙(required·pattern·enum·format date)을 라우터보다 먼저 확인해
// 422 validation_failed·reason invalid_param·fields로 거절한다 — 형식이 틀린 값이 소유 확인(404)·DB(503)로 번지거나 200으로 통과하지 않게.
// 본문(JSON) 검사는 경로마다 하던 대로 둔다.
import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';
import YAML from 'yaml';
import { Problem } from './problem.js';

interface Schema { type?: string | string[]; pattern?: string; enum?: unknown[]; format?: string }
interface Param { name: string; in: string; required?: boolean; schema?: Schema; $ref?: string }
interface Route { method: string; re: RegExp; names: string[]; params: Param[]; literal: number }
export interface Field { name: string; reason: 'required' | 'not_positive_integer' | 'not_in_enum' | 'not_date' | 'pattern'; message?: string }

const ID_PATTERN = '^[1-9][0-9]{0,17}$';
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const isDate = (v: string) => {
  const m = DATE.exec(v);
  if (!m) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

function check(p: Param, v: string | undefined): Field | null {
  if (v === undefined || v === '') return p.required ? { name: p.name, reason: 'required' } : null;
  const s = p.schema ?? {};
  if (s.enum && !s.enum.includes(v)) return { name: p.name, reason: 'not_in_enum', message: `허용 값 중 하나여야 합니다: ${s.enum.join(', ')}.` };
  if (s.pattern && !new RegExp(s.pattern).test(v)) return { name: p.name, reason: s.pattern === ID_PATTERN ? 'not_positive_integer' : 'pattern' };
  if (s.format === 'date' && !isDate(v)) return { name: p.name, reason: 'not_date' };
  return null;
}

export function loadRoutes(spec: { paths?: Record<string, Record<string, unknown>>; components?: { parameters?: Record<string, Param> } }): Route[] {
  const refs = spec.components?.parameters ?? {};
  const deref = (p: Param): Param => (p.$ref ? refs[p.$ref.split('/').pop()!] : p);
  const out: Route[] = [];
  for (const [tpl, item] of Object.entries(spec.paths ?? {})) {
    const shared = ((item.parameters as Param[] | undefined) ?? []).map(deref);
    const names: string[] = [];
    const re = new RegExp(`^${tpl.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '{' || c === '}' ? c : `\\${c}`))
      .replace(/\{(\w+)\}/g, (_, n: string) => { names.push(n); return '([^/]*)'; })}$`);
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const own = (((op as { parameters?: Param[] }).parameters) ?? []).map(deref);
      const params = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own]
        .filter((p) => p.in === 'path' || p.in === 'query');
      if (!params.length) continue;
      out.push({ method: method.toUpperCase(), re, names, params, literal: tpl.replace(/\{\w+\}/g, '').length });
    }
  }
  return out.sort((a, b) => b.literal - a.literal); // 글자 경로가 긴 것부터 — /invites/lookup이 /invites/{inviteId}보다 먼저
}

export function paramGuard(contractsDir: string): RequestHandler {
  const routes = loadRoutes(YAML.parse(fs.readFileSync(path.join(contractsDir, 'openapi.yaml'), 'utf8')));
  return (req, _res, next) => {
    const route = routes.find((r) => r.method === req.method && r.re.test(req.path));
    if (!route) return next();
    const m = route.re.exec(req.path)!;
    const fields: Field[] = [];
    for (const p of route.params) {
      let v: string | undefined;
      if (p.in === 'path') {
        try { v = decodeURIComponent(m[route.names.indexOf(p.name) + 1] ?? ''); } catch { v = '\u0000'; }
      } else {
        const q = req.query[p.name];
        v = typeof q === 'string' ? q : Array.isArray(q) ? '\u0000' : undefined; // 같은 이름 여러 번은 형식 오류
      }
      const f = check(p, v);
      if (f) fields.push(f);
    }
    next(fields.length ? new Problem('validation_failed', 'invalid_param', undefined, fields) : undefined);
  };
}
