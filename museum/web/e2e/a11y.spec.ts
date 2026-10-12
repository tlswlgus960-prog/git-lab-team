// T138 접근성·반응형 점검(SD_02 §17, 390·1440px): axe WCAG 2.1 AA(대비 4.5:1 포함) · 가로 스크롤 없음 ·
// 키보드만으로 확정 · 비활성 버튼 사유가 접근 가능한 설명으로 읽힘 · 점수·미리 선택·토스트 0.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { drawingPng, guardianWithChild } from './stack/guardian';
import { STAFF } from './stack/ports';

async function check(page: Page, where: string) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (process.env.A11Y_DEBUG) console.log(where, 'axe passes', r.passes.length, 'violations', r.violations.length, 'incomplete', r.incomplete.map((i) => i.id + ':' + i.nodes.map((n) => n.target.join(' ') + '[' + (n.any[0]?.data?.messageKey ?? '') + ']').join(' ; ')).join(','));
  const found = r.violations.map((v) => `${where} ${v.id}(${v.impact}) ×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect.soft(found, `axe ${where}`).toEqual([]);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `가로 스크롤 ${where}`).toBe(true);
  const text = await page.locator('body').innerText();
  for (const bad of ['점수', '확률']) expect.soft(text, `${bad} ${where}`).not.toContain(bad);
  await expect.soft(page.locator('[aria-pressed="true"], input[type=radio]:checked'), `미리 선택 ${where}`).toHaveCount(0);
  await expect.soft(page.locator('[class*="toast"]'), `토스트 ${where}`).toHaveCount(0);
}

test('공개 화면', async ({ page }) => {
  for (const p of ['/app/login', '/app/signup', '/app/recovery']) { await page.goto(p); await check(page, p); }
});

test('보호자 화면 한 바퀴 — 키보드로 확정, 비활성 사유 낭독', async ({ page }, info) => {
  await guardianWithChild(page, `a11y-${info.project.name}`);
  await check(page, 'S1 아이');
  await page.goto('/app/upload');
  await check(page, 'S2 올리기');
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: drawingPng() });
  await page.getByRole('button', { name: ko.upload.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/confirm$/);
  await check(page, 'S3 확정');

  // 비활성 선택지 사유가 접근 가능한 설명(aria-describedby)으로 붙는다
  const off = page.getByRole('group', { name: ko.confirm.howTitle }).getByRole('button').first();
  await expect(off).toHaveAccessibleDescription(new RegExp(ko.review.unavailable.model_disabled!));
  // 키보드만: 원본 액자에 초점 → Space → 확정하기 → Enter
  const frame = page.getByRole('button', { name: ko.kind.frame, exact: true });
  await frame.focus();
  await page.keyboard.press('Space');
  await expect(frame).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: ko.confirm.submit, exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/started=1$/);
  await expect(page.getByRole('link', { name: ko.list.toReview })).toBeVisible({ timeout: 30_000 });
  await check(page, 'S4 진행');
  await page.getByRole('link', { name: ko.list.toReview }).click();
  await check(page, 'S5 결과 확인');
  await page.getByRole('button', { name: ko.review.decision.like, exact: true }).click();
  await expect(page).toHaveURL(/\/story/);
  await check(page, 'S6 이야기');
  await page.getByLabel(ko.story.title).fill('파란 집');
  await page.getByLabel(ko.story.madeOn).fill('2026-09-02');
  await page.getByLabel(ko.story.age).fill('5');
  await page.getByRole('button', { name: ko.story.save, exact: true }).click();
  await expect(page.getByText(ko.story.exhibited)).toBeVisible();
  await page.goto('/app');
  await check(page, '홈 전시실(D25)');
  await page.getByRole('button', { name: '파란 집', exact: true }).click();
  await check(page, '작품 앞 월 라벨');
  await page.goto('/app/works');
  await check(page, 'S4 작품 관리');
  await page.goto('/app/family');
  await check(page, 'S1b 가족 보호자');
});

// 움직임 줄이기(SD_02 §17 · 1550행): 설정이 켜지면 전환 효과를 끄고, 재생·시차·회전 토글이 켜져도 정지 화면 + 원본을 먼저.
// 구현: web/src/styles/motion.css(전역) · SideBySide·MuseumView 재생 토글 숨김(2026-09-29 이제민1).
test('움직임 줄이기 설정이면 버튼 전환 효과가 없다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app/login');
  // 로그인 화면의 첫 버튼은 [카카오로 시작하기](D36) — 비활성이면 이름 뒤에 사유가 붙는다(C3)
  const d = await page.getByRole('button', { name: new RegExp(`^${ko.kakao.start}`) }).evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(d.split(',').every((x) => parseFloat(x) === 0)).toBe(true);
});

test('운영 화면 — 로그인·상태·모델·API활용(model-api 없음 = 확인 불가 상태)', async ({ page }) => {
  await page.goto('/ops/login');
  await check(page, '/ops/login');
  await page.getByLabel(ko.auth.email, { exact: true }).fill(STAFF.email);
  await page.getByLabel(ko.auth.password, { exact: true }).fill(STAFF.password);
  await page.getByRole('button', { name: ko.auth.login, exact: true }).click();
  await expect(page).toHaveURL(/\/ops\/status/);
  for (const p of ['/ops/status', '/ops/models', '/ops/api-guide']) { await page.goto(p); await check(page, p); }
});
