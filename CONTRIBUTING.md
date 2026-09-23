# Contributing

Thanks for looking. This is a small project with a small surface — issues, translations and
focused pull requests are all welcome.

## Getting set up

Node 24.7 or newer (password hashing uses the built-in `crypto.argon2`), and a PostgreSQL
you can throw away.

```bash
npm install
npm run db:dev          # local PostgreSQL; prints a URL for .env
cp .env.example .env    # paste the URL into DATABASE_URL, add SESSION_SECRET
npm run db:migrate
npm run db:seed
npm run dev
```

Sign in with a seeded account (the login screen shows one) and the password
`open-todo-dev`. `MOCK_MAIL=1` writes every outgoing mail to `tmp/mail/*.html` instead of
sending it, which is what you want while working on sign-up or report mail.

## Before you open a pull request

```bash
npx tsc --noEmit
npm run lint
npm run check:i18n
npm test
npm run build
```

CI runs the same five, plus a check that the migrations still match `schema.prisma`, and it
builds the container image and starts it: the image has to come up healthy on an empty
volume, apply its migrations, survive a stop and start with the data intact, and refuse a
cluster from another PostgreSQL major. That job is the only place the image is exercised, so
read its log when you touch `Dockerfile` or `docker/entrypoint.mts`.

Tests that touch the database run against `DATABASE_URL`; they create and delete their own
rows, so point them at a development database, never a real one. The parts of the container
entrypoint that can be tested without Docker are pure functions — see
`tests/entrypoint.test.ts`.

## How the code is laid out

| Path | What lives there |
|---|---|
| `app/` | Routes. `(app)` is the signed-in shell, `(auth)` the sign-in screens, `api/` the route handlers. |
| `components/` | Screens and widgets. Client components say `"use client"` at the top. |
| `lib/queries/` | Reads. One function per screen, returning exactly what the screen needs. |
| `lib/actions/` | Writes (server actions). Every one starts by checking who is asking. |
| `lib/auth/` | Sessions, passwords, OAuth providers, invitations, instance settings. |
| `lib/report/` | Weekly report aggregation, HTML mail, PDF, scheduled sends. |
| `messages/` | Every string on screen, per locale and namespace. |
| `prisma/` | Schema, migrations, seed. |
| `tests/` | vitest. `*.db.test.ts` needs the database; the rest don't. |

A few habits the code keeps to:

- **Permissions live next to the data.** A query returns what the person may see; an action
  refuses before it writes. Hiding a button is not a permission check.
- **Comments are in Korean, on purpose** — they explain *why* a piece of code is shaped the
  way it is. Operator-facing output (server logs, thrown `Error` messages) is in English.
- **Dates that have no time** are stored at UTC midnight and must be formatted with
  `timeZone: "UTC"` (`lib/format.ts`). Formatting them in the reader's zone moves them a day
  west of Greenwich.
- **Anything with a time** is formatted in the reader's own time zone, which comes from
  their settings (`lib/prefs.ts`), not from the server's clock.
- New behaviour comes with a test. Bug fixes come with the test that would have caught it.

## Screen text

Nothing user-facing is written in a `.tsx` file. Add the key to **both**
`messages/ko/<namespace>.json` and `messages/en/<namespace>.json`, then read it with
`useTranslations` (client), `getTranslations` (server component) or `translatorFor(locale)`
(cron, mail, action errors — anywhere there is no request). `npm run check:i18n` fails on
Korean text outside `messages/`.

Errors travel as keys, not sentences: `throw ActionError.key("tasks.errors.notFound")`, and
the screen translates it in the reader's language.

### Adding a language

Copy `messages/en` to `messages/<code>`, translate the values, add the code to
`i18n/locales.ts`, and the language shows up in *Settings*. Keys must match `ko` exactly —
a test checks that.

### Glossary

Keep these consistent; they appear in dozens of strings.

| English | 한국어 | Note |
|---|---|---|
| task | 작업 | The thing you tick off. |
| step | 세부 단계 | A checklist inside a task. |
| list | 목록 | |
| group | 그룹 | Holds lists. |
| project | 프로젝트 | The conversation space. |
| thread | 스레드 | A reply chain on a message. |
| weekly report | 주간보고서 | |
| publish | 발행 | Freezes a snapshot of a report. |
| due date | 기한 | |
| reminder | 미리 알림 | The alarm, not the due date. |
| assignee | 담당자 | |
| share | 공유 | Giving someone access to a list or group. |
| invite | 초대 | Bringing someone into the install or a project. |
| install | 설치 | This server. Not "workspace", not "tenant". |
| administrator | 관리자 | Never shortened to "admin" in screen text. |
| sign in / sign out | 로그인 / 로그아웃 | "Log in" never appears. |
| disable (a person) | 사용 중지 | People are never deleted. |

English strings use sentence case, no exclamation marks, and say what happened rather than
apologising for it. Korean strings use 해요체 and avoid 하십시오체.

## Commits and pull requests

Commit messages: a short line saying what changed, then a paragraph or two on *why* if it
isn't obvious. Prefixes like `feat:` / `fix:` / `docs:` are used but not enforced.

One topic per pull request. If you are changing behaviour people can see, say what it looks
like before and after; a screenshot helps.

## Reporting bugs

Open an issue with what you did, what you expected and what happened instead, plus the
version (a commit hash is fine), how it is deployed (Docker or not), and anything the server
log said. If it involves a date, a time zone or a language, say which ones — most of the
interesting bugs in this app live there.

Security problems don't go in the issue tracker: see [SECURITY.md](SECURITY.md).
