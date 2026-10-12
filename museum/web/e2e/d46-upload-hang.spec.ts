// D46 · D49 올리기 한 번에(SD_02 §17-9 · §17-14): 설명 칸 · 그림/만들기 → 곧바로 미술관에 걸림 → 이야기는 보기만 ·
// 움직임 질문 "애니메이션으로 만드시겠습니까?" [예] · [아니오] · 가족 코멘트는 기한(7일, 화면 안내 없음)이 지나면 조용히 보기만. 390 · 1440.
import { expect, test, type Page } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { e2eDb, type Connection } from './stack/db';
import { drawingPng, guardianWithChild } from './stack/guardian';

/** 임시 E2E DB에서만: 가짜(runtime='fake') M3 버전을 켜서 움직임 선택지를 연다 — 돌려준 함수로 내린다 */
async function openAnimated(db: Connection): Promise<() => Promise<void>> {
  const [v] = await db.query(`INSERT INTO model_version (model_id, version_label, weights_sha256, config_hash, runtime, license_confirmed, release_state, exec_device)
    VALUES ('M3', CONCAT('e2e-', LEFT(REPLACE(UUID(), '-', ''), 12)), REPEAT('0', 64), REPEAT('0', 64), 'fake', TRUE, 'active', 'cpu')`) as [{ insertId: number }];
  return async () => { await db.query(`UPDATE model_version SET release_state = 'retired' WHERE version_id = ?`, [v.insertId]); };
}
/** SHOTS=폴더면 화면을 찍어 둔다(사람 눈 확인용, D53 게임 틀) */
async function shot(page: Page, name: string) { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}-${page.viewportSize()?.width}.png`, fullPage: true }); }
const tag = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
async function uploadWith(page: Page, fill: (p: Page) => Promise<void>): Promise<string> {
  await page.goto('/app/upload');
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: drawingPng() });
  await fill(page);
  const done = page.waitForResponse((r) => r.url().endsWith('/v1/artworks') && r.request().method() === 'POST');
  await page.getByRole('button', { name: ko.upload.submit, exact: true }).click();
  const r = await done;
  expect(r.status(), await r.text()).toBeLessThan(300);
  return String((await r.json() as { id: string | number }).id);
}

test('설명을 적고 올리면 곧바로 아이 미술관에 걸리고, 이야기는 보기만 한다', async ({ page }) => {
  await guardianWithChild(page, tag('d46a'));
  const id = await uploadWith(page, async (p) => {
    await p.getByLabel(ko.up2.title).fill('해바라기');
    await p.getByText(ko.up2.more).click(); // 한마디 · 감상은 접혀 있다
    await shot(p, 'upload')
    await p.getByLabel(ko.up2.words).fill('해가 웃어요');
    await expect(p.getByRole('radio', { name: new RegExp(ko.up2.drawing) })).toBeChecked();
  });
  await expect(page).toHaveURL(/\/app\/museum\/\d+/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.goto(`/app/artworks/${id}/story`);
  await expect(page.getByRole('heading', { name: '해바라기', level: 1 })).toBeVisible();
  await expect(page.getByText('해가 웃어요')).toBeVisible();
  // 1440에서 액자가 글 칸을 덮지 않는다(판별 B2-1)
  const [art, words] = [await page.locator('.sv-art .artframe').boundingBox(), await page.locator('.sv-words').boundingBox()];
  if (art!.y + art!.height > words!.y && words!.y + words!.height > art!.y) expect(art!.x + art!.width).toBeLessThanOrEqual(words!.x + 1);
  // 액자만 늘어 빈 금색 판이 생기지 않는다(판별 A2-1): 액자 폭 - 그림 폭 = 매트 · 테 두께 정도
  const img = await page.locator('.sv-art .artframe img').boundingBox();
  expect(art!.width - img!.width).toBeLessThan(130);
  await expect(page.getByText(ko.up2.lockNote)).toBeVisible();
  await shot(page, 'story');
  await expect(page.locator('.sv-wall form, .sv-wall input, .sv-wall textarea')).toHaveCount(0); // 이야기는 보기만(댓글 입력은 따로)
  // 서버도 막는다(D46 ①)
  const put = await page.request.put(`/v1/artworks/${id}/story`, { data: { title: '바꿈' } });
  expect(put.status()).toBe(409);
});

test('만들기로 올리면 making으로 걸린다', async ({ page }) => {
  await guardianWithChild(page, tag('d46b'));
  const id = await uploadWith(page, async (p) => { await p.getByText(ko.up2.making).click(); await expect(p.getByRole('radio', { name: new RegExp(ko.up2.making) })).toBeChecked(); });
  const d = await (await page.request.get(`/v1/artworks/${id}`)).json() as { making: boolean; exhibited: boolean };
  expect(d.making).toBe(true);
});

test('움직일 수 있는 그림이면 "애니메이션으로 만드시겠습니까?" — [예]면 만들기 시작', async ({ page }) => {
  await guardianWithChild(page, tag('d49'));
  const id = await uploadWith(page, async () => {});
  const db = await e2eDb();
  const off = await openAnimated(db);
  try {
    await db.query(`INSERT INTO judgment (artwork_id, split_ok, suggestion, suggestion_state) VALUES (?, 1, 'animated', 'presented')
      ON DUPLICATE KEY UPDATE suggestion = 'animated', suggestion_state = 'presented'`, [id]);
    await db.query(`UPDATE artwork SET status = 'awaiting_confirm' WHERE artwork_id = ? AND status IN ('received','judging')`, [id]);
    await page.goto(`/app/artworks/${id}`);
    const card = page.getByRole('region', { name: ko.animAsk.q }); // 작품 상세 = 인라인 구역(대화상자는 미술관 걸리는 장면 뒤)
    await expect(card).toBeVisible();
    const [y, n] = [card.getByRole('button', { name: ko.animAsk.yes, exact: true }), card.getByRole('button', { name: ko.animAsk.no, exact: true })];
    const [by, bn] = [await y.boundingBox(), await n.boundingBox()];
    expect(Math.round(by!.width)).toBe(Math.round(bn!.width)); // 같은 무게(U10)
    await shot(page, 'detail-ask');
    await y.click();
    await expect(page.getByText(ko.animAsk.started)).toBeVisible();
    const d = await (await page.request.get(`/v1/artworks/${id}`)).json() as { confirmedKind: string | null };
    expect(d.confirmedKind).toBe('animated');
  } finally { await off(); await db.end(); }
});

test('가족 코멘트 — 기한(7일, 안내 없음)이 지나면 조용히 보기만', async ({ page }) => {
  await guardianWithChild(page, tag('d46c'));
  const id = await uploadWith(page, async () => {});
  await page.goto(`/app/artworks/${id}`);
  await page.getByPlaceholder(ko.comment.ph).fill('정말 멋지다');
  await page.getByRole('button', { name: ko.comment.send, exact: true }).click();
  await expect(page.getByText('정말 멋지다')).toBeVisible();
  await expect(page.getByText(/7일|남았어요/)).toHaveCount(0); // 기한은 내부 규칙(D46 ⑨)

  const db = await e2eDb();
  try { await db.query(`UPDATE artwork SET hung_at = UTC_TIMESTAMP() - INTERVAL 8 DAY, received_at = UTC_TIMESTAMP() - INTERVAL 8 DAY WHERE artwork_id = ?`, [id]); }
  finally { await db.end(); }
  await page.reload();
  await expect(page.getByText('정말 멋지다')).toBeVisible();
  await expect(page.getByText(/기간|끝났어요/)).toHaveCount(0); // 조용히 보기만
  await expect(page.getByPlaceholder(ko.comment.ph)).toHaveCount(0);
  await expect(page.getByRole('button', { name: ko.comment.del, exact: true })).toHaveCount(0);
});
