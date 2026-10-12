// 운영 화면 시험: C10 모델 상태 칩(T111), S10 상태·지표(T112), S11 모델 평가·승격(T119).
// 핵심 규칙: 상태마다 문구·모양이 다르다(색만으로 말하지 않음), 미도달 탭은 운영자만, 분모 0은 "해당 없음",
// 조작은 평가 담당만(지금 불러오기는 운영자도), 승격은 통과 판단+평가 완료+라이선스 확인일 때만, 롤백 후보 없으면 비활성화.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ModelStatusChip from '../components/ModelStatusChip.vue';
import OpsStatusView from '../ops/views/OpsStatusView.vue';
import ModelsView from '../ops/views/ModelsView.vue';
import ApiGuideView from '../ops/views/ApiGuideView.vue';
import { GUIDELINE } from '../ops/apiGuideContent';
import { useSession } from '../stores/session';
import { ko } from '../copy/ko';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { setActivePinia(createPinia()); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

function serve(map: Record<string, unknown | ((init?: RequestInit) => Response)>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).split('?')[0]!;
    const v = map[`${init?.method ?? 'GET'} ${path}`] ?? map[path];
    if (v === undefined) return json({ code: 'not_found' }, 404);
    return typeof v === 'function' ? (v as (i?: RequestInit) => Response)(init) : json(v);
  });
}
async function open(view: object, roles: string[]) {
  useSession().staff = { emailMasked: 'o***', roles: roles as never };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div/>' } }] });
  const w = mount(view, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises(); await flushPromises();
  return w;
}
const calls = (method: string, path: string) => fetchMock.mock.calls.filter(([u, i]) => String(u).startsWith(path) && (i?.method ?? 'GET') === method);
const btn = (w: ReturnType<typeof mount>, label: string) => w.findAll('button').find((b) => b.text().startsWith(label));

describe('C10 모델 상태 칩(T111)', () => {
  const chip = (props: object) => mount(ModelStatusChip, { props: { modelId: 'M1', ...props } });
  it('상태마다 문구와 모양(class)이 다르다', () => {
    const cases: [object, string, string][] = [
      [{ status: null }, 'unknown', ko.model.unknown],
      [{ status: { modelId: 'M1', licenseConfirmed: false, load: { state: 'disabled' } } }, 'inactive', ko.model.inactive_license],
      [{ status: { modelId: 'M1', licenseConfirmed: true, load: { state: 'disabled' } } }, 'not-ready', ko.model.not_loaded],
      [{ status: { modelId: 'M1', licenseConfirmed: false, load: { state: 'disabled', diagnostic: 'no_active_version' } } }, 'inactive', ko.model.inactive_promote],
      [{ status: { modelId: 'M1', licenseConfirmed: true, load: { state: 'failed' } } }, 'failed', ko.model.failed],
      [{ modelId: 'M5', status: { modelId: 'M5', licenseConfirmed: true, execDevice: 'cpu', load: { state: 'ready' } } }, 'cpu', ko.model.cpu],
      [{ modelId: 'M7', status: { modelId: 'M7', licenseConfirmed: true, load: { state: 'ready' } } }, 'hidden', ko.model.hidden],
      [{ modelId: 'M6', status: { modelId: 'M6', licenseConfirmed: true, load: null } }, 'inactive', ko.model.inactive_tier],
    ];
    for (const [p, cls, text] of cases) {
      const w = chip(p);
      expect(w.find('.mchip').classes()).toContain(cls);
      expect(w.text()).toContain(text);
      w.unmount();
    }
  });
  it('불러오는 중은 오류가 아니고 경과·남은 시간, 예상을 넘기면 "예상보다 오래 걸려요"', () => {
    const a = chip({ status: { modelId: 'M1', licenseConfirmed: true, load: { state: 'loading', elapsedSeconds: 42, remainingSeconds: 20, expectedSeconds: 62 } } });
    expect(a.text()).toContain('42초 - 남은 약 20초');
    expect(a.find('.mchip').classes()).toContain('loading');
    const b = chip({ status: { modelId: 'M1', licenseConfirmed: true, load: { state: 'loading', elapsedSeconds: 99, overdue: true } } });
    expect(b.text()).toContain(ko.model.loadingSlow);
  });
});

const manifest = [
  { modelId: 'M1', servingGroup: 'cpu_vision', exposed: true, versions: [{ id: '11', version: 'v1', licenseConfirmed: true, releaseState: 'candidate', weightsSha256: 'a'.repeat(64), latestEvalRunId: '5' }] },
  { modelId: 'M5', servingGroup: 'gpu', exposed: true, versions: [{ id: '51', version: 'v1', licenseConfirmed: true, releaseState: 'active', weightsSha256: 'b'.repeat(64), latestEvalRunId: null }] },
  { modelId: 'M7', servingGroup: 'gpu', exposed: false, versions: [] },
];
const loads = { models: [
  { modelId: 'M1', licenseConfirmed: true, execDevice: 'cpu', load: { state: 'not_loaded' }, hint: null },
  { modelId: 'M5', licenseConfirmed: true, execDevice: 'gpu', load: { state: 'ready' }, hint: null },
] };
const metrics = { service: { firstApprovalRate: null, suggestionModifyRate: 0.25, unreachedCount: 0, deletionIncompleteCount: 0, captionRuleFailRate: null },
  causes: { guardianChoice: 2, modelDowngrade: 0, guardianSwitch: 0, infraFailure: { timeout: 1 }, unreached: 0 }, models: [], queues: [], external: [] };

describe('S10 상태·지표(T112)', () => {
  const base = { '/ready': { status: 'ready' }, '/v1/ops/models': loads, '/v1/admin/metrics': metrics, '/v1/admin/models': manifest, '/v1/admin/unreached': [] };
  it('분모 0은 "해당 없음", 비율은 소수, 원인 5분류와 모델별 영향', async () => {
    serve(base);
    const w = await open(OpsStatusView, ['evaluator']);
    expect(w.text()).toContain(ko.ops.na);
    expect(w.text()).toContain('0.25');
    expect(w.text()).toContain(ko.ops.readySome);
    expect(w.text()).toContain(ko.ops.impact.M1);
    expect(w.text()).not.toContain('%');
    w.unmount();
  });
  it('결과 미도달 탭은 운영자에게만 그린다(평가 담당은 미도달 API도 부르지 않는다)', async () => {
    serve(base);
    const ev = await open(OpsStatusView, ['evaluator']);
    expect(ev.findAll('[role="tab"]').map((t) => t.text())).not.toContain(ko.ops.tabs.unreached);
    expect(calls('GET', '/v1/admin/unreached')).toHaveLength(0);
    ev.unmount();
    const op = await open(OpsStatusView, ['operator']);
    expect(op.findAll('[role="tab"]').map((t) => t.text())).toContain(ko.ops.tabs.unreached);
    op.unmount();
  });
});

describe('S11 모델 평가·승격(T119)', () => {
  const run = { id: '5', versionId: '11', itemTotal: 2, itemDone: 2, incompleteCount: 0, doneCount: 2, verdict: null, eligible: false, results: [] };
  it('연동 개발은 읽기 전용: 지금 불러오기·평가 조작이 없다', async () => {
    serve({ '/v1/admin/models': manifest, '/v1/ops/models': loads });
    const w = await open(ModelsView, ['integrator']);
    expect(w.text()).toContain(ko.ops.readOnly);
    expect(btn(w, ko.ops.warmup)).toBeUndefined();
    await w.find('button.linkish').trigger('click');
    expect(btn(w, ko.ops.evalRequest)).toBeUndefined();
    expect(calls('GET', '/v1/admin/eval-runs')).toHaveLength(0);
    w.unmount();
  });
  it('운영자는 모든 권한 — 읽기 전용 안내 없이 평가·승격 조작을 쓴다(2026-09-30 이제민)', async () => {
    serve({ '/v1/admin/models': manifest, '/v1/ops/models': loads });
    const w = await open(ModelsView, ['operator']);
    expect(w.text()).not.toContain(ko.ops.readOnly);
    w.unmount();
  });
  it('운영자는 미준비 모델을 지금 불러오기 할 수 있다', async () => {
    serve({ '/v1/admin/models': manifest, '/v1/ops/models': loads, 'POST /v1/ops/models/M1/warmup': () => json({ modelId: 'M1', licenseConfirmed: true, hint: 'model_loading' }, 202) });
    const w = await open(ModelsView, ['operator']);
    await btn(w, ko.ops.warmup)!.trigger('click');
    await flushPromises();
    expect(calls('POST', '/v1/ops/models/M1/warmup')).toHaveLength(1);
    w.unmount();
  });
  it('평가 담당: 새로 고친 뒤에도 latestEvalRunId로 진행을 보이고, 통과 판단 전 승격은 사유 달린 비활성 → 판단 기록 → 승격', async () => {
    let current = { ...run };
    serve({
      '/v1/admin/models': manifest, '/v1/ops/models': loads,
      '/v1/admin/eval-runs/5': () => json(current),
      'PATCH /v1/admin/eval-runs/5': (i?: RequestInit) => { current = { ...run, ...JSON.parse(String(i!.body)), eligible: true }; return json(current); },
      'POST /v1/admin/models/M1/promote': () => json(manifest[0]),
    });
    const w = await open(ModelsView, ['evaluator']);
    await w.find('button.linkish').trigger('click');
    expect(w.text()).toContain(ko.ops.evalProgress(2, 2, 0));
    expect(btn(w, ko.ops.promote)!.attributes('aria-disabled')).toBe('true');
    await btn(w, ko.ops.verdict.pass!)!.trigger('click');
    await w.find('textarea').setValue('오인 없음');
    await w.findAll('button').filter((b) => b.text().startsWith(ko.ops.judge)).at(-1)!.trigger('click');
    await flushPromises();
    expect(JSON.parse(String(calls('PATCH', '/v1/admin/eval-runs/5')[0]![1]!.body))).toEqual({ verdict: 'pass', rationale: '오인 없음' });
    expect(btn(w, ko.ops.promote)!.attributes('aria-disabled')).toBeUndefined();
    await btn(w, ko.ops.promote)!.trigger('click');
    await flushPromises();
    expect(JSON.parse(String(calls('POST', '/v1/admin/models/M1/promote')[0]![1]!.body))).toEqual({ versionId: '11', evalRunId: '5' });
    w.unmount();
  });
  it('롤백 후보가 없는 활성 버전: 롤백은 "되돌릴 후보가 없어요", 비활성화는 확인 창 뒤 사유와 함께', async () => {
    serve({ '/v1/admin/models': manifest, '/v1/ops/models': loads, 'POST /v1/admin/models/M5/deactivate': () => json(manifest[1]) });
    const w = await open(ModelsView, ['evaluator']);
    await w.findAll('button.linkish')[1]!.trigger('click');
    expect(btn(w, ko.ops.rollback)!.text()).toContain(ko.ops.noRollback);
    await w.find('input.input').setValue('지표 악화');
    await btn(w, ko.ops.deactivate)!.trigger('click');
    expect(w.text()).toContain(ko.ops.deactivateConfirm);
    expect(calls('POST', '/v1/admin/models/M5/deactivate')).toHaveLength(0);
    await w.find('[role="alertdialog"] .btn-primary').trigger('click');
    await flushPromises();
    expect(JSON.parse(String(calls('POST', '/v1/admin/models/M5/deactivate')[0]![1]!.body))).toEqual({ reason: '지표 악화' });
    w.unmount();
  });
});

describe('S12 API활용(T125)', () => {
  const guide = { groups: [
    { name: '보호자 앱', spec: { paths: { '/v1/artworks': { get: { summary: '작품 목록' } } } } },
    { name: '모델 기능', spec: { paths: { '/v1/models/pose': { post: { summary: 'pose' } }, '/v1/models/caption': { post: { summary: '(P0.5) 설명' } } } } },
  ], versionCheck: [{ modelId: 'M1', specVersion: 'v1', activeVersion: null, match: false }], fetchedAt: '2026-09-29T05:00:00Z', stale: true };
  it('엔드포인트 표·구간(pose는 팀 내부 키, caption은 P0.5 예정)·버전 불일치 경고·마지막 확인 명세', async () => {
    serve({ '/v1/admin/api-guide/spec': guide, '/v1/admin/eval-items': [] });
    const w = await open(ApiGuideView, ['integrator']);
    expect(w.text()).toContain('GET /v1/artworks');
    expect(w.text()).toContain(ko.apiGuide.internalKey);
    expect(w.text()).toContain(ko.apiGuide.p05);
    expect(w.find('.warn').text()).toContain('M1');
    expect(w.text()).toContain('2026-09-29 05:00:00');
    w.unmount();
  });
  it('시험 호출은 평가 묶음 사진 작품만 고를 수 있고(설명 입력 제외), 고르기 전엔 사유 달린 비활성', async () => {
    serve({ '/v1/admin/api-guide/spec': guide, '/v1/admin/eval-items': [{ id: '3', kind: 'person' }, { id: '4', kind: 'caption_input' }],
      'POST /v1/admin/api-guide/test-call': () => json({ jobId: '9', function: 'segment', status: 'done', outcome: 'ok', model: { id: 'M1', version: 'v1' }, durationMs: 900 }, 202),
      '/v1/admin/api-guide/test-call/9': { jobId: '9', function: 'segment', status: 'done', outcome: 'ok', model: { id: 'M1', version: 'v1' }, durationMs: 900 } });
    const w = await open(ApiGuideView, ['integrator']);
    const opts = w.findAll('option').map((o) => o.attributes('value'));
    expect(opts).toContain('3');
    expect(opts).not.toContain('4');
    expect(w.findAll('button').find((b) => b.text().startsWith(ko.apiGuide.call))!.text()).toContain(ko.apiGuide.pickItem);
    await w.findAll('select')[1]!.setValue('3');
    await w.findAll('button').find((b) => b.text().startsWith(ko.apiGuide.call))!.trigger('click');
    await flushPromises();
    expect(JSON.parse(String(calls('POST', '/v1/admin/api-guide/test-call')[0]![1]!.body))).toEqual({ function: 'segment', evalItemId: '3' });
    expect(w.text()).toContain('M1 v1');
    w.unmount();
  });
  it('가이드라인 탭은 원천 문서 본문, 굵게·코드 표기를 해석해 그린다(원문 기호 없음)', async () => {
    serve({ '/v1/admin/api-guide/spec': guide, '/v1/admin/eval-items': [] });
    const w = await open(ApiGuideView, ['operator']);
    await w.findAll('[role="tab"]')[1]!.trigger('click');
    expect(w.findAll('.guide li')).toHaveLength(GUIDELINE.length);
    expect(w.find('.guide').text()).not.toContain('**');
    expect(w.find('.guide b').exists()).toBe(true);
    w.unmount();
  });
});

describe('모델 점검(T157, D20)', () => {
  const now = new Date().toISOString();
  const checks = { checks: [
    { id: '1', modelId: 'M1', versionId: '11', versionLabel: 'v1', evalItemId: '3', status: 'passed', processingMs: 1500, requestedAt: now, finishedAt: now },
    { id: '2', modelId: 'M5', versionId: '51', versionLabel: 'v1', evalItemId: '3', status: 'running', requestedAt: now },
  ] };
  it('S11: 마지막 점검 칸(점수 없이 통과·처리 시간), 점검 중이면 [점검]은 사유 달린 비활성, 연동 개발에는 버튼 없음', async () => {
    serve({ '/v1/admin/models': manifest, '/v1/ops/models': loads, '/v1/ops/model-checks': checks });
    const w = await open(ModelsView, ['operator']);
    expect(w.find('[data-check="passed"]').text()).toBe(ko.ops.checkPassed('1.5', ko.ops.ago(0)));
    expect(w.find('[data-check="running"]').text()).toBe(ko.ops.checkRunning);
    const checkBtns = w.findAll('button').filter((b) => b.text().startsWith(ko.ops.check));
    expect(checkBtns.some((b) => b.attributes('aria-disabled') === 'true' && b.text().includes(ko.ops.checking))).toBe(true);
    expect(w.text()).toContain(ko.ops.checkNotPromotion);
    w.unmount();
    const r = await open(ModelsView, ['integrator']);
    expect(r.findAll('button').filter((b) => b.text().startsWith(ko.ops.check))).toHaveLength(0);
    r.unmount();
  });
  it('S11: [점검] → POST, 실행기 배포 전이면 C2 "점검을 아직 쓸 수 없어요"', async () => {
    serve({ '/v1/admin/models': manifest, '/v1/ops/models': loads, '/v1/ops/model-checks': { checks: [] },
      'POST /v1/ops/models/M1/check': () => new Response(JSON.stringify({ type: 'about:blank', title: 't', status: 503, code: 'not_saved', reason: 'check_runner_missing' }), { status: 503, headers: { 'content-type': 'application/problem+json' } }) });
    const w = await open(ModelsView, ['evaluator']);
    await w.findAll('button').find((b) => b.text().startsWith(ko.ops.check))!.trigger('click');
    await flushPromises();
    expect(calls('POST', '/v1/ops/models/M1/check')).toHaveLength(1);
    expect(w.find('.gblock').text()).toContain('점검을 아직 쓸 수 없어요');
    w.unmount();
  });
  it('S10: 준비 표에 마지막 점검(읽기만)', async () => {
    serve({ '/ready': { status: 'ready' }, '/v1/ops/models': loads, '/v1/admin/metrics': metrics, '/v1/admin/models': manifest, '/v1/ops/model-checks': checks });
    const w = await open(OpsStatusView, ['integrator']);
    expect(w.text()).toContain(ko.ops.checkPassed('1.5', ko.ops.ago(0)));
    expect(w.findAll('button').filter((b) => b.text().startsWith(ko.ops.check))).toHaveLength(0);
    w.unmount();
  });
});
