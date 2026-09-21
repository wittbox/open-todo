# open-todo

작은 팀이 자기 서버에 올려 쓰는 할 일 관리 앱. 공유하는 목록과 그룹, 달력, 프로젝트 대화방,
그리고 한 주의 일에서 저절로 만들어지는 주간보고서. 한국어와 영어, 사람마다 다른 시간대.
설치 하나가 팀 하나다 — 테넌트도, 클라우드 계정도, 밖으로 나가는 통신도 없다.

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

Docker 와 Compose 플러그인, 그리고 주소로 닿을 수 있는 서버가 필요하다.

```bash
git clone https://github.com/wittbox/open-todo.git
cd open-todo
cp .env.example .env
```

`.env` 에 네 가지를 채운다.

```bash
POSTGRES_PASSWORD=   # openssl rand -hex 24
APP_BASE_URL=        # https://todo.example.com — 사람들이 칠 주소
SESSION_SECRET=      # openssl rand -hex 32
CRON_KEY=            # openssl rand -hex 32
```

그리고:

```bash
docker compose up -d --build
```

컨테이너 넷이 뜬다: PostgreSQL, 한 번 돌고 끝나는 마이그레이션, 3000 포트의 앱, 그리고 예약 작업
주소를 두드려 주는 작은 사이드카. 앞에 HTTPS 리버스 프록시를 두고(아래) 주소를 연다.

**남보다 먼저 관리자 계정을 만들어야 한다.** 아무도 없는 설치에서는 첫 가입자가 관리자가 되고,
그 문은 다시 열리지 않는다. 인터넷에서 닿는 서버라면 시작 전에 `.env` 에
`ADMIN_BOOTSTRAP_EMAIL=you@example.com` 을 적어 두자 — 그 주소만 첫 계정을 차지할 수 있다.
관리자가 없는 동안 서버 로그에 경고가 계속 찍힌다.

그다음은 `/admin` 에서 누가 더 들어올 수 있는지 정한다.

- **초대만**(기본) — 관리자가 초대 링크를 만든다.
- **허용 이메일 도메인** — 그 도메인의 주소를 확인한 사람은 가입할 수 있다.
- **누구나** — 열린 가입. 이때 사람 검색은 이름 조각이 아니라 정확한 이메일 주소를 요구한다 —
  사용자 목록을 훑어 갈 수 없게.

## 메일

가입 확인, 비밀번호 재설정, 초대, 아침 요약, 보고서 메일이 모두 SMTP 로 나간다. 회사 메일 서버,
앱 비밀번호를 쓴 Gmail, SES, Mailgun, Postmark 등 아무거나 된다.

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587                       # 465 = 처음부터 TLS, 그 밖은 STARTTLS 필수
SMTP_USER=todo@example.com
SMTP_PASS=…
MAIL_FROM="open-todo <todo@example.com>"
```

`npm run mail:test -- you@example.com` 으로 확인한다(개발 의존성이 필요하므로 클론한 폴더에서
돌리는 편이 쉽다).

보고서 메일의 보낸 사람은 **늘 설치 주소**이고 이름만 작성자로 보인다. 답장은 작성자에게 간다.
작성자 주소로 직접 보내면 받는 쪽 SPF·DMARC 에서 막힌다.

메일 서버가 없어도 앱은 돈다. 초대와 재설정 링크를 관리자가 직접 전달하면 되고, 화면에도 그렇게
안내한다. 대신 운영에서는 조용히 삼키지 않고 실패한다.

## Google 로그인

선택이다. Google Auth Platform → 앱 만들기 → OAuth 클라이언트 ID(웹) → 리디렉션 URI
`{APP_BASE_URL}/auth/google/callback` 추가. 두 값을 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 에 넣으면
버튼이 나온다. 앱이 Google 의 *테스트* 상태인 동안에는 등록한 테스트 사용자만 로그인할 수 있다 —
모두에게 열려면 게시한다.

**카카오·네이버는 아직 쓸 수 없다.** 코드는 저장소에 있지만 실제 서비스로 로그인해 본 적이 없어
꺼 두었다 — 열쇠를 넣어도 버튼이 나오지 않고, 서버가 시작할 때 로그로 알린다.

제공자 토큰은 쓰고 버린다(저장하지 않는다). 같은 이메일의 기존 계정에 **자동으로 붙이지 않는다** —
원래 방법으로 로그인한 뒤 *설정* 에서 연결한다. 제공자 쪽 주소를 손에 넣은 사람이 남의 계정을
가져가지 못하게 하려는 것이다.

## 환경 변수

| 변수 | 필수 | 하는 일 |
|---|---|---|
| `DATABASE_URL` | ○ | PostgreSQL 접속 주소. compose 가 넣어 준다. |
| `DATABASE_POOL_MAX` | | 커넥션 풀 크기. 기본 10. |
| `APP_BASE_URL` | ○ | 공개 주소. 메일 링크와 OAuth 콜백이 여기서 나오고, `https://` 여야 세션 쿠키에 `Secure` 가 붙는다. |
| `SESSION_SECRET` | ○ | 세션 쿠키 서명. 32자 이상. 바꾸면 모두 로그아웃된다. |
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
| `UPLOAD_DIR` | | 첨부를 쓰는 곳. compose 는 `./data/uploads` 를 붙인다. |
| `CRON_KEY` | ○ | `/api/cron/*` 의 열쇠. 없으면 그 주소가 닫히고 예약된 것이 하나도 돌지 않는다. |
| `MOCK_MAIL` | | `1` 이면 보내는 대신 `tmp/mail/*.html` 로 떨어뜨린다. 개발 전용. |
| `POSTGRES_PASSWORD` `APP_PORT` | | `docker-compose.yml` 이 쓰는 값. |

앱은 시작할 때 이 값들을 살펴보고 빠졌거나 수상한 것을 `[setup]` 줄로 남긴다. 처음 띄운 뒤
로그를 한 번 읽어 보자.

## 리버스 프록시 뒤에서

HTTPS 는 앞에서 끊고, 원래 호스트와 스킴을 넘겨 준다. Caddy:

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
`APP_BASE_URL` 이 사람들이 실제로 치는 주소와 같은지 확인한다 — 서버 액션은 다른 출처의 요청을
거절한다.

## 예약 작업

아무도 보고 있지 않을 때 해야 하는 일은 주소 두 개가 맡는다. 둘 다 `x-cron-key` 헤더를 붙인
`POST` 를 받고, `CRON_KEY` 가 없으면 `404` 로 닫힌다.

| 주소 | 주기 | 하는 일 |
|---|---|---|
| `/api/cron/tick` | 매시 | 미리 알림, 오늘 기한 알림, 각자 시간대의 아침 8시 요약, 다 쓴 링크 청소. |
| `/api/cron/sends` | 5분마다 | 예약해 둔 보고서 메일. |

`docker-compose.yml` 의 `cron` 컨테이너가 이미 이 일을 한다. 다른 방식으로 돌린다면 아무 스케줄러나
쓰면 된다.

```cron
*/5 * * * * curl -fsS -X POST -H "x-cron-key: $CRON_KEY" https://todo.example.com/api/cron/sends
0   * * * * curl -fsS -X POST -H "x-cron-key: $CRON_KEY" https://todo.example.com/api/cron/tick
```

## 업데이트

```bash
git pull
docker compose up -d --build
```

`migrate` 서비스가 앱보다 먼저 새 마이그레이션을 적용한다. 마이그레이션은 더하기만 한다 —
쓰고 있던 열을 지우지 않는다.

## 백업

상태를 가진 것은 둘뿐이다: 데이터베이스와 업로드 폴더.

```bash
docker compose exec -T db pg_dump -U todo todo | gzip > backup-$(date +%F).sql.gz
tar czf uploads-$(date +%F).tar.gz data/uploads
```

되돌릴 때는 빈 설치에서 `db` 만 먼저 띄우고 덤프를 `psql -U todo todo` 로 부은 뒤, 업로드를 풀고
앱을 시작한다.

## 개발

Node 24.7 이상(비밀번호 해시에 내장 `crypto.argon2` 를 쓴다).

```bash
npm install
npm run db:dev          # 로컬 PostgreSQL 을 띄우고 .env 에 넣을 주소를 찍는다
npm run db:migrate
npm run db:seed         # 가상 인물·목록·발행된 보고서
npm run dev
```

시드 계정의 비밀번호는 `open-todo-dev` 이고, `next dev` 로 띄우면 로그인 화면이 하나를 알려 준다.
시드는 운영에서 거부한다.

```bash
npm test                # vitest(DB 를 쓰는 시험 포함)
npx tsc --noEmit        # 타입
npm run lint
npm run check:i18n      # messages/ 밖에 화면 글이 없는지
npm run build
```

## 번역

화면에 보이는 글은 전부 `messages/<언어>/<묶음>.json` 에 있고, `ko` 와 `en` 이 기본으로 들어 있다.
언어를 더하려면 `messages/en` 을 `messages/<코드>` 로 복사해 값을 옮기고 `i18n/locales.ts` 에 코드를
더한다. 화면 글을 코드에 박으면 `npm run check:i18n` 이 막는다. 사람마다 *설정* 에서 언어를 고르고,
설치 기본값은 `DEFAULT_LOCALE` 이다.

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
- 문제를 찾았다면 [SECURITY.md](SECURITY.md).

## 기여

이슈와 PR 을 환영한다. 코드가 어떻게 놓여 있는지, 시험이 무엇을 기대하는지, 한국어·영어 문구가
따르는 용어집은 [CONTRIBUTING.md](CONTRIBUTING.md) 에 있다.

## 라이선스

[MIT](LICENSE). 함께 들어 있는 Pretendard 글꼴은 SIL Open Font License 를 따른다
([assets/fonts/Pretendard-LICENSE.txt](assets/fonts/Pretendard-LICENSE.txt)).
