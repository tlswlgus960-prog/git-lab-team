// T075 [US3] 진행 확인 E2E(390·1440px): 대기 · 다시 시도 중 · 낮춤 안내 · 처리하지 못함 블록(S4).
// D34 ④: 모델 단계 표는 보호자에게 보이지 않는다 — 단계 줄 대신 상태 문구 · 안내만 본다.
// 활성 모델이 없어 워커가 이 상태들을 만들 수 없다 — 임시 DB에 단계 작업 행을 직접 두고 화면만 본다.
// 낮춤은 액자 합성(frame_compose)을 실제 CPU 워커가 처리해 결과가 생기는 것까지 본다.
import { expect, test, type Page } from '@playwright/test';
import { ko } from '../src/copy/ko';
import { animatedJobs, e2eDb, type Connection } from './stack/db';
import { drawingPng, guardianWithChild } from './stack/guardian';

let db: Connection;
test.beforeAll(async () => { db = await e2eDb(); });
test.afterAll(async () => { await db?.end(); });

async function uploaded(page: Page): Promise<string> {
  await page.goto('/app/upload');
  await page.locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: drawingPng() });
  const res = page.waitForResponse((r) => r.url().endsWith('/v1/artworks') && r.request().method() === 'POST');
  await page.getByRole('button', { name: ko.upload.submit, exact: true }).click();
  const r = await res;
  expect(r.status(), await r.text()).toBeLessThan(300);
  const id = String(((await r.json()) as { id: string | number }).id);
  await expect(page).toHaveURL(/\/app\/museum\//); // D34: 올리면 곧바로 걸림
  return id;
}
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test('대기 · 다시 시도 중 · 낮춤 안내 · 처리하지 못함', async ({ page }, info) => {
  await guardianWithChild(page, `us3-${info.project.name}`);

  // 1) 대기: GPU 단계가 순서를 기다림(이 스택에는 GPU 워커 없음)
  const a1 = await uploaded(page);
  await animatedJobs(db, a1, (v) => db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id) VALUES (?, 'animate_render', 'confirm', 'gpu', ?)`, [a1, v]).then(() => undefined));
  await page.goto(`/app/artworks/${a1}`);
  await expect(page.getByText(ko.state.processing_queued)).toBeVisible();
  await expect(page.getByText(ko.rail.leaveOk)).toBeVisible();
  await fits(page);

  // 2) 다시 시도 중: 인프라 오류 뒤 재시도 대기(하루 뒤로 미뤄 워커가 잡지 않음)
  const a2 = await uploaded(page);
  await animatedJobs(db, a2, (v) => db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count, error_class, available_at)
    VALUES (?, 'animate_render', 'confirm', 'gpu', ?, 'retry_wait', 2, 'engine_down', UTC_TIMESTAMP() + INTERVAL 1 DAY)`, [a2, v]).then(() => undefined));
  await page.goto(`/app/artworks/${a2}`);
  await expect(page.getByText(ko.state.retrying, { exact: true })).toBeVisible();
  await fits(page);

  // 3) 낮춤 안내: 움직임 품질 미달 → 액자 합성(실제 워커) → 결과 확인 대기, C6 문구
  const a3 = await uploaded(page);
  await animatedJobs(db, a3, async (v) => {
    await db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, status, attempt_count, downgrade_cause, finished_at)
      VALUES (?, 'animate_render', 'confirm', 'gpu', ?, 'done_downgraded', 1, 'animated_to_frame', UTC_TIMESTAMP())`, [a3, v]);
    await db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group) VALUES (?, 'frame_compose', 'downgrade', 'cpu_vision')`, [a3]);
  });
  await page.goto(`/app/artworks/${a3}`);
  const [from, to] = ko.downgrade.animated_to_frame!;
  await expect(page.getByText(ko.downgradeNote(from, to))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: ko.list.toReview })).toBeVisible();
  await fits(page);

  // 4) 처리하지 못함(G9): 인프라 실패 3회 — "낮춘 결과가 아니에요", 원본 액자로 걸 수 있음
  const a4 = await uploaded(page);
  await db.query(`UPDATE artwork SET status = 'processing', confirmed_at = UTC_TIMESTAMP() WHERE artwork_id = ?`, [a4]);
  await db.query(`INSERT INTO artwork_outcome (artwork_id, suggestion_at_confirm, confirmed_path, in_approval_base) VALUES (?, NULL, 'frame', TRUE)`, [a4]);
  await db.query(`INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, status, attempt_count, error_class, finished_at)
    VALUES (?, 'frame_compose', 'confirm', 'cpu_vision', 'failed', 3, 'engine_down', UTC_TIMESTAMP())`, [a4]);
  await db.query(`UPDATE artwork SET status = 'failed' WHERE artwork_id = ?`, [a4]);
  await page.goto(`/app/artworks/${a4}`);
  const g9 = page.locator('[data-gate="G9"]');
  await expect(g9).toBeVisible();
  await expect(g9).toContainText(ko.notDelivered.summary);
  await expect(page.getByText(/낮춘 결과가 아니에요/)).toBeVisible();
  await fits(page);
});
