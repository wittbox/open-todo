# open-todo

A self-hosted task manager for small teams: shared lists and groups, a calendar, project
channels for conversation, and weekly reports that build themselves from the work you did.
Korean and English, per-person time zones. One install = one team; there is no tenancy,
no cloud account and nothing phones home.

Built with Next.js 16, React 19, Prisma 7 and PostgreSQL. MIT licensed.

[한국어 README](README.ko.md)

![The calendar view](docs/images/calendar.png)

## What you get

- **Tasks** — lists inside groups, steps, due dates, reminders, repeats, importance,
  attachments and notes. Share a list or a whole group with someone as viewer, editor or
  admin. Assign work and it shows up under *Assigned to me*.
- **Calendar** — everything with a due date, month by month, with public holidays. Drag a
  task to another day.
- **Projects** — a conversation channel per project, with threads, @mentions, files and
  unread marks. Projects can be open to everyone on the install or invite-only.
- **Weekly reports** — one click collects the week's work into *Done this week*, *In
  progress* and *Coming up*, grouped by list. Edit, publish (which freezes a snapshot),
  share the link, or send it by email as HTML plus a PDF — now or at a scheduled time.
- **Notifications** — reminders, due-today, assignments and mentions, plus an optional
  morning digest sent at 8am in each person's own time zone.
- **Sign-in** — email and password, and optionally Google. Kakao and NAVER are on the way.
- **Administration** — sign-up policy, invitation links, people (make admin, disable,
  issue a reset link), and the name of the install.

| Tasks and details | Weekly report |
|---|---|
| ![](docs/images/tasks.png) | ![](docs/images/report.png) |

## Quick start with Docker

You need Docker with the Compose plugin, and a machine you can reach on a URL.

```bash
git clone https://github.com/wittbox/open-todo.git
cd open-todo
cp .env.example .env
```

Fill in four values in `.env`:

```bash
POSTGRES_PASSWORD=   # openssl rand -hex 24
APP_BASE_URL=        # https://todo.example.com — the address people will type
SESSION_SECRET=      # openssl rand -hex 32
CRON_KEY=            # openssl rand -hex 32
```

Then:

```bash
docker compose up -d --build
```

Four containers come up: PostgreSQL, a one-off migration job, the app on port 3000, and a
small sidecar that knocks on the scheduled-job endpoints. Put an HTTPS reverse proxy in
front (see below) and open your address.

**Create the administrator account before anyone else can.** On an empty install the first
person to sign up becomes the administrator, and that door then closes for good. On a
server reachable from the internet, set `ADMIN_BOOTSTRAP_EMAIL=you@example.com` in `.env`
before you start it: only that address can claim the first account. While no administrator
exists, the server repeats a warning in its log.

After that, `/admin` decides who else may join:

- **Invite only** (the default) — administrators create invitation links.
- **Allowed email domains** — anyone who confirms an address at those domains can sign up.
- **Anyone** — open sign-up. People search then needs the full email address instead of a
  name fragment, so nobody can enumerate your users.

## Email

Sign-up confirmation, password reset, invitations, the morning digest and report mail all
go through SMTP. Any server works — your company's, Gmail with an app password, SES,
Mailgun, Postmark:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587                       # 465 = TLS from the first byte; others must do STARTTLS
SMTP_USER=todo@example.com
SMTP_PASS=…
MAIL_FROM="open-todo <todo@example.com>"
```

Check it with `npm run mail:test -- you@example.com` (or `docker compose exec app node
-e …` if you only have containers — the test script needs the dev dependencies, so it is
easiest to run from a clone).

Report mail is always sent **from** the install's address with the author's name as the
display name, and replies go to the author. Sending as the author's own address would fail
SPF and DMARC at the receiving end.

Without a mail server the app still runs: administrators hand invitation and password-reset
links over themselves, and the app says so on the screens where it matters. It will not
silently drop mail — in production, sending fails loudly instead.

## Sign in with Google

Optional. Google Auth Platform → create an app → OAuth client ID (web) → add the redirect URI
`{APP_BASE_URL}/auth/google/callback`. Put the two values in `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`; the button appears once both are set. While the app is in Google's
*testing* status only the test users you list can sign in — publish it for everyone else.

**Kakao and NAVER** are not available yet. The code for them is in the repository, but it
hasn't been through a real sign-in with either service, so it stays switched off: setting
their keys shows no button, and the server logs that at startup.

Provider tokens are used once and thrown away; nothing is stored. An existing account is
never linked automatically — sign in the old way first, then connect the provider in
*Settings*, so that nobody can take over an account by controlling an address at a
provider.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. Compose sets it for you. |
| `DATABASE_POOL_MAX` | | Connection pool size. Default 10. |
| `APP_BASE_URL` | yes | Public address. Email links and OAuth callbacks are built from it, and `https://` here is what turns on `Secure` session cookies. |
| `SESSION_SECRET` | yes | Signs session cookies. 32+ characters. Changing it signs everyone out. |
| `APP_NAME` | | What the install is called in titles and email. An administrator can also set it in `/admin`, which wins. Default `open-todo`. |
| `ADMIN_BOOTSTRAP_EMAIL` | | Restricts the first-administrator sign-up to one address. |
| `DEFAULT_LOCALE` | | `ko` or `en`, for people who haven't chosen. Default `ko`. |
| `APP_TZ` | | IANA time zone for people who haven't chosen, e.g. `Europe/Berlin`. Default `Asia/Seoul`. |
| `HOLIDAY_REGION` | | `kr` or `none`. Default `kr`. |
| `TRUST_PROXY` | | Number of reverse proxies in front (usually `1`). Only then is `X-Forwarded-For` trusted for rate limits. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | | Mail server. Without `SMTP_HOST`, production refuses to send. |
| `REPORT_MAIL_MAX_RECIPIENTS` | | Recipients per report send. Default 10. |
| `REPORT_MAIL_DAILY_LIMIT` | | Recipients per person per 24 hours. Default 100. |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` | | Sign in with Google. |
| `UPLOAD_DIR` | | Where attachments are written. Compose mounts `./data/uploads`. |
| `CRON_KEY` | yes | Key for `/api/cron/*`. Without it those endpoints stay closed and nothing scheduled runs. |
| `MOCK_MAIL` | | `1` writes mail to `tmp/mail/*.html` instead of sending. Development only. |
| `POSTGRES_PASSWORD` `APP_PORT` | | Used by `docker-compose.yml` itself. |

The app checks these when it starts and writes a `[setup]` line for anything missing or
suspicious — read the log once after your first boot.

## Behind a reverse proxy

Terminate HTTPS in front of the app and forward the original host and scheme. Caddy:

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

	client_max_body_size 25m;   # attachments

	location / {
		proxy_pass http://127.0.0.1:3000;
		proxy_set_header Host $host;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Host $host;
	}
}
```

Then set `TRUST_PROXY=1` so sign-in rate limits see the visitor's address rather than the
proxy's, and make sure `APP_BASE_URL` matches the address people actually type — server
actions reject requests from another origin.

## Scheduled jobs

Two endpoints do the work that has to happen while nobody is looking. Both want
`POST` with an `x-cron-key` header, and both answer `404` when `CRON_KEY` is unset:

| Endpoint | How often | What it does |
|---|---|---|
| `/api/cron/tick` | hourly | Reminders, due-today notifications, the 8am digest in each person's time zone, and cleaning up used links. |
| `/api/cron/sends` | every 5 minutes | Report mail that was scheduled for later. |

The `cron` container in `docker-compose.yml` already does this. If you run the app some
other way, any scheduler will do:

```cron
*/5 * * * * curl -fsS -X POST -H "x-cron-key: $CRON_KEY" https://todo.example.com/api/cron/sends
0   * * * * curl -fsS -X POST -H "x-cron-key: $CRON_KEY" https://todo.example.com/api/cron/tick
```

## Updating

```bash
git pull
docker compose up -d --build
```

The `migrate` service runs any new migrations before the app starts. Migrations only ever
add; none of them drop a column you were using.

## Backups

Two things hold state: the database and the uploads directory.

```bash
docker compose exec -T db pg_dump -U todo todo | gzip > backup-$(date +%F).sql.gz
tar czf uploads-$(date +%F).tar.gz data/uploads
```

To restore into an empty install, bring up `db`, pipe the dump into
`psql -U todo todo`, untar the uploads, then start the app.

## Local development

Node 24.7 or newer (password hashing uses the built-in `crypto.argon2`).

```bash
npm install
npm run db:dev          # starts a local PostgreSQL and prints a URL for .env
npm run db:migrate
npm run db:seed         # demo people, lists and a published report
npm run dev
```

The seed creates sign-ins with the password `open-todo-dev`; the login screen shows one of
them while `next dev` is running. Seeding refuses to run in production.

```bash
npm test                # vitest, including tests that use the database
npx tsc --noEmit        # types
npm run lint
npm run check:i18n      # no screen text outside messages/
npm run build
```

## Translations

Every string on screen lives in `messages/<locale>/<namespace>.json`; `ko` and `en` ship
with the app. To add a language, copy `messages/en` to `messages/<code>`, translate the
values, and add the code in `i18n/locales.ts`. `npm run check:i18n` fails the build if a
screen string is hard-coded instead. People pick their language in *Settings*; the install
default is `DEFAULT_LOCALE`.

## Security notes

- Serve it over HTTPS. Session cookies only get `Secure` and the `__Host-` prefix when
  `APP_BASE_URL` is `https://`.
- Passwords are argon2id (19 MiB, 2 passes) with the parameters stored alongside the hash,
  so they can be raised later; sessions carry a version that is checked against the
  database on every request, so a password change, a disabled account or *sign out
  everywhere* takes effect immediately.
- Sign-in, sign-up, password reset and mail sending are rate limited per address and per IP.
  The IP is only trusted when `TRUST_PROXY` says how many proxies are in front.
- Report mail can only be sent by people with a confirmed address, to a limited number of
  recipients per send and per day, so an install can't be turned into a spam relay.
- Invitation, confirmation and reset links are stored as SHA-256 hashes and are shown in
  full exactly once.
- Found something? See [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how the
project is laid out, what the tests expect, and the glossary the Korean and English strings
follow.

## License

[MIT](LICENSE). The bundled Pretendard font is licensed under the SIL Open Font License
([assets/fonts/Pretendard-LICENSE.txt](assets/fonts/Pretendard-LICENSE.txt)).
