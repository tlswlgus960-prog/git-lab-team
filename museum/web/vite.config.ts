/// <reference types="vitest/config" />
// 웹 개발 서버·빌드·단위 시험(T004, D19·D23). 개발 서버는 9501, API는 app-api 9521로 프록시한다.
// app-api에는 CORS가 없다(쿠키 세션, SameSite=lax) — 브라우저는 늘 같은 출처(9501)로 부른다.
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const port = Number(process.env.WEB_PORT ?? 9501);
const api = process.env.APP_API_URL ?? 'http://127.0.0.1:9521';
const modelApi = process.env.MODEL_API_URL ?? 'http://127.0.0.1:9541';
// nginx 라우팅(quickstart §4)과 같은 순서: /v1/models/* → model-api, 그 밖 → app-api (0e1fede에서 가져옴)
const proxy: Record<string, { target: string; changeOrigin: boolean }> = {
  '/v1/models': { target: modelApi, changeOrigin: false },
  ...Object.fromEntries(['/v1', '/live', '/ready', '/openapi.json', '/_files'].map((p) => [p, { target: api, changeOrigin: false }])),
};

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port, strictPort: true, proxy },
  test: { environment: 'jsdom', include: ['src/**/*.spec.ts'] },
});
