# 우리 아이 미술관

아이 작품을 가족 미술관에 보관하는 Vue·Express·Python 프로젝트다. 이 README는 팀원 로컬 실행 안내의 정본이다. 기본 실행으로 가입, 캐릭터 만들기, 원본 액자 전시를 사용한다. 움직임·깊이·설명 생성 모델은 별도 준비가 필요하며 기본 실행에서는 활성화하지 않는다.

## 처음 실행

Git과 실행 중인 Docker가 필요하다. Windows는 Docker Desktop의 Linux 컨테이너, macOS는 Docker Desktop, Linux는 Docker Engine과 Compose를 사용한다. 호스트에 Node·Python·MariaDB를 설치할 필요는 없다.

팀 저장소의 작업 브랜치를 clone하고 `museum` 폴더로 이동한다. PR의 브랜치 이름을 확인한다.

```sh
git clone --branch chore/8-museum-local-setup https://github.com/tlswlgus960-prog/git-lab-team.git
cd git-lab-team/museum
```

`.env.example`을 `.env`로 복사한다. Git Bash·macOS·Linux는 `cp .env.example .env`, PowerShell은 `Copy-Item .env.example .env`를 실행한다. `.env`의 `DB_PASSWORD`, `SESSION_SECRET`, `AUTH_HMAC_SECRET` 예시 문구를 서로 다른 로컬 값으로 바꾼다. 공백·`#`가 있으면 값 전체를 큰따옴표로 감싼다. 이 파일은 커밋하지 않는다.

```sh
docker compose up -d --build
docker compose ps
```

첫 실행은 이미지와 잠긴 의존성을 내려받아 시간이 걸린다. `migrate`가 `Exited (0)`인 것은 정상이다. DB 준비와 마이그레이션 성공 뒤 API·워커가 시작된다.

- 미술관: http://127.0.0.1:9501
- 로컬 메일함: http://127.0.0.1:8025
- 가입은 시험 이메일로 진행하고 로컬 메일함의 확인 링크를 연다. 메일은 인터넷으로 발송하지 않는다.
- 테스트 그림은 직접 그린 그림만 사용한다. `web/public/museum/sample`의 SVG는 코드로 만든 견본이며 실제 아동 자료가 아니다.

## 다시 실행하고 종료

```sh
docker compose up -d
docker compose logs --tail 50 api worker model
docker compose down
```

`down` 뒤에도 DB·작품 파일은 볼륨에 남는다. 다시 `up -d`하면 이어서 사용한다. `down -v`는 이 데이터를 지우므로 일반 종료에는 쓰지 않는다. 초기 DB 암호를 바꿔도 기존 DB 볼륨의 계정 암호가 자동 변경되지는 않는다.

포트가 사용 중이면 `.env`에서 `WEB_PORT=19501`, `MAIL_PORT=18025`로 바꾸고 `up -d`를 다시 실행한다. 이때 접속 주소도 해당 포트로 바뀐다. 다른 clone을 동시에 실행하려면 `docker compose -p museum-other up -d --build`처럼 별도 프로젝트 이름과 다른 포트를 사용한다. DB·API·모델 포트는 호스트에 공개하지 않는다.

## 검사

```sh
docker compose config --quiet
docker compose exec web npm test -- --maxWorkers=2
docker compose exec api npm run lint
docker compose exec model python -m pytest -q tests/test_m4_rules.py
```

이미지 빌드 중 웹·API 타입 검사와 빌드가 실행된다. 전체 API·서빙·Playwright 통합 검사는 임시 MariaDB와 Mailpit을 띄우는 별도 시험 환경이 필요하다. 기본 개발 DB를 통합 검사에 연결하지 않는다. 실행 결과와 미실행 항목은 [작업 기록](docs/LOCAL_SETUP.md)에 적는다.

## 파일 구조와 변경 방법

| 경로 | 역할 |
|---|---|
| `web/` | Vue 화면·단위 검사·Playwright 검사 |
| `api/` | 인증·접수·전시·운영 API |
| `serving/`, `caption/` | 모델 API·큐 워커·설명 규칙 |
| `db/migrations/` | 순서대로 적용하는 DB 변경 |
| `contracts/` | API·작업 큐 계약 |
| `models/manifest.yaml` | 모델 버전·자산 확인 기준, 가중치 아님 |
| `compose.yaml`, `ops/docker/` | 로컬 서비스 연결·이미지 빌드 |
| `docs/LOCAL_SETUP.md` | 문제·수정 이유·명령·검증 기록 |
| `THIRD_PARTY_NOTICES.md` | 포함한 이미지·소리·글꼴 출처 |

코드를 고친 뒤 `docker compose up -d --build`로 다시 빌드한다. 서버·DB·모델 설정을 화면 코드에 적지 않고 `.env` 또는 Compose 환경변수로 전달한다. 포트·임계값 같은 유효한 상수는 유지한다.

## 실제 모델 준비

기본 DB에는 활성 모델 버전이 없다. 가짜 응답을 실제 추론으로 표시하지 않는다. 원본 액자 경로와 모델 준비 상태를 확인한 뒤 모델 기능을 따로 준비한다.

- M1·M2·M5: Python 3.11 환경에 `serving/requirements-models.lock`을 해시 검사로 설치한다. `models/manifest.yaml`의 저장소·revision·라이선스·해시를 대조해 지정 자산을 준비한다. CPU 메모리와 실행 시간을 먼저 확인한다.
- M3: `requirements-m3.lock`, `conda-m3.lock`의 별도 Python 3.8·Java·렌더 환경, Animated Drawings와 TorchServe 모델 자산이 필요하다. Windows 네이티브 재현은 검증하지 않았다.
- M6: Ollama와 매니페스트의 Qwen 모델을 별도로 준비하고 `CAPTION_ENABLED`·`LLM_SERVER_URL`을 설정한다. 기본 Compose에는 Ollama가 없다.
- M7: P1 선택 기능이다. `requirements-m7.lock`과 별도 환경·모델 자산이 필요하다.

서빙 폴더의 `python -m ops.models prepare M6`는 준비 안내를 출력한다. 실제 모델은 자산 준비뿐 아니라 기존 평가·등록·승격 절차를 통과해야 활성화된다. 기본 Compose 이미지에 모델 가중치를 넣거나 자동 다운로드·승격하지 않는다. 키와 대용량 모델은 Git에 넣지 않는다.

## Docker 없이 코드 검사

Node 22.18 이상과 Python 3.11을 사용할 수 있는 개발자용 경로다. 운영 배포 설정과 별개다.

```sh
npm --prefix api ci
npm --prefix web ci
npm test
npm --prefix api run build
npm --prefix web run build
```

`npm run init`은 `.env`가 없을 때만 로컬 세션 난수를 생성한다. 네이티브 DB·메일함을 준비한 뒤 루트의 `dev:web`, `dev:api`, `dev:model`, `dev:worker`, `dev:sweeper` 스크립트를 각각 실행할 수 있다. 공통 실행기는 루트 `.env`를 읽고 상대 저장 경로를 루트 기준으로 맞춘다. 프로세스 환경변수가 `.env`보다 우선한다.
