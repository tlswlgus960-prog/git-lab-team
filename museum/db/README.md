# db/ — 마이그레이션과 DDL 검증 (담당 B 이제민)

- `migrations/0001_sd03_baseline.sql`은 `design/uri_gallery_ddl.sql`(SD_03 정본)과 **같아야 한다** — 설계서를 먼저 고치고 복사한다(CLAUDE.md 절대 규정). `tests/ddl.verify.test.ts`가 일치·실행·재실행·위반 거부를 확인한다.
- 실행: `cd api && npm run db:migrate`(재실행 안전) · 시험: `cd api && npm test`.
