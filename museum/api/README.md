# api/ — 보호자 앱 API · 운영/관리 API · sweeper (담당 B 이제민)

Node 22 · Express 4 · TypeScript · mysql2(ORM 없음). 모델을 import하지 않는다(BR-MDL-02) — 모델 일은 `stage_job` 등록과 model-api·llm-server 호출로만.
계약: `../contracts/openapi.yaml` · 스키마: `../db/migrations/0001_sd03_baseline.sql`(= SD_03).

```bash
npm ci && npm run build && npm run db:migrate   # .env 필요(팀 DB 정보는 문서에 적지 않음)
npm test                                         # 임시 MariaDB(os.tmpdir)로만. 팀 DB 사용 금지
npm run ops:staff -- add --email <메일> --role operator   # 팀원 계정(비밀번호는 표준 입력)
npm run ops:key -- issue --kind test|team_internal|course_internal   # 외부 API 키(원문 1회 표시)
```

경계: `src/modules/*`(경로별 모듈) · `src/sweeper/*`(이어받기·삭제·정리, pm2 `sweeper`) · `scripts/`(마이그레이션·운영 CLI).
