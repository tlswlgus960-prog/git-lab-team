// T059 [US2] 올리기 E2E(390·1440px) — D34 · D46 개정: 올리면 확정 화면 없이 원본 액자로 곧바로 걸리고(기본 선택 없음),
// 움직임 · 입체는 걸린 뒤 권유로만(D49 질문은 d46-upload-hang). 확정하지 않은 작품은 원본 액자로 걸린 채 남는다.
import { expect, test } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { drawingPng, guardianWithChild } from './stack/guardian';

test('올리면 확정 화면 없이 원본 액자로 걸리고, 아무것도 확정되지 않는다', async ({ page }, info) => {
  await guardianWithChild(page, `us2-${info.project.name}`);
  await page.goto('/app/upload');
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: drawingPng() });
  const res = page.waitForResponse((r) => r.url().endsWith('/v1/artworks') && r.request().method() === 'POST');
  await page.getByRole('button', { name: ko.upload.submit, exact: true }).click();
  const id = String(((await (await res).json()) as { id: string | number }).id);
  await expect(page).toHaveURL(/\/app\/museum\/\d+/);
  expect(page.url()).not.toContain('/confirm');
  const d = await (await page.request.get(`/v1/artworks/${id}`)).json() as { confirmedKind: string | null; exhibited: boolean; hungResultKind: string | null };
  expect(d.confirmedKind).toBeNull();
  expect(d.exhibited).toBe(true);
  expect(d.hungResultKind).toBe('frame');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
