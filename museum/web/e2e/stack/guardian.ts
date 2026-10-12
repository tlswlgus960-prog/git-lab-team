// 흐름 E2E 공통 준비: 가입 → 메일 확인(로그인 상태) → 아이 한 명. 화면 가입 흐름 자체는 us1이 본다.
import { expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { linkFor, testEmail } from './mail';

export const PW = 'e2e-Pass-2026';

export async function guardianWithChild(page: Page, tag: string, alias = '별이') {
  const email = testEmail(tag);
  const r = await page.request.post('/v1/auth/signup', { data: { email, password: PW, passwordConfirm: PW } });
  expect(r.status(), await r.text()).toBeLessThan(300);
  const link = new URL(await linkFor(email, '/app/verify'));
  await page.goto(link.pathname + link.search);
  await expect(page).toHaveURL(/\/app\/children/);
  const c = await page.request.post('/v1/children', { data: { alias } });
  expect(c.status(), await c.text()).toBeLessThan(300);
  return { email, child: await c.json() as { id: string; alias: string } };
}

/** 시험용 그림(실제 아이 그림·사진 금지): 흰 바탕에 색 원 하나를 그린 PNG */
export function drawingPng(w = 320, h = 240): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      if ((x - w / 2) ** 2 + (y - h / 2) ** 2 < (h / 3) ** 2) raw.set([230, 90, 60], y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const crc = (b: Buffer) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const tb = Buffer.from(t); const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(Buffer.concat([tb, d]))); return Buffer.concat([len, tb, d, cb]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
