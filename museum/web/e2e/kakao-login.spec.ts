// 카카오 로그인(D36, SD_02 §17-7, UC13 §0 · UC15 §0) — 가짜 카카오(stack/kakao-fake.ts)로 끝까지. 390px에서는 캡처를 남긴다(보고용).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { home as hc } from '../src/app/town/copy';

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/B/카카오로그인_캡처');
async function shot(page: Page, name: string, project: string) {
  if (project !== 'mobile-390') return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
const member = () => String(Date.now() + Math.floor(Math.random() * 1000));
/** [카카오로 시작하기] → 가짜 카카오에서 회원번호를 넣고 동의(또는 취소) */
async function viaKakao(page: Page, id: string | null) {
  await page.getByRole('button', { name: ko.kakao.start }).click();
  if (id === null) { await page.getByRole('button', { name: '취소' }).click(); return; }
  await page.getByLabel('회원번호').fill(id);
  await page.getByRole('button', { name: '동의하고 계속하기' }).click();
}

test('로그인 화면: 크게 [카카오로 시작하기], 작게 이메일 로그인, 메일 문구 없음', async ({ page }, info) => {
  await page.goto('/app/login');
  await expect(page.getByRole('button', { name: ko.kakao.start })).toBeEnabled();
  await expect(page.getByRole('button', { name: ko.kakao.emailLogin })).toBeVisible();
  for (const t of ['메일을 확인', '메일 다시 받기', '로그인 정보 찾기']) await expect(page.getByText(t)).toHaveCount(0);
  await shot(page, '01_로그인', info.project.name);
});

test('처음 카카오 로그인 → 캐릭터 만들기 → 다시 오면 입장 화면 없이 바로 아이 미술관(D47 · D53)', async ({ page }, info) => {
  const id = member();
  await page.goto('/app/login');
  await viaKakao(page, id);
  await expect(page).toHaveURL(/\/app\/children\/new\?welcome=1/);
  await expect(page.getByText(ko.kakao.welcome)).toBeVisible();
  await shot(page, '02_처음로그인_아이등록', info.project.name);
  // 아이를 등록하고 전시실을 본 뒤 로그아웃 → 다시 카카오로
  const c = await page.request.post('/v1/children', { data: { alias: '별이' } });
  expect(c.status()).toBeLessThan(300);
  await page.goto('/app/hall');
  await page.getByRole('button', { name: ko.shell.menuOpen }).click(); // 로그아웃은 [메뉴] 판 안(D34 ④ · D38)
  await page.getByRole('button', { name: ko.auth.logout }).click();
  await expect(page).toHaveURL(/\/app\/login/);
  await viaKakao(page, id);
  await expect(page).toHaveURL(/\/app\/museum\/\d+/); // D53 ④: 로그인 화면을 거쳤으면 입장 화면 없이 바로 내 미술관
});

test('카카오에서 취소하면 "로그인을 취소했어요. 다시 해 볼까요?"', async ({ page }, info) => {
  await page.goto('/app/login');
  await viaKakao(page, null);
  await expect(page).toHaveURL(/\/app\/login\?kakao=cancelled/);
  await expect(page.getByText(ko.kakao.cancelled)).toBeVisible();
  await expect(page.getByRole('button', { name: ko.kakao.start })).toBeVisible();
  await shot(page, '03_취소', info.project.name);
});

test('가족 보호자: [초대 링크 복사하기] → "링크를 복사했어요. 카카오톡으로 보내 주세요"', async ({ page }, info) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await page.goto('/app/login');
  await viaKakao(page, member());
  await page.goto('/app/family');
  await page.getByRole('button', { name: ko.kakao.inviteCopy, exact: true }).click();
  await expect(page.getByText(new RegExp(`${ko.kakao.copied}|${ko.kakao.copyManual}`))).toBeVisible();
  await shot(page, '04_초대링크복사', info.project.name);
});
