# 로컬 실행 환경 변경 기록

이 문서는 팀원이 변경 이유와 실제 검사를 따라 확인하는 기록이다. 실행 명령의 정본은 [README](../README.md)다. 이번 조사·코드 수정·검증·문서 작성은 사용자의 요청을 받은 Codex가 수행했다. 사용자가 직접 구현하거나 시험했다고 서술하지 않는다.

## 1. 원본 확인과 보존

원본 제품 저장소는 `wpalswpa/project2610`의 `main`, 기준 커밋은 `7c6a8ab`이었다. `git status --short --branch`, `git remote -v`, `git log -3 --oneline`으로 확인했으며 미커밋 변경은 없었다. 기존 원본에 쓰지 않고 별도 clone에서 작업했다. 팀 실습 저장소 `tlswlgus960-prog/git-lab-team`의 main에는 README와 팀 규칙만 있었다.

사용자가 팀 저장소의 새 브랜치 게시를 승인한 뒤 공개용 checkout을 따로 만들었다. 원본 이력은 가져오지 않고 필요한 파일만 `museum/`에 복사했다. 기존 main 문서를 보존하고 이슈 → 브랜치 → 커밋 → draft PR 순서를 따른다. 원격에 이미 feature 브랜치가 있어 feature/8-… 생성이 거절되었으므로 기존 브랜치를 보존하고 chore/8-museum-local-setup을 사용했다.

참고한 교육 자료는 Linux_Docker/exercise/script/assets/git/templates의 README, TEAM_RULES, runbook이다. 해당 폴더에는 Docker 실행 예제가 없었다. 확인한 Runbook의 처음 준비 → 기동·확인 → 점검·종료 → 장애 대응 순서를 실행 안내에 적용했다. 블로그는 접근에 실패하여 참고 근거로 사용하지 않았다.

## 2. 관찰과 최소 변경

| 관찰한 문제 | 변경 파일 | 수정 전후와 이유 |
|---|---|---|
| README는 코드가 없다고 설명하지만 api/web/serving이 존재했다 | `README.md` | 현재 코드와 검증한 실행 명령으로 교체했다 |
| `.env` 파일을 만들어도 기존 직접 실행 명령이 읽지 않았다 | `compose.yaml`, `ops/local.mjs` | Compose는 로컬 설정을 전달하고, 네이티브 실행기는 루트 파일을 읽는다 |
| API는 api/.data/store, Python은 serving/.run/store를 기본으로 사용했다 | `compose.yaml`, `ops/local.mjs` | 하나의 저장 볼륨 또는 루트 기준 절대 경로를 공유한다 |
| API 빌드 결과는 dist/src/server.js인데 start는 dist/server.js였다 | `api/package.json` | 실제 빌드 결과로 시작 경로를 고쳤다 |
| 문서의 model_api.main:app, workers.run 진입점은 현재 코드와 달랐다 | 실행기·Dockerfile | model_api.main 모듈과 workers.main --group cpu_vision을 사용한다 |
| 서버는 루프백에만 수신하여 별도 컨테이너에서 접근하지 못한다 | `api/src/server.ts`, `serving/model_api/main.py` | 수신 주소를 환경변수로 받는다. 네이티브 기본값은 유지한다 |
| OS마다 Python·MariaDB 설치법과 경로가 다르다 | `ops/docker/*.Dockerfile`, `compose.yaml` | 고정 런타임 이미지와 기존 lockfile로 설치한다 |
| DB 초기화 전에 API가 뜨면 시작이 실패할 수 있다 | `compose.yaml` | DB healthcheck와 마이그레이션 완료를 선행 조건으로 둔다 |
| 모델이 없는 PC에서 실제 추론 완료를 보장할 수 없다 | README·Compose | 모델을 자동 활성화하지 않고 기존 원본 액자 흐름을 사용한다 |

모델 판정 규칙·상태 전이·API 계약·DB 스키마는 바꾸지 않았다. 기존 테마 화면은 라우터에서 참조하므로 죽은 코드로 간주하지 않았다. 포트·품질 임계값 등 의미가 있는 상수도 제거하지 않았다. 기존 운영 pm2 설정을 수정하거나 서버에 배포하지 않았다.

## 3. 실행 구조

브라우저 → web → api/model 순서로 요청한다. API와 워커는 같은 DB·파일 볼륨을 사용한다. Mailpit은 로컬 가입 메일을 받는다. 호스트에서 접근 가능한 포트는 웹과 메일함의 루프백 주소뿐이다. 모델 상태 파일은 별도 공유 볼륨에 둔다.

첫 `docker compose up -d --build`는 이미지를 만들고 빈 DB에 마이그레이션을 적용한다. 반복 `up -d`에서는 기존 DB와 파일 볼륨을 유지한다. 마이그레이션 서비스의 종료 코드 0은 정상이다. `down`은 컨테이너를 종료하지만 볼륨을 보존한다.

비밀값은 `.env`, 그림·DB·로그는 런타임 볼륨에 둔다. 공개용 파일 선택에서 원본 발표·캡처·평가 그림·기존 사용자 데이터·운영 설정·모델 가중치·개인 Git 이력을 제외했다. 코드로 만든 견본 SVG와 출처가 있는 미술관 사진·음악·글꼴만 포함했고 [자산 고지](../THIRD_PARTY_NOTICES.md)를 보존했다.

## 4. 실제 검사

2026-10-12 Windows 노트북의 기존 Docker Desktop Linux 엔진에서 검사했다. Docker나 OS 기능을 새로 설치하지 않았다.

| 명령 또는 흐름 | 결과 |
|---|---|
| `npm --prefix api ci`, `npm --prefix web ci` | 기존 lockfile로 설치 성공 |
| `npm --prefix api run build` | 통과 |
| `npm --prefix web run build` | 통과 |
| `npm --prefix web test -- --maxWorkers=2` | 24개 파일, 246개 검사 통과 |
| `npm test` | 공통 설정·환경변수 우선순위·경로·초기화 보존 검사 3개 통과 |
| `docker compose config --quiet` | 통과 |
| `docker compose build` | API·웹·Python 이미지 빌드 성공, Python 의존성 해시 검사 통과 |
| 빈 전용 볼륨의 `docker compose up -d` | DB healthy, migrate 종료 0, API healthy, 서비스 시작 |
| `docker compose exec api npm run lint` | 통과 |
| `docker compose exec model python -m pytest -q tests/test_m4_rules.py` | 3개 통과 |
| Chrome 1440px 가입 → Mailpit 확인 링크 → 로그인 → 별칭 등록 → 합성 PNG 업로드 → 원본 액자 전시 | 통과, 외부 메일 발송 없음 |
| Linux 컨테이너의 웹 단위 검사 | 24개 파일, 246개 통과 |
| down → up 후 390px 모바일 작품 목록 | 로그인·작품 유지, 가로 넘침 없음 |
| 게시 커밋의 별도 clone, 새 볼륨, 19501/18025 포트 | 이미지 재빌드·빈 DB 마이그레이션·API healthy 통과, Git 작업본 clean |

첫 네트워크 설치는 샌드박스 DNS 제한으로 실패했고 일반 로컬 권한에서 재실행해 성공했다. 첫 웹 단위 검사는 샌드박스 임시 파일 접근 오류로 20개 모음이 실패했다. 같은 코드를 일반 로컬 권한에서 다시 검사했으며 246개가 통과했다. 이 환경 오류를 코드가 고친 것으로 기록하지 않는다.

전체 API·서빙 DB 통합 검사와 기존 Playwright 전체 모음은 별도 임시 MariaDB·Mailpit 실행환경이 필요하다. 실제 모델·GPU 추론과 macOS·Linux 호스트의 직접 실행은 별도 검증 대상이다. 패키지 설치 시 기존 multer 1.4.4 취약 버전 경고가 확인되었다. 이번 변경은 로컬 재현용이며 인터넷 공개 운영 전 의존성 보안 업데이트와 회귀 검사가 필요하다.

## 5. 직접 재검증하는 순서

1. 새 디렉터리에 PR 브랜치를 clone한다.
2. README의 `.env` 복사·설정과 `docker compose up -d --build`를 실행한다.
3. `docker compose ps -a`에서 DB·API 상태와 migrate 종료 코드를 확인한다.
4. 시험 이메일로 가입하고 로컬 Mailpit에서 확인 링크를 연다.
5. 별칭으로 아이를 등록하고 직접 만든 시험 그림을 원본 액자로 올린다. 모델 변환이 비활성 상태로 표시되는지 확인한다.
6. `docker compose down` 뒤 다시 `up -d`하여 로그인·작품이 유지되는지 확인한다.
7. 변경 파일과 이 설명서를 읽고, 자동 검사 통과와 실제 모델 품질 검증을 구분하여 PR을 검토한다.
