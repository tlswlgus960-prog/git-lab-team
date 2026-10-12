// D42 소리는 누를 때만(SD_02 §17-15): [들려주기] 읽기·멈춤·한 카드만·미지원 안내 · [음악] 재생·정지·실패 안내 · 곡 목록 권리 규칙.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import SpeakButton from '../app/sound/SpeakButton.vue';
import MusicButton from '../app/sound/MusicButton.vue';
import StoryCard from '../components/StoryCard.vue';
import { sc } from '../app/sound/copy';
import * as bgm from '../app/sound/bgm';

class FakeUtter { text: string; lang = ''; rate = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
function fakeSynth(voices = [{ lang: 'ko-KR', name: 'Yuna' }]) {
  const s = { spoken: [] as FakeUtter[], speak: vi.fn((u: FakeUtter) => { s.spoken.push(u); }), cancel: vi.fn(), getVoices: () => voices };
  vi.stubGlobal('speechSynthesis', s);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtter);
  return s;
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('[들려주기](SpeakButton)', () => {
  it('누르면 한국어로 읽고 버튼이 "그만 듣기", 다시 누르면 멈춤, 다 읽으면 원래대로', async () => {
    const s = fakeSynth();
    const w = mount(SpeakButton, { props: { parts: ['해님.', ' 하늘이가 그렸어요. ', ''], title: '해님' } });
    await w.find('button').trigger('click');
    expect(s.spoken[0]).toMatchObject({ text: '해님. 하늘이가 그렸어요.', lang: 'ko-KR', rate: 0.95 });
    expect(w.find('button').attributes('aria-pressed')).toBe('true');
    expect(w.text()).toContain(sc.speakStop);
    await w.find('button').trigger('click');
    expect(s.cancel).toHaveBeenCalled();
    expect(w.find('button').attributes('aria-pressed')).toBe('false');
    await w.find('button').trigger('click');
    s.spoken[1]!.onend!();
    await flushPromises();
    expect(w.text()).toContain(sc.speak);
  });
  it('한 번에 한 카드만 — 다른 카드를 누르면 앞 카드는 꺼진다, 사라지면 멈춤', async () => {
    const s = fakeSynth();
    const a = mount(SpeakButton, { props: { parts: ['가'], title: '가' } });
    const b = mount(SpeakButton, { props: { parts: ['나'], title: '나' } });
    await a.find('button').trigger('click');
    await b.find('button').trigger('click');
    expect(a.find('button').attributes('aria-pressed')).toBe('false');
    expect(b.find('button').attributes('aria-pressed')).toBe('true');
    const before = s.cancel.mock.calls.length;
    b.unmount();
    expect(s.cancel.mock.calls.length).toBe(before + 1);
  });
  it('한국어 목소리가 없거나 기능이 없으면 버튼 대신 안내', async () => {
    fakeSynth([{ lang: 'en-US', name: 'Alex' }]);
    const w = mount(SpeakButton, { props: { parts: ['가'], title: '가' } });
    await flushPromises();
    expect(w.find('button').exists()).toBe(false);
    expect(w.text()).toBe(sc.speakNone);
  });
  it('이야기 카드는 보이는 문장을 제목 → 해설 → AI 해설 순으로 읽는다', async () => {
    const s = fakeSynth();
    const item = { id: '1', kind: 'frame', title: '우리 집', titleAuto: false, madeOn: '2026-09-01', ageAtMaking: 5, childWords: '엄마랑', guardianNote: null,
      aiCaption: { body: '따뜻한 색이 가득해요.', aiAuthored: true }, primaryUrl: null, auxUrl: null, posterUrl: null, originalUrl: null, backsideEstimated: false };
    const w = mount(StoryCard, { props: { item: item as never, alias: '하늘' }, global: { stubs: { RouterLink: true } } });
    await w.find('button.speak').trigger('click');
    const t = s.spoken[0]!.text;
    expect(t.startsWith('우리 집.')).toBe(true);
    expect(t).toContain('엄마랑');
    expect(t.indexOf(sc.aiPrefix)).toBeGreaterThan(t.indexOf('엄마랑'));
    expect(t.endsWith('따뜻한 색이 가득해요.')).toBe(true);
  });
});

describe('[음악](MusicButton)', () => {
  class FakeAudio { src = ''; loop = false; preload = ''; volume = 1; paused = true; static last: FakeAudio;
    constructor() { FakeAudio.last = this; } canPlayType(t: string) { return t === 'audio/ogg' ? 'maybe' : ''; }
    play = vi.fn(async () => { this.paused = false; }); pause = vi.fn(() => { this.paused = true; }); }
  const manifest = { tracks: [{ id: 'g1-v1', title: '짐노페디 1번', performer: '연주자', source: 'https://commons.wikimedia.org/wiki/File:x.ogg', license: 'CC BY-SA 4.0', files: { mp3: 'g1-v1.mp3', ogg: 'g1-v1.ogg' } }] };
  beforeEach(() => {
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('matchMedia', () => ({ matches: true })); // 움직임 줄이기 — 커지기·작아지기 없이 바로
    window.matchMedia = (() => ({ matches: true })) as never;
  });
  afterEach(() => { bgm.stop(); bgm.track.value = null; });

  it('누르면 반복 재생(작은 음량), 한 번 더 누르면 정지 — 들어올 때 저절로 틀지 않는다', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const w = mount(MusicButton);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.find('button').attributes('aria-pressed')).toBe('false');
    await w.find('button').trigger('click'); await flushPromises();
    const a = FakeAudio.last;
    expect(a.src).toBe('/audio/bgm/g1-v1.ogg');
    expect(a.loop).toBe(true);
    expect(a.play).toHaveBeenCalled();
    expect(a.volume).toBeCloseTo(0.35);
    expect(w.find('button').attributes('aria-pressed')).toBe('true');
    expect(w.text()).toContain(sc.musicStop);
    await w.find('button').trigger('click'); await flushPromises();
    expect(a.pause).toHaveBeenCalled();
    expect(w.find('button').attributes('aria-pressed')).toBe('false');
  });
  it('곡을 못 받으면 원래대로 + 안내', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const w = mount(MusicButton);
    await w.find('button').trigger('click'); await flushPromises();
    expect(w.find('button').attributes('aria-pressed')).toBe('false');
    expect(w.find('[role="status"]').text()).toBe(sc.musicFail);
  });
});

describe('곡 목록(public/audio/bgm/manifest.json)', () => {
  const DIR = path.resolve(__dirname, '../../public/audio/bgm');
  it('곡마다 출처 https · 허용 라이선스 · 파일 있음 · 3MB 이하 · 목록 밖 파일 없음', () => {
    expect(fs.existsSync(path.join(DIR, 'manifest.json'))).toBe(true);
    const m = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as { tracks: { source: string; license: string; performer: string; files: Record<string, string> }[] };
    expect(m.tracks.length).toBeGreaterThan(0);
    const listed = new Set(['manifest.json']);
    for (const t of m.tracks) {
      expect(t.source).toMatch(/^https:\/\//);
      expect(t.license).toMatch(/^(PD|CC0|CC BY( \d\.\d)?|CC BY-SA( \d\.\d)?)$/);
      expect(t.performer).toBeTruthy();
      for (const f of Object.values(t.files)) {
        listed.add(f);
        expect(fs.statSync(path.join(DIR, f)).size).toBeLessThanOrEqual(3 * 1024 * 1024);
      }
    }
    for (const f of fs.readdirSync(DIR)) expect(listed.has(f)).toBe(true);
  });
  it('말 파일에 금지어가 없다', () => {
    const all = JSON.stringify(sc) + sc.speakLabel('가') + sc.credit('가', '나', 'CC0');
    for (const bad of ['점수', '확률', '%', '실패했', '!']) expect(all).not.toContain(bad);
  });
});
