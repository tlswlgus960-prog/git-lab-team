// T044 [US1] 가입 → 메일 확인 → 로그인 → 아이 등록 E2E(390·1440px). 스택은 e2e/stack(임시 DB·별도 app-api·별도 Mailpit).
import { expect, test } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { linkFor, testEmail } from './stack/mail';

const PW = 'e2e-Pass-2026';

test('가입 → 메일 확인 → 아이 등록 → 로그아웃 → 로그인하면 아이가 남아 있다', async ({ page }, info) => {
  const email = testEmail(info.project.name);

  await page.goto('/app/signup');
  await page.getByLabel(ko.auth.email, { exact: true }).fill(email);
  await page.getByLabel(ko.auth.password, { exact: true }).fill(PW);
  await page.getByLabel(ko.auth.passwordConfirm, { exact: true }).fill(PW);
  await page.getByRole('button', { name: ko.auth.signup, exact: true }).click();
  await expect(page.getByText(ko.auth.checkMailbox)).toBeVisible();

  const link = new URL(await linkFor(email, '/app/verify'));
  await page.goto(link.pathname + link.search);
  await expect(page).toHaveURL(/\/app\/children\?verified=1/);

  // 아이 등록 전: 작품 올리기는 이유 달린 비활성(C3)
  await expect(page.getByRole('button', { name: new RegExp(`^${ko.child.toUpload}`) })).toHaveAttribute('aria-disabled', 'true');
  await page.getByLabel(ko.child.alias, { exact: true }).fill('별이');
  await page.getByRole('button', { name: ko.child.save, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ko.child.count(1));
  await expect(page.getByRole('link', { name: ko.child.toUpload })).toBeVisible();

  await page.getByRole('button', { name: ko.auth.logout }).click();
  await expect(page).toHaveURL(/\/app\/login/);
  await page.getByRole('button', { name: ko.kakao.emailLogin }).click(); // 이메일 칸은 접혀 있다(D36)
  await page.getByLabel(ko.auth.email, { exact: true }).fill(email);
  await page.getByLabel(ko.auth.password, { exact: true }).fill(PW);
  await page.getByRole('button', { name: ko.auth.login, exact: true }).click();
  await expect(page).not.toHaveURL(/\/app\/login/);
  await page.getByRole('navigation').getByRole('link', { name: ko.child.title }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ko.child.count(1));
  await expect(page.getByText('별이')).toBeVisible();
  // 가로 스크롤 없음(390px 포함)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
