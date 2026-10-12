// T011 시험: 스타일가이드 토큰이 빠짐없이 옮겨졌고(R-20), 외부 CDN을 부르지 않으며(D22 ⑧), 상태 모양 사상(SD_02 §3-5)이 있다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src/__tests__', p), 'utf8');
const guide = read('../../../design/style-guide/스타일가이드_우리아이미술관.html');
const tokens = read('../styles/tokens.css');
const all = ['index', 'tokens', 'base', 'components'].map((f) => read(`../styles/${f}.css`)).join('\n');

describe('디자인 토큰(T011)', () => {
  it('스타일가이드 :root 변수가 모두 같은 값으로 있다', () => {
    const root = guide.slice(guide.indexOf(':root{'), guide.indexOf('}', guide.indexOf(':root{')));
    const vars = [...root.matchAll(/(--[a-z0-9-]+):([^;]+);/g)].filter(([, n]) => n !== '--font-sans');
    expect(vars.length).toBeGreaterThan(30);
    for (const [, name, value] of vars) expect(tokens).toContain(`${name}:${value};`);
  });
  it('가변 글꼴을 자체 호스팅하고 외부 주소를 부르지 않는다', () => {
    expect(tokens).toContain('"Inter Variable"');
    expect(all).toContain('pretendardvariable');
    expect(all).not.toMatch(/https?:\/\//);
  });
  it('상태 모양: 차단 실선 · 보류 점선+크림 · 종결 회색 · 비활성 버튼은 aria-disabled', () => {
    expect(all).toMatch(/\.gblock\.is-block\{border:2px solid var\(--color-ink\)/);
    expect(all).toMatch(/\.gblock\.is-hold\{border:2px dashed var\(--color-ink\);background:var\(--color-block-cream\)/);
    expect(all).toMatch(/\.gblock\.is-final\{[^}]*--color-surface-soft/);
    expect(all).toContain('.btn[aria-disabled="true"]');
    expect(all).not.toContain('accent-magenta);border'); // 마젠타는 상태에 쓰지 않음
  });
});
