// 계약 문서 점검(2026-09-30 API 서비스 점검표 E3·E4·E5·E7·E8, 계약 5행): 두 계약(app-api·model-api)에
// 연락처(팀 채널 이름만)·상태코드 표와 「누가 고치나」·판단보류 설명·필드 설명·예시가 있고, 예시는 ops/checklist/examples 파일과 같으며 실제로 통과한다.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { resetData } from './helpers/db.js';
import { testApp } from './helpers/app.js';
import { familyWithChild, png, seedModels, simulateResult, upload } from './helpers/fixtures.js';

const ROOT = path.resolve(__dirname, '../..');
type S = Record<string, any>;
const load = (f: string) => YAML.parse(fs.readFileSync(path.join(ROOT, 'contracts', f), 'utf8')) as S;
const APP = load('openapi.yaml'), MODEL = load('model-api.openapi.yaml');
const example = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'ops/checklist/examples', f), 'utf8'));
const bodyExample = (spec: S, p: string, m: string) => spec.paths[p][m].requestBody.content['application/json'].example;

describe.each([['app-api', APP], ['model-api', MODEL]])('%s 계약 문서', (_n, spec: S) => {
  it('E8 연락처 — 팀 채널 이름만(이메일·전화 없음)', () => {
    expect(spec.info.contact?.name).toMatch(/1팀/);
    expect(JSON.stringify(spec.info.contact)).not.toMatch(/@|\d{3}-\d{3,4}-\d{4}/);
  });
  it('E7 상태코드 표와 「누가 고치나」', () => {
    const d: string = spec.info.description;
    expect(d).toMatch(/누가 고치나/);
    for (const c of ['200', '400', '401', '404', '413', '422', '429', '503']) expect(d).toMatch(new RegExp(`\\| ${c} `));
  });
  it('E5 판단보류 — 뜻과 행선지', () => {
    expect(spec.info.description).toMatch(/판단보류/);
  });
});

describe('model-api E4 필드 설명', () => {
  it('ExtJob·ExtResult·ModelRef 모든 칸에 description', () => {
    for (const n of ['ExtJob', 'ExtResult', 'ModelRef']) {
      const props = MODEL.components.schemas[n].properties as S;
      for (const [k, v] of Object.entries(props)) expect(v.description, `${n}.${k}`).toBeTruthy();
    }
  });
});

describe('app-api 계약 5행 — 미래 날짜 규칙이 문서에', () => {
  it('Story.madeOn 설명에 미래 날짜 거절', () => {
    expect(APP.components.schemas.Story.properties.madeOn.description).toMatch(/미래/);
  });
});

describe('E3 예시 = examples 파일, 그리고 실제로 통과', () => {
  const t = testApp();
  afterAll(async () => t.close());
  it('POST /v1/children · PUT story · POST decision', async () => {
    expect(bodyExample(APP, '/v1/children', 'post')).toEqual(example('children.post.json'));
    expect(bodyExample(APP, '/v1/artworks/{artworkId}/story', 'put')).toEqual(example('story.put.json'));
    expect(bodyExample(APP, '/v1/artworks/{artworkId}/decision', 'post')).toEqual(example('decision.post.json'));
    await resetData(t.db); await seedModels(t.db, ['M1', 'M2', 'M3', 'M5']);
    const g = await familyWithChild(t, 'example@test.local');
    await g.a.post('/v1/children').send(example('children.post.json')).expect(201);
    const art = (await upload(g.a, g.childId, await png()).expect(202)).body.id;
    await simulateResult(t.db, art, 'animated');
    await g.a.post(`/v1/artworks/${art}/decision`).send(example('decision.post.json')).expect(200);
    // D46: 올린 뒤에는 이야기를 고칠 수 없다 — 예시 본문은 형식이 맞아도 409 artwork_locked
    expect((await g.a.put(`/v1/artworks/${art}/story`).send(example('story.put.json')).expect(409)).body.reason).toBe('artwork_locked');
  });
});
