// E2E(T004, R-19): 휴대폰 390px · 데스크톱 1440px 두 프로젝트(SD_02 §3-5, D22 ⑥).
// 흐름 E2E(T044~)는 e2e/stack이 띄우는 임시 MariaDB·별도 app-api·별도 Mailpit에 붙는다 — 팀 DB·p1에는 붙지 않는다.
// 팀 서버에서는 9501을 운영 nginx가 쓰므로 웹은 기본 9613(다른 포트는 WEB_PORT). 나머지 포트는 e2e/stack/ports.ts.
import { defineConfig } from '@playwright/test';
import { API_PORT, WEB_PORT } from './e2e/stack/ports';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/stack/global-setup.ts',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, locale: 'ko-KR' },
  projects: [
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    port: WEB_PORT,
    reuseExistingServer: false,
    timeout: 240_000, // 팀 서버가 바쁠 때 빌드가 60초(기본)를 넘는다
    env: { WEB_PORT: String(WEB_PORT), APP_API_URL: `http://127.0.0.1:${API_PORT}`, MODEL_API_URL: 'http://127.0.0.1:9' },
  },
});
