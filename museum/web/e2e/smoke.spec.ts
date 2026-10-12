// T004 E2E 골격: 두 화면 크기에서 보호자 로그인 화면이 열린다(S0a 자리). 흐름 E2E는 T044·T059·T075·T087.
import { expect, test } from '@playwright/test';

test('보호자 로그인 화면이 열린다(S0a 자리)', async ({ page }) => {
  await page.goto('/app/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('로그인');
});
