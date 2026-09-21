# Security

## Reporting a vulnerability

Please **don't** open a public issue. Use GitHub's private reporting instead: the
repository's **Security** tab → **Report a vulnerability**. That opens a private thread with
the maintainers.

Tell us what an attacker can do and how you got there — a short proof of concept is worth
more than a scanner report. You'll get a first reply within a week. Fixes for anything that
lets someone read or change data they shouldn't go out as soon as they're ready, with the
issue described in the release notes. If you'd like credit, say so and how you want to be
named.

Please don't run scans or brute-force attempts against anyone else's install.

## What is in scope

This is software you run yourself, so the interesting boundary is what one install does
with its own users and data:

- Reading or changing tasks, lists, projects, files or reports you have no access to.
- Taking over an account: session handling, password reset, invitations, provider sign-in
  and account linking.
- Becoming an administrator without being made one, including the first-administrator
  window on a fresh install.
- Getting the app to send mail on your behalf, or to leak who else has an account.
- Stored or reflected XSS, CSRF on the route handlers, SQL injection, path traversal in
  attachment handling.

Out of scope: anything that needs an administrator to do it (administrators can already
manage people and links by design), missing hardening headers with no attack behind them,
findings that only apply because an install ignores the README — HTTP instead of HTTPS, a
guessable `SESSION_SECRET`, a `CRON_KEY` that was shared around — rate limits being
per-process, and reports from automated tools with no working exploit.

## What the app already does

Worth knowing before you dig, so you don't spend time on ground that's covered:

- Passwords: argon2id (19 MiB, 2 passes, 1 lane) via Node's built-in `crypto.argon2`, with
  the parameters stored in the PHC string so they can be raised later. Sign-in always does
  the same work whether or not the account exists.
- Sessions: a signed JWT carrying a version that is compared with the database on every
  request. Password change, reset, *sign out everywhere*, disabling an account and role
  changes all bump it, so old sessions die immediately. Cookies are `HttpOnly`, `SameSite=Lax`,
  and `Secure` with the `__Host-` prefix on an HTTPS install.
- One-time links (sign-up confirmation, password reset, invitations) are stored as SHA-256
  hashes, expire, and are shown in full exactly once.
- OAuth: `state` plus PKCE and a nonce where the provider supports it, ID token claims
  checked, provider tokens never stored, and an existing account is never linked
  automatically to a provider that happens to report the same address.
- Rate limits on sign-in, sign-up, password reset and outgoing mail, keyed by address and by
  IP. The IP comes from `X-Forwarded-For` only when `TRUST_PROXY` says how many proxies are
  in front, counted from the right.
- Route handlers check `Sec-Fetch-Site`/`Origin`; server actions are checked by Next itself.
- Report mail requires a confirmed address and is capped per send and per day, so an install
  can't be used as a relay.
- On an open-sign-up install, people search needs the full email address, so the user list
  can't be enumerated.

## Supported versions

Until 1.0, fixes land on the latest release and on `main`. Older tags aren't patched.
