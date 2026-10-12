// T087 [US4] 올리기(설명 함께) → 전시 E2E(390·1440px, D34 · D46 개정): 자동 재생 없음 · 원본 보기 · 점수·토스트 없음.
// 액자 경로를 실제 CPU 워커(frame_compose)로 끝까지 돌린다. 활성 모델이 없어 움직임·2.5D 결과(재생·원본 나란히 토글)는
// 이 스택에서 만들 수 없다 — 모델이 켜진 뒤 같은 파일에 덧붙인다(액자는 결과가 원본이라 원본 토글이 없어야 맞다).
import { expect, test, type Page } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { roomLabel } from '../src/app/museumTheme';
import { drawingPng, guardianWithChild } from './stack/guardian';

async function noScoreNoToast(page: Page) {
  const text = await page.locator('main').innerText();
  for (const bad of ['점수', '확률', '%']) expect(text).not.toContain(bad);
  await expect(page.locator('[class*="toast"], [role="status"][class*="snack"]')).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.autoplay || !v.paused).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('설명을 적어 올리면 곧바로 걸리고 → 전시실 6세관에서 열린다(D34 · D46)', async ({ page }, info) => {
  await guardianWithChild(page, `us4-${info.project.name}`);
  await page.goto('/app/upload');
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: drawingPng() });
  await page.getByLabel(ko.up2.title).fill('빨간 해');
  await page.getByLabel(ko.up2.madeOn).fill('2026-09-01');
  await page.getByLabel(ko.up2.age).fill('6');
  const res = page.waitForResponse((r) => r.url().endsWith('/v1/artworks') && r.request().method() === 'POST');
  await page.getByRole('button', { name: ko.upload.submit, exact: true }).click();
  const r = await res;
  expect(r.status(), await r.text()).toBeLessThan(300);
  await expect(page).toHaveURL(/\/app\/museum\/\d+/);
  await noScoreNoToast(page);

  // 전시 = 홈 전시실(D25): N세관 안에 걸리고, 열면 월 라벨과 정지 화면(액자는 원본·재생 토글 없음)
  await page.goto('/app/hall');
  await expect(page).toHaveURL(/\/app\/hall(\?|$)/);
  const room = page.getByRole('region', { name: roomLabel(1, 6) });
  await expect(room.getByText('빨간 해')).toBeVisible();
  await room.getByRole('button', { name: '빨간 해' }).click();
  await expect(page.getByRole('button', { name: ko.museum.back })).toBeVisible();
  await expect(page.locator('.wl-kind')).toHaveText(ko.museum.kind.frame!);
  await expect(page.locator('main button[aria-pressed]:not([aria-label*="들려주기"])')).toHaveCount(0); // 원본 · 재생 토글 없음([들려주기](D42)는 소리 토글)
  // 전시 해설(D25 ⑥): 작가 줄 "{별칭} ({나이}세 작, {해})" · 규칙 문장 해설 — 뒤로가기는 브라우저 뒤로 · Esc · [← 전시실로]
  await expect(page.locator('.wl-artist')).toHaveText(ko.museum.artist('별이', 6, '2026'));
  await expect(page.locator('.wl-desc')).toContainText('「빨간 해」는 별이가 6살이던 2026년 9월에 그린 작품입니다.');
  await expect(page).toHaveURL(/[?&]art=/);
  await noScoreNoToast(page);
  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]art=/);
  await expect(room.getByRole('button', { name: '빨간 해' })).toBeFocused();
  await room.getByRole('button', { name: '빨간 해' }).click();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]art=/);
  await expect(page.getByRole('heading', { name: roomLabel(1, 6) })).toBeVisible();
});
