// 배경 음악(D42 B, SD_02 §17-15): 앱에 하나뿐인 재생기. 누를 때만 틀고(자동 재생 없음, UX4), 한 번 더 누르면 멈춘다.
// 곡은 public/audio/bgm/manifest.json의 첫 곡(녹음까지 PD · CC0 · CC BY · CC BY-SA). 음량 0.35, 커지기 1.5초 · 작아지기 0.6초(움직임 줄이기면 바로).
import { ref } from 'vue';

export interface Track { id: string; title: string; composer?: string; performer: string; source: string; license: string; files: { mp3?: string; ogg?: string } }

const BASE = '/audio/bgm/';
const VOLUME = 0.35;
export const playing = ref(false);
export const failed = ref(false);
export const track = ref<Track | null>(null);

let audio: HTMLAudioElement | null = null;
let fade: ReturnType<typeof setInterval> | null = null;
const reduce = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

async function loadTrack(): Promise<Track | null> {
  if (track.value) return track.value;
  const r = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
  if (!r.ok) return null;
  const m = (await r.json()) as { tracks?: Track[] };
  track.value = m.tracks?.[0] ?? null;
  return track.value;
}

function ramp(to: number, ms: number, then?: () => void) {
  if (fade) clearInterval(fade);
  const a = audio;
  if (!a) return;
  if (reduce() || ms <= 0) { a.volume = to; then?.(); return; }
  const from = a.volume; const t0 = Date.now();
  fade = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms);
    a.volume = from + (to - from) * k;
    if (k >= 1) { clearInterval(fade!); fade = null; then?.(); }
  }, 50);
}

export async function play() {
  failed.value = false;
  try {
    const t = await loadTrack();
    if (!t) throw new Error('no_track');
    if (!audio) {
      audio = new Audio();
      const canOgg = audio.canPlayType('audio/ogg') !== '';
      const file = (canOgg && t.files.ogg) || t.files.mp3 || t.files.ogg;
      if (!file) throw new Error('no_file');
      audio.src = BASE + file;
      audio.loop = true;
      audio.preload = 'auto';
    }
    audio.volume = reduce() ? VOLUME : 0;
    playing.value = true;
    await audio.play();
    ramp(VOLUME, 1500);
  } catch {
    playing.value = false;
    failed.value = true;
    setTimeout(() => { failed.value = false; }, 3000);
  }
}

export function stop() {
  playing.value = false;
  const a = audio;
  if (!a) return;
  ramp(0, 600, () => { if (!playing.value) a.pause(); });
}

export const toggle = () => (playing.value ? stop() : play());
