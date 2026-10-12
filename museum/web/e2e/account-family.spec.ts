// 보호자 계정·가족 흐름 회귀 E2E(390·1440px): S0b 로그인 정보 찾기·재설정, S1b 초대 → S1c 초대 가입·합류 → 공유 → 나가기.
// 스택은 e2e/stack(임시 DB·별도 app-api·별도 Mailpit). 주소는 모두 .test 도메인.
import { expect, test, type Page } from '@playwright/test';
import { ko, problemCopy } from '../src/copy/ko';
import { guardianWithChild, PW } from './stack/guardian';
import { linkFor, testEmail } from './stack/mail';

const NEW_PW = 'e2e-Reset-2026';
const pathOf = (link: string) => { const u = new URL(link); return u.pathname + u.search; };

async function login(page: Page, email: string, password: string) {
  await page.goto('/app/login');
  await page.getByRole('button', { name: ko.kakao.emailLogin }).click(); // 이메일 칸은 접혀 있다(D36)
  await page.getByLabel(ko.auth.email, { exact: true }).fill(email);
  await page.getByLabel(ko.auth.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: ko.auth.login, exact: true }).click();
}

test('S0b 로그인 정보 찾기 → 재설정 → 새 비밀번호로만 로그인', async ({ page }, info) => {
  const { email } = await guardianWithChild(page, `rc-${info.project.name}`);
  await page.context().clearCookies();

  await page.goto('/app/recovery');
  await page.getByLabel(ko.auth.recoveryEmail, { exact: true }).fill(email);
  await page.getByRole('button', { name: ko.auth.recoverySend, exact: true }).click();
  await expect(page.getByText(ko.auth.recoverySent)).toBeVisible();

  await page.goto(pathOf(await linkFor(email, '/app/reset')));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ko.auth.resetTitle);
  await page.getByLabel(ko.auth.newPassword, { exact: true }).fill(NEW_PW);
  await page.getByLabel(ko.auth.newPasswordConfirm, { exact: true }).fill(NEW_PW);
  await page.getByRole('button', { name: ko.auth.save, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/login\?reset=1/);

  await login(page, email, PW);
  await expect(page.getByText(problemCopy({ reason: 'bad_credentials' }).reason)).toBeVisible();
  await login(page, email, NEW_PW);
  await expect(page).not.toHaveURL(/\/app\/login/);
});

test('S0a 입력 칸에서 Enter로 로그인(SD_02 C3 폼 제출) — 비밀번호가 비면 Enter도 막힘', async ({ page }, info) => {
  const { email } = await guardianWithChild(page, `enter-${info.project.name}`);
  await page.context().clearCookies();
  await page.goto('/app/login');
  await page.getByRole('button', { name: ko.kakao.emailLogin }).click();
  await page.getByLabel(ko.auth.email, { exact: true }).fill(email);
  await page.getByLabel(ko.auth.email, { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/app\/login/);
  await page.getByLabel(ko.auth.password, { exact: true }).fill(PW);
  await page.getByLabel(ko.auth.password, { exact: true }).press('Enter');
  await expect(page).not.toHaveURL(/\/app\/login/);
});

test('S1b 초대 링크 복사 → 받은 사람이 링크에서 카카오로 시작 → 합류해 아이를 함께 봄 → 나가기(D36)', async ({ page, browser }, info) => {
  await guardianWithChild(page, `owner-${info.project.name}`, '하늘');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);

  await page.goto('/app/family');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ko.family.title(1));
  const made = page.waitForResponse((r) => r.url().endsWith('/v1/family/invites') && r.request().method() === 'POST');
  await page.getByRole('button', { name: ko.kakao.inviteCopy, exact: true }).click();
  const { link } = await (await made).json() as { link: string };
  await expect(page.getByText(new RegExp(`${ko.kakao.copied}|${ko.kakao.copyManual}`))).toBeVisible();
  await expect(page.getByRole('heading', { name: ko.family.pending(1) })).toBeVisible();

  // 초대받은 사람: 다른 브라우저 — 링크(로그인 전에도 열린다) → [카카오로 시작하기] → 가짜 카카오 동의 → 합류
  const co = await (await browser.newContext({ ...info.project.use })).newPage();
  await co.goto(pathOf(link));
  await co.getByRole('button', { name: ko.kakao.start }).click();
  await co.getByRole('button', { name: '동의하고 계속하기' }).click();
  await expect(co).toHaveURL(/\/app\/family\?joined=1/);
  await expect(co.getByText(ko.kakao.joined)).toBeVisible();
  await co.goto('/app/children');
  await expect(co.getByText('하늘')).toBeVisible();
  // 같은 링크는 한 번만
  const other = await (await browser.newContext({ ...info.project.use })).newPage();
  await other.goto(pathOf(link));
  await other.getByRole('button', { name: ko.kakao.start }).click();
  await other.getByRole('button', { name: '동의하고 계속하기' }).click();
  await expect(other).toHaveURL(/\/app\/invite\?error=token_invalid/);
  await expect(other.getByText(ko.kakao.inviteError.token_invalid!)).toBeVisible();
  await other.context().close();

  // 만든 보호자 화면: 두 명, 초대는 이유 달린 비활성
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ko.family.title(2));
  await expect(page.getByRole('button', { name: new RegExp(`^${ko.kakao.inviteCopy}`) })).toHaveAttribute('aria-disabled', 'true');

  // 공동 보호자가 나가면 로그인으로, 만든 보호자 쪽은 다시 한 명
  await co.goto('/app/family');
  await co.getByRole('button', { name: ko.family.leave, exact: true }).click();
  await expect(co.getByText(ko.family.leaveConfirm)).toBeVisible();
  await co.getByRole('button', { name: ko.family.leaveGo, exact: true }).click();
  await expect(co).toHaveURL(/\/app\/login/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ko.family.title(1));
  await co.context().close();
});


// SD_02 663·701(UC15 A4): 초대 링크로 온 가입은 초대받은 이메일을 미리 채운다. 2026-09-29 현재 SignupView는 빈 칸이고
// 구현: GET /v1/family/invites/lookup?token=(계약 먼저, 2026-09-29 이제민1) · SignupView 미리 채움.
test('초대 링크로 온 가입은 이메일이 미리 채워진다', async ({ page }, info) => {
  await guardianWithChild(page, `pre-${info.project.name}`);
  const coEmail = testEmail(`pre-co-${info.project.name}`);
  await page.request.post('/v1/family/invites', { data: { email: coEmail } });
  const link = new URL(await linkFor(coEmail, '/app/invite'));
  await page.goto(`/app/signup?invite=${link.searchParams.get('token')}`);
  await expect(page.getByLabel(ko.auth.email, { exact: true })).toHaveValue(coEmail);
});
