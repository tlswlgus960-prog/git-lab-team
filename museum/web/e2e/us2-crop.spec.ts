// T167 [US2] S2 작품 영역 자르기 E2E(D32, C11, UC2 A10, 390·1440px):
// 처음엔 사진 전체 → 키보드로 줄이면 크기 표시 → [사진 전체로] 되돌리기 → 다시 줄여 올리면 서버 원본이 자른 크기.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { drawingPng, guardianWithChild } from './stack/guardian';

const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

test('작품 영역을 잘라 올리면 서버 원본은 자른 이미지', async ({ page }, info) => {
  await guardianWithChild(page, `crop-${info.project.name}`);
  await page.goto('/app/upload');
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: drawingPng(800, 600) });

  const area = page.getByRole('group', { name: ko.upload.crop.title });
  await expect(area).toBeVisible();
  await expect(area).toContainText(ko.upload.crop.whole);
  await expect(area.getByRole('button')).toHaveCount(9); // 핸들 8 + 네모 옮기기

  // 키보드: 왼쪽 위 모서리 Shift+→ 2번(10% × 2 = 120px), Shift+↓ 1번(60px)
  const nw = area.getByRole('button', { name: ko.upload.crop.handle.nw });
  await nw.focus();
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  await expect(area).toContainText(ko.upload.crop.cropped(680, 540));
  // 접근성(axe WCAG 2.1 AA) — 자르기 화면이 열린 상태
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  // [사진 전체로] 되돌리기
  await area.getByRole('button', { name: ko.upload.crop.reset }).click();
  await expect(area).toContainText(ko.upload.crop.whole);

  // 오른쪽 아래 모서리를 끌어 줄이기(마우스·터치 공통 포인터)
  const se = area.getByRole('button', { name: ko.upload.crop.handle.se });
  const box = (await area.locator('.crop-img').boundingBox())!;
  const h = (await se.boundingBox())!;
  const sx = h.x + h.width / 2 - 6, sy = h.y + h.height / 2 - 6; // 모서리 바로 안쪽(바깥 절반은 잘려 보이지 않음)
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx - box.width / 2, sy - box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(area).toContainText(/잘라서 올려요 \d/);
  const txt = (await area.locator('[aria-live]').textContent())!;
  const [cw, ch] = txt.match(/[\d,]+/g)!.map((s) => Number(s.replace(/,/g, '')));
  expect(cw).toBeGreaterThan(300); expect(cw).toBeLessThan(500);
  expect(ch).toBeGreaterThan(200); expect(ch).toBeLessThan(400);

  // 올리기 → 서버 원본이 자른 크기인지
  await page.getByRole('button', { name: ko.upload.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/artworks\/[^/?]+/); // 접수 뒤 작품 화면(D34 이후 확정 화면이 아닐 수 있음)
  const id = page.url().match(/artworks\/([^/?#]+)/)![1];
  const detail = await (await page.request.get(`/v1/artworks/${id}`)).json();
  const orig = await page.request.get(detail.originalUrl);
  expect(orig.ok()).toBe(true);
  expect(pngSize(Buffer.from(await orig.body()))).toEqual([cw, ch]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('사각형을 건드리지 않으면 고른 파일 그대로', async ({ page }, info) => {
  await guardianWithChild(page, `crop0-${info.project.name}`);
  await page.goto('/app/upload');
  const png = drawingPng(640, 480);
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('group', { name: ko.upload.crop.title })).toContainText(ko.upload.crop.whole);
  await page.getByRole('button', { name: ko.upload.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/artworks\/[^/?]+/); // 접수 뒤 작품 화면(D34 이후 확정 화면이 아닐 수 있음)
  const id = page.url().match(/artworks\/([^/?#]+)/)![1];
  const detail = await (await page.request.get(`/v1/artworks/${id}`)).json();
  const orig = Buffer.from(await (await page.request.get(detail.originalUrl)).body());
  expect(orig.equals(png)).toBe(true); // 같은 바이트(다시 인코딩하지 않음)
});
