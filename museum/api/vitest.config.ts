import path from 'node:path';
import { defineConfig } from 'vitest/config';

// 시험은 임시 MariaDB(tests/helpers/globalSetup.ts)를 하나 띄워 모든 파일이 순서대로 쓴다.
// db/tests(T017)는 api/ 밖에 있어 의존 모듈을 api/node_modules에서 찾게 한다.
const nm = (m: string) => path.resolve(__dirname, 'node_modules', m);
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', '../db/tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/globalSetup.ts'],
    setupFiles: ['tests/helpers/contract.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
  resolve: { alias: { 'mysql2/promise': nm('mysql2/promise.js'), vitest: nm('vitest') } },
  server: { fs: { allow: ['..'] } },
});
