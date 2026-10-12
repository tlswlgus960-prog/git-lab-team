// E2E 스택 Mailpit(별도 인스턴스) 수신함에서 받는 사람 주소로 마지막 메일의 링크를 꺼낸다.
import { MAIL_PORT } from './ports';

const BASE = `http://127.0.0.1:${MAIL_PORT}/api/v1`;

export async function linkFor(to: string, path: string, tries = 40): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const s = await (await fetch(`${BASE}/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json() as { messages: { ID: string }[] };
    if (s.messages.length) {
      const m = await (await fetch(`${BASE}/message/${s.messages[0]!.ID}`)).json() as { Text: string; HTML: string };
      const hit = `${m.Text}\n${m.HTML}`.match(new RegExp(`https?://[^\\s"'<>]*${path.replace(/\//g, '\\/')}\\?token=[^\\s"'<>&]+`));
      if (hit) return hit[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`메일 없음: ${to} ${path}`);
}

/** 프로젝트·시각마다 다른 시험 주소(실제 주소 금지 — .test 도메인) */
export const testEmail = (tag: string) => `guardian-${tag}-${Date.now()}@e2e.test`;
