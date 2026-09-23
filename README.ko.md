# open-todo

작은 팀이 자기 서버에 올려 쓰는 할 일 관리 앱 입니다. 공유하는 목록과 그룹, 달력, 프로젝트 대화방,
그리고 한 주의 일에서 저절로 만들어지는 주간보고서. 한국어와 영어.
설치 하나가 조직 하나 입니다.

Next.js 16 · React 19 · Prisma 7 · PostgreSQL. MIT 라이선스.

[English README](README.md)

![달력 화면](docs/images/calendar.png)

## 할 수 있는 일

- **할 일** — 그룹 안의 목록, 세부 단계, 기한, 미리 알림, 반복, 중요 표시, 첨부, 메모.
  목록이나 그룹째로 보기·편집·관리 권한을 나눠 준다. 담당자로 지정하면 상대의 *나에게 할당됨* 에 뜬다.
- **달력** — 기한이 있는 일을 달 단위로, 공휴일과 함께. 다른 날로 끌어다 놓을 수 있다.
- **프로젝트** — 프로젝트마다 대화방. 스레드, @호출, 파일, 안 읽음 표시. 이 서버의 누구나 들어올 수
  있게 열어 두거나 초대한 사람만 받을 수 있다.
- **주간보고서** — 한 주의 일을 *이번 주 한 일*, *진행 중*, *앞으로 할 일* 로 모아 목록별로 묶는다.
  고쳐 쓰고, 발행하면 그 순간이 굳고, 링크로 공유하거나 HTML 본문 + PDF 로 메일을 보낸다 —
  지금 또는 예약한 시각에.
- **알림** — 미리 알림, 오늘 기한, 담당 지정, @호출. 원하면 아침 요약 메일을 각자 현지 8시에 받는다.
- **로그인** — 이메일·비밀번호, 그리고 원하면 Google. 카카오·네이버는 준비 중.
- **관리자** — 가입 정책, 초대 링크, 사람(관리자 지정·사용 중지·재설정 링크 발급), 설치 이름.

| 할 일과 상세 | 주간보고서 |
|---|---|
| ![](docs/images/tasks.png) | ![](docs/images/report.png) |

## Docker 로 시작하기

컨테이너 하나에 다 들어 있습니다 — 앱, 그 앱의 PostgreSQL, 예약 작업까지. 다시 올려도 남아야 하는 것
(데이터베이스·첨부·자동으로 만든 세션 열쇠)은 볼륨 하나에 있습니다.

```bash
docker run -d --name todo \
  -v todo-data:/data -p 3000:3000 --shm-size=256m \
  -e APP_BASE_URL=https://todo.example.com \
  ghcr.io/wittbox/open-todo:latest
```

`APP_BASE_URL` 은 사람들이 칠 주소입니다 — 메일 링크와 OAuth 콜백이 여기서 나옵니다. 정해야 하는 값은
이것 하나뿐이고, 첫 기동이 데이터베이스를 만들고 마이그레이션을 적용하고 세션 열쇠를 볼륨에 적습니다.

소스에서 빌드하려면(같은 이미지를 만들고 `.env` 를 읽습니다):

```bash
git clone https://github.com/wittbox/open-todo.git
cd open-todo
cp .env.example .env     # APP_BASE_URL 만 채우면 됩니다
docker compose up -d --build
```

앞에 HTTPS 리버스 프록시를 두고(아래) 주소를 엽니다.

**관리자 계정** 아무도 없는 설치에서는 첫 가입자가 관리자가 되고,
인터넷에서 닿는 서버라면 시작 전에 `.env` 에
`ADMIN_BOOTSTRAP_EMAIL=you@example.com` 을 적어 두세요. 그 주소만 관리자 계정을 차지할 수 있습니다.

그다음은 `/admin` 에서 누가 더 들어올 수 있는지 정합니다.

- **초대만**(기본) — 관리자가 초대 링크를 만든다.
- **허용 이메일 도메인** — 그 도메인의 주소를 확인한 사람은 가입할 수 있다.
- **누구나** — 열린 가입. 이때 사람 검색은 이름 조각이 아니라 정확한 이메일 주소를 요구한다.

## 메일

가입 확인, 비밀번호 재설정, 초대, 아침 요약, 보고서 메일이 모두 SMTP 로 나갑니다. 회사 메일 서버,
앱 비밀번호를 쓴 Gmail, SES, Mailgun, Postmark 등 아무거나 됩니다.

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587                       # 465 = 처음부터 TLS, 그 밖은 STARTTLS 필수
SMTP_USER=todo@example.com
SMTP_PASS=…
MAIL_FROM="open-todo <todo@example.com>"
```

`npm run mail:test -- you@example.com` 으로 확인합니다.

보고서 메일의 보낸 사람은 **설치 주소**이고 이름만 작성자로 보입니다. 답장은 작성자에게 갑니다.

메일 서버가 없어도 앱은 돕니다. 초대와 재설정 링크를 관리자가 직접 전달하면 됩니다.

## Google 로그인

Google Auth Platform → 앱 만들기 → OAuth 클라이언트 ID(웹) → 리디렉션 URI
`{APP_BASE_URL}/auth/google/callback` 추가. 두 값을 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 에 넣으면
버튼이 나옵니다. 앱이 Google 의 *테스트* 상태인 동안에는 등록한 테스트 사용자만 로그인할 수 있습니다.


## 환경 변수

컨테이너 안에서 데이터베이스·첨부 폴더·예약 작업은 이미 이어져 있습니다. 아래는 바꿀 수 있는 것들입니다.

| 변수 | 필수 | 하는 일 |
|---|---|---|
| `APP_BASE_URL` | ○ | 공개 주소. 메일 링크와 OAuth 콜백이 여기서 나오고, `https://` 여야 세션 쿠키에 `Secure` 가 붙는다. |
| `SESSION_SECRET` | | 세션 쿠키 서명. 32자 이상. 비워 두면 첫 기동 때 만들어 `/data/secrets` 에 넣는다. 바꾸면 모두 로그아웃된다. |
| `APP_NAME` | | 제목·메일에 쓰는 설치 이름. 관리자가 `/admin` 에서 적은 이름이 우선한다. 기본 `open-todo`. |
| `ADMIN_BOOTSTRAP_EMAIL` | | 첫 관리자 가입을 한 주소로 묶는다. |
| `DEFAULT_LOCALE` | | 고르지 않은 사람에게 쓸 `ko` 또는 `en`. 기본 `ko`. |
| `APP_TZ` | | 고르지 않은 사람에게 쓸 IANA 시간대. 기본 `Asia/Seoul`. |
| `HOLIDAY_REGION` | | `kr` 또는 `none`. 기본 `kr`. |
| `TRUST_PROXY` | | 앞에 선 프록시 수(보통 `1`). 그때만 `X-Forwarded-For` 를 요청 제한에 쓴다. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | | 메일 서버. `SMTP_HOST` 가 없으면 운영에서는 보내지 않고 실패한다. |
| `REPORT_MAIL_MAX_RECIPIENTS` | | 보고서 한 번에 받는 사람 수. 기본 10. |
| `REPORT_MAIL_DAILY_LIMIT` | | 한 사람이 24시간에 보낼 수 있는 수신자 합계. 기본 100. |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` | | Google 로그인. |
| `MOCK_MAIL` | | `1` 이면 보내는 대신 `tmp/mail/*.html` 로 떨어뜨린다. 개발 전용. |
| `RUN_JOBS` | | `0` 이면 앱 안의 스케줄러를 끈다 — `/api/cron/*` 를 밖에서 두드리는 설치용. 컨테이너에서는 기본 켜짐. |
| `CRON_KEY` | | `/api/cron/*` 의 열쇠. `RUN_JOBS=0` 일 때만 필요하다. 없으면 그 주소는 `404` 로 닫혀 있다. |
| `APP_PORT` | | `docker-compose.yml` 이 여는 호스트 포트. 기본 3000. |
| `DATABASE_URL` `DATABASE_POOL_MAX` `UPLOAD_DIR` | | 컨테이너 밖에서 개발할 때. 이미지는 자기 값을 쓴다. |

앱은 시작할 때 이 값들을 살펴보고 빠졌거나 수상한 것을 `[setup]` 줄로 남깁니다.

## 리버스 프록시 뒤에서

Caddy:

```caddy
todo.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
server {
	listen 443 ssl http2;
	server_name todo.example.com;

	client_max_body_size 25m;   # 첨부

	location / {
		proxy_pass http://127.0.0.1:3000;
		proxy_set_header Host $host;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Host $host;
	}
}
```

그다음 `TRUST_PROXY=1` 을 넣어 로그인 요청 제한이 프록시가 아니라 방문자의 주소를 보게 하고,
`APP_BASE_URL` 이 사람들이 실제로 치는 주소와 같은지 확인합니다.

## 예약 작업

아무도 보고 있지 않을 때 해야 하는 일이 있고, 앱이 그것을 스스로 돕니다.

| 작업 | 주기 | 하는 일 |
|---|---|---|
| `tick` | 매시 | 미리 알림, 오늘 기한 알림, 각자 시간대의 아침 8시 요약, 다 쓴 링크 청소. |
| `sends` | 5분마다 | 예약해 둔 보고서 메일. |

설정할 것은 없습니다. 밖에서 돌리고 싶다면(호스트의 cron, 쿠버네티스 CronJob 등) `RUN_JOBS=0` 과
`CRON_KEY` 를 주고 주소 두 개를 두드리면 됩니다. 그 열쇠가 없으면 주소는 `404` 로 닫혀 있습니다.

```cron
*/5 * * * * curl -fsS -X POST -H "x-cron-key: $CRON_KEY" https://todo.example.com/api/cron/sends
0   * * * * curl -fsS -X POST -H "x-cron-key: $CRON_KEY" https://todo.example.com/api/cron/tick
```

## 업데이트

```bash
docker pull ghcr.io/wittbox/open-todo:latest
docker stop todo && docker rm todo
docker run -d --name todo -v todo-data:/data -p 3000:3000 --shm-size=256m \
  -e APP_BASE_URL=https://todo.example.com ghcr.io/wittbox/open-todo:latest
```

클론에서 쓰고 있다면 `git pull && docker compose up -d --build` 입니다.

컨테이너가 앱보다 먼저 새 마이그레이션을 적용합니다. PostgreSQL 메이저는 이미지에 들어 있으니,
메이저가 올라가는 판은 릴리스 노트를 먼저 읽으세요(아래).

## 백업

상태를 가진 것은 전부 볼륨 안에 있습니다 — 데이터베이스, 첨부, 자동으로 만든 세션 열쇠.

```bash
docker exec todo pg_dump -U todo todo | gzip > backup-$(date +%F).sql.gz
docker run --rm -v todo-data:/data -v "$PWD":/out alpine \
  tar czf /out/data-$(date +%F).tar.gz -C /data uploads secrets
```

되돌릴 때는 `--db-only` 로 띄웁니다 — PostgreSQL 만 서고 앱은 서지 않아서, 손보는 동안 아무도 쓰지 않습니다.

```bash
docker run -d --name todo-restore -v todo-data:/data --shm-size=256m \
  -e APP_BASE_URL=http://localhost:3000 ghcr.io/wittbox/open-todo:latest --db-only
gunzip -c backup-2026-09-23.sql.gz | docker exec -i todo-restore psql -U todo -d todo
docker rm -f todo-restore
```

그다음 평소대로 다시 띄웁니다. 덤프와 함께 `secrets/` 도 챙기세요 — 세션 열쇠를 잃으면 모두
로그아웃되고, 업로드를 잃으면 목록에는 있는데 열리지 않는 첨부가 남습니다.

## PostgreSQL 메이저 올리기

이미지는 PostgreSQL 메이저 하나를 담고 있습니다. 나중 이미지가 더 높은 메이저로 가면, 예전 클러스터를
건드리지 않고 **뜨지 않으면서** 로그로 알립니다. 방법은 덤프 → 갈아타기 → 복원입니다.

```bash
# 아직 예전 이미지가 떠 있을 때
docker exec todo pg_dump -U todo todo | gzip > before-upgrade.sql.gz
docker rm -f todo
docker volume rm todo-data                 # 예전 클러스터 — 덤프는 손에 있습니다
docker run -d --name todo-restore -v todo-data:/data --shm-size=256m \
  -e APP_BASE_URL=http://localhost:3000 ghcr.io/wittbox/open-todo:새버전 --db-only
gunzip -c before-upgrade.sql.gz | docker exec -i todo-restore psql -U todo -d todo
docker rm -f todo-restore
```

볼륨을 새로 만들었다면 `uploads/` 와 `secrets/` 도 옮겨 놓습니다.

## 컨테이너 넷에서 옮겨 오기

0.2 이전 설치는 `db`·`migrate`·`app`·`cron` 을 나란히 띄웠습니다. 단일 컨테이너는 그 데이터를 그대로
받아들입니다 — 같은 PostgreSQL 메이저, 같은 `todo` 역할, 같은 `./data` 폴더입니다.

```bash
docker compose down --remove-orphans   # 옛 db 컨테이너가 ./data/postgres 를 놓아야 합니다
git pull
docker compose up -d --build
```

첫 기동이 기존 클러스터를 찾아 `pg_hba.conf` 에 한 줄을 더하고(컨테이너 안에서 앱이 닿도록) 밀린
마이그레이션을 적용합니다. `POSTGRES_PASSWORD` 와 `CRON_KEY` 는 이제 필요 없고, `.env` 의
`SESSION_SECRET` 은 그대로 쓰여서 아무도 로그아웃되지 않습니다.

## 개발

Node 24.7 이상(비밀번호 해시에 내장 `crypto.argon2` 를 쓴다).

```bash
npm install
npm run db:dev          # 로컬 PostgreSQL 을 띄우고 .env 에 넣을 주소를 찍는다
npm run db:migrate
npm run db:seed         # 가상 인물·목록·발행된 보고서
npm run dev
```

시드 계정의 비밀번호는 `open-todo-dev` 이고, `next dev` 로 띄우면 로그인 화면이 하나를 알려 줍니다.

```bash
npm test                # vitest(DB 를 쓰는 시험 포함)
npx tsc --noEmit        # 타입
npm run lint
npm run check:i18n      # messages/ 밖에 화면 글이 없는지
npm run build
```

## 번역

화면에 보이는 글은 전부 `messages/<언어>/<묶음>.json` 에 있고, `ko` 와 `en` 이 기본으로 들어 있습니다.
언어를 더하려면 `messages/en` 을 `messages/<코드>` 로 복사해 값을 옮기고 `i18n/locales.ts` 에 코드를
더합니다. 화면 글을 코드에 박으면 `npm run check:i18n` 에 막힙니다. 사람마다 *설정* 에서 언어를 고르고,
설치 기본값은 `DEFAULT_LOCALE` 입니다.

## 보안 메모

- HTTPS 로 서비스한다. 세션 쿠키의 `Secure` 와 `__Host-` 접두는 `APP_BASE_URL` 이 `https://` 일 때만 붙는다.
- 비밀번호는 argon2id(19 MiB, 2패스)이고 매개변수를 해시와 함께 저장해 나중에 올릴 수 있다.
  세션에는 번호가 들어 있어 요청마다 DB 와 맞춰 본다 — 비밀번호 변경·사용 중지·'모든 기기에서
  로그아웃' 이 즉시 듣는다.
- 로그인·가입·재설정·메일 보내기는 주소와 IP 기준으로 횟수를 제한한다. IP 는 `TRUST_PROXY` 로
  프록시 수를 알려 줬을 때만 믿는다.
- 보고서 메일은 주소를 확인한 사람만, 한 번에 받는 사람 수와 하루 합계 안에서 보낼 수 있다 —
  설치가 스팸 중계기가 되지 않게.
- 초대·확인·재설정 링크는 SHA-256 해시로만 저장하고, 원본은 딱 한 번 보여 준다.
- 컨테이너 안의 PostgreSQL 은 루프백으로만 듣는다 — 밖으로 열지도, 다른 컨테이너에서 닿지도 않는다.
  그래서 비밀번호 없이 신뢰(trust)로 두었고, 샐 비밀번호 자체가 없다. PID 1 은 볼륨을 준비할 때만
  root 이고, 계속 도는 것은 권한을 낮춘 뒤다 — PostgreSQL 은 `postgres`, 앱은 따로 만든 계정.
- 문제를 찾았다면 [SECURITY.md](SECURITY.md).

## 기여

이슈와 PR 을 환영합니다. 한국어·영어 문구가 따르는 용어집은 [CONTRIBUTING.md](CONTRIBUTING.md) 에 있습니다.

## 라이선스

[MIT](LICENSE). 함께 들어 있는 Pretendard 글꼴은 SIL Open Font License 를 따른다
([assets/fonts/Pretendard-LICENSE.txt](assets/fonts/Pretendard-LICENSE.txt)).
