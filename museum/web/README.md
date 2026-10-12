# web — 보호자 앱(/app) · 운영 화면(/ops) (담당 C 신지현)

Vue 3.5 · Vite 8 · TypeScript 5.9 · Pinia 3 · Vue Router 4.6 · Vitest 5 · Playwright (D23, Node 22 LTS 이상).
화면 기준은 `design/SD_02_UIUX설계서_우리아이미술관.md`, 모양은 `design/style-guide/스타일가이드_우리아이미술관.html`, 문구는 `docs/C/C_화면문구.md`.
API는 `contracts/openapi.yaml`에 있는 것만 부른다. 모델·DB를 직접 부르지 않는다.

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 `http://127.0.0.1:9501` — `/v1`·`/live`·`/ready`·`/openapi.json`은 app-api `127.0.0.1:9521`로 프록시(D19). 팀 서버에서는 띄우지 않는다(9501은 운영 nginx) |
| `npm run build` | 타입 검사 뒤 `dist/` — 배포는 `ops/server/DEPLOY.md`가 `/srv/uam/web/dist`로 옮긴다 |
| `npm test` | 단위 시험(Vitest, jsdom) |
| `npm run e2e` | Playwright 390px·1440px. 다른 포트는 `WEB_PORT=9511 npm run e2e` |
| `npm run gen:api` | 계약에서 API 타입 생성(T036) |

로컬 app-api는 `.env`에 `APP_PORT=9521`, `APP_BASE_URL=http://127.0.0.1:9501`, `SECURE_COOKIES=0`(http 개발)을 둔다.
