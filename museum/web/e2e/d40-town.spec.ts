// D40·D43 미술관 마을(SD_02 §17-13, UC_16): 캐릭터 만들기 → 아이 미술관(홈) · 방 버튼 · 미니맵 · 마을 · 이웃 링크 받기 → 이웃 미술관 방문. 390 · 1440.
import { expect, test, type Page } from '@playwright/test';
import { cc } from '../src/app/character/copy';
import { m3 } from '../src/app/museum3d/copy';
import { neighbor as nc, town as tc } from '../src/app/town/copy';
import { guardianWithChild } from './stack/guardian';

const tag = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('캐릭터 만들기 4단계 → 개관 → 아이 미술관(밝은 홀 · 방 버튼 · 미니맵)', async ({ page }) => {
  await guardianWithChild(page, tag('d40a'));
  await page.goto('/app/children/new');
  await page.getByLabel(cc.nameTag).fill('달님');
  await page.getByRole('button', { name: cc.next, exact: true }).click();
  await page.getByText('여우', { exact: true }).click();
  await expect(page.getByRole('radio', { name: '여우' })).toBeChecked();
  await page.getByRole('button', { name: cc.next, exact: true }).click();
  await page.getByRole('button', { name: cc.nextStyle }).click();
  await page.getByRole('button', { name: cc.next, exact: true }).click();
  await page.getByRole('button', { name: cc.cutRibbon }).click();
  await expect(page.getByText(cc.opened('달님'))).toBeVisible();
  await page.getByRole('link', { name: cc.enter }).or(page.getByRole('button', { name: cc.enter })).click();
  await expect(page).toHaveURL(/\/app\/museum\/\d+/);
  await expect(page.getByRole('region', { name: /달님의 미술관/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: m3.roomBar }).or(page.getByRole('group', { name: m3.roomBar }))).toBeVisible();
  await page.getByRole('button', { name: m3.hall }).click();
  await noSideScroll(page);
});

test('홈 /app: 아이가 둘이면 고르기, 고른 아이는 다음에 바로', async ({ page }) => {
  await guardianWithChild(page, tag('d40b'), '하늘');
  await page.request.post('/v1/children', { data: { alias: '바다', character: 'penguin', color: 'sky', museumStyle: 'silver_wave' } });
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/welcome/); // D47: 탭 세션마다 한 번 입장 화면
  await page.getByRole('button', { name: /시작하기/ }).click(); // D53 입장 = 게임 타이틀
  await page.getByRole('button', { name: /바다의 미술관/ }).click();
  await expect(page).toHaveURL(/\/app\/museum\/\d+/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/museum\/\d+/);
  await expect(page.getByRole('region', { name: /바다의 미술관/ })).toBeVisible();
});

test('이웃 링크 받기 → 마을에서 이웃 건물 → 이웃 아이 미술관(방문, 나이 없음)', async ({ page, browser }) => {
  const A = await guardianWithChild(page, tag('d40c'), '해님');
  const inv = await page.request.post('/v1/neighbors/invites', { data: {} });
  expect(inv.status()).toBe(201);
  const link = new URL((await inv.json()).link);

  const ctxB = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const b = await ctxB.newPage();
  await guardianWithChild(b, tag('d40d'), '별님');
  await b.goto(link.pathname + link.search);
  await b.getByRole('button', { name: nc.acceptGo }).click();
  await expect(b.getByText(nc.accepted)).toBeVisible();
  await b.getByRole('link', { name: nc.toTown }).click();
  await expect(b).toHaveURL(/\/app\/town/);
  await expect(b.getByRole('navigation', { name: tc.minimap })).toBeVisible();
  await b.locator(`button.bld[aria-label="${tc.neighbor}"]`).click();
  await b.getByRole('button', { name: new RegExp(tc.museumOf(A.child.alias)) }).click();
  await expect(b).toHaveURL(new RegExp(`/app/museum/${A.child.id}\\?visit=1`));
  await expect(b.getByRole('region', { name: /해님의 미술관/ })).toBeVisible();
  await expect(b.getByText(/\d+살 전시실/)).toHaveCount(0); // 방문자는 나이를 보지 않는다
  await noSideScroll(b);
  await ctxB.close();
});

test('모르는 가족 미술관은 주소로 열어도 들어갈 수 없다', async ({ page, browser }) => {
  const A = await guardianWithChild(page, tag('d40e'), '구름');
  const ctx = await browser.newContext();
  const c = await ctx.newPage();
  await guardianWithChild(c, tag('d40f'));
  await c.goto(`/app/museum/${A.child.id}?visit=1`);
  await expect(c.getByText(tc.locked)).toBeVisible();
  await ctx.close();
});

test('D48: 로그인 없이 입장 화면 → 견본 미술관(서버 호출 없음) → [카카오로 시작하기]', async ({ page }) => {
  const api: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/v1/')) api.push(r.url()); });
  await page.goto('/app/welcome');
  await page.getByRole('link', { name: '견본 미술관 둘러보기' }).click();
  await expect(page).toHaveURL(/\/app\/sample/);
  await expect(page.getByRole('region', { name: /견본이의 미술관/ })).toBeVisible();
  await expect(page.getByText(/견본 미술관이에요/)).toBeVisible();
  await noSideScroll(page);
  expect(api).toEqual([]);
  await page.getByRole('link', { name: /카카오로 시작하기/ }).click();
  await expect(page).toHaveURL(/\/app\/login\?next=/);
});
