// S9 삭제 확인·진행 회귀 E2E(390·1440px): 작품 삭제(전시된 작품) · 아이 삭제. sweeper가 실제로 지우는 데까지(10초 주기).
import { expect, test, type Page } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { drawingPng, guardianWithChild } from './stack/guardian';

/** D34: 올리면 원본 액자로 곧바로 걸린다 — 올린 작품 id를 돌려주고 작품 상세로 간다 */
async function framedArtwork(page: Page): Promise<string> {
  await page.goto('/app/upload');
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: drawingPng() });
  const res = page.waitForResponse((r) => r.url().endsWith('/v1/artworks') && r.request().method() === 'POST');
  await page.getByRole('button', { name: ko.upload.submit, exact: true }).click();
  const id = String(((await (await res).json()) as { id: string | number }).id);
  await expect(page).toHaveURL(/\/app\/museum\//);
  await page.goto(`/app/artworks/${id}`);
  return id;
}

test('작품 삭제: 한 줄로 지워지는 것을 알리고, 확인 뒤에만 지우며 끝나면 작품 관리에 "지웠어요"(외부 피드백 4차)', async ({ page }, info) => {
  test.setTimeout(90_000);
  await guardianWithChild(page, `del-${info.project.name}`);
  const id = await framedArtwork(page);

  await page.getByRole('button', { name: ko.del.artwork, exact: true }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText(ko.del.artworkTitle);
  for (const t of ko.del.artworkItems) await expect(dlg).toContainText(t);
  await expect(dlg).toContainText(ko.del.keeps);
  // 취소하면 아무것도 지워지지 않는다
  await dlg.getByRole('button', { name: ko.del.cancel, exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await page.request.get(`/v1/artworks/${id}`)).status()).toBe(200);

  await page.getByRole('button', { name: ko.del.artwork, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ko.del.confirm, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/works\?deleted=1$/, { timeout: 45_000 }); // 끝나면 저절로 작품 관리로(D25)
  await expect(page.getByText(ko.del.deleted, { exact: true })).toBeVisible();
  expect((await page.request.get(`/v1/artworks/${id}`)).status()).toBe(404);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('아이 삭제: 별칭과 작품 수(조사 맞춤)를 보이고 끝나면 목록에서 사라진다', async ({ page }, info) => {
  test.setTimeout(90_000);
  await guardianWithChild(page, `delc-${info.project.name}`, '하늘');
  await framedArtwork(page);

  await page.goto('/app/children');
  await page.getByRole('row').filter({ hasText: '하늘' }).getByRole('button', { name: ko.child.remove, exact: true }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText(ko.del.childItems('하늘', 1));
  await expect(dlg).toContainText('하늘과 작품 1개가');
  await dlg.getByRole('button', { name: ko.del.confirm, exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(ko.del.progress.done!, { timeout: 45_000 });
  await page.getByRole('alertdialog').getByRole('button', { name: ko.del.toList, exact: true }).click();
  await page.reload();
  await expect(page.getByText(ko.child.empty ?? '아직 등록한 아이가 없어요')).toBeVisible();
});
