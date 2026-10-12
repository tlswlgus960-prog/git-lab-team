import { expect, test } from '@playwright/test'

// T011: 글꼴을 자체 호스팅으로 불러오고(외부 CDN 요청 없음) 토큰 글꼴이 실제로 적용된다
test('Inter·Pretendard를 자체 호스팅으로 불러온다', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()) })
  await page.goto('/app/login')
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/['"]/g, '')))
  expect(loaded).toContain('Inter Variable')
  expect(loaded).toContain('Pretendard Variable')
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  expect(family).toMatch(/^"?Inter Variable/)
  expect(external).toEqual([])
})
