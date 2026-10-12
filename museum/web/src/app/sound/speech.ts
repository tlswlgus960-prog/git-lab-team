// 작품 해설 읽어 주기(D42 A, SD_02 §17-15): 브라우저 내장 speechSynthesis · ko-KR · 빠르기 0.95. 서버 · 모델 호출 없음.
// 앱 전체에서 한 번에 한 카드만 읽는다 — 누가 읽는 중인지(owner)를 하나만 둔다.
import { ref } from 'vue';

export const speakingOwner = ref<symbol | null>(null);

type Synth = Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>;
const synth = (): Synth | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

/** 한국어 목소리(없으면 null) — 목소리 목록이 늦게 오는 브라우저도 있어 lang만 맞춰도 읽는다 */
function koVoice(s: Synth): SpeechSynthesisVoice | null {
  return s.getVoices().find((v) => /^ko(-|_|$)/i.test(v.lang)) ?? null;
}

/** 읽어 주기를 쓸 수 있는가 — speechSynthesis가 있고, 목소리 목록이 비었거나(아직 안 옴) 한국어 목소리가 있다 */
export function canSpeak(): boolean {
  const s = synth();
  if (!s || typeof SpeechSynthesisUtterance === 'undefined') return false;
  const voices = s.getVoices();
  return voices.length === 0 || !!koVoice(s);
}

export function stopSpeaking(owner?: symbol) {
  const s = synth();
  if (owner && speakingOwner.value !== owner) return;
  s?.cancel();
  speakingOwner.value = null;
}

/** 문장들을 차례로 읽는다. 다른 카드가 읽고 있으면 먼저 멈춘다 */
export function speak(owner: symbol, parts: string[]) {
  const s = synth();
  const text = parts.map((p) => p.trim()).filter(Boolean).join(' ');
  if (!s || !text) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 0.95;
  const v = koVoice(s);
  if (v) u.voice = v;
  const done = () => { if (speakingOwner.value === owner) speakingOwner.value = null; };
  u.onend = done;
  u.onerror = done;
  speakingOwner.value = owner;
  s.speak(u);
}
