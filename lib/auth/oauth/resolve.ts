import { prisma } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma/client";
import type { AuthProvider } from "@/app/generated/prisma/enums";
import { normalizeEmail } from "@/lib/auth/email";
import { checkSignup, signupScreenOpen } from "@/lib/auth/instance";
import { findInvitation, redeemInvitation, type InvitationView } from "@/lib/auth/invitations";
import { cleanName, createUser } from "@/lib/auth/users";
import { consumeToken, issueToken } from "@/lib/auth/tokens";
import { hitRateLimits, LIMITS } from "@/lib/auth/rate-limit";
import { accountExistsMail, sendAfterResponse, verifyEmailMail } from "@/lib/mail/auth-mails";
import { appUrl } from "@/lib/app-url";
import type { AuthResult } from "@/lib/auth/flows";
import type { AppLocale } from "@/i18n/locales";
import type { ProviderProfile } from "@/lib/auth/oauth/types";
import type { OAuthPending, OAuthTx } from "@/lib/auth/oauth/tx";

/**
 * 제공자에서 돌아온 사람을 어디로 보낼지 — 연결 규칙.
 *
 * 1. 이미 연결된 (제공자, 계정) → 그 사람으로 로그인
 * 2. 로그인한 사람이 설정에서 시작한 "연결" → 지금 세션의 사람에게 붙인다(남에게 붙은 계정이면 거절)
 * 3. 처음 보는 제공자 계정 + 제공자가 **확인해 준** 이메일
 *    - 같은 이메일의 사용자가 이미 있으면 **자동으로 잇지 않는다** — 남의 주소로 만든 제공자 계정으로
 *      기존 계정을 가로채는 길이 된다. "원래 방법으로 로그인한 뒤 설정에서 연결하세요".
 *    - 없으면 가입 정책(또는 초대)을 보고 사용자를 만든다.
 * 4. 이메일이 확인되지 않았다(네이버, 비즈 앱이 아닌 카카오) → 이메일을 적게 하고 확인 링크를 누를 때 사용자를 만든다.
 *
 * 쿠키·리다이렉트는 여기서 다루지 않는다(app/auth/[provider]/callback). 그래서 요청 없이 시험할 수 있다.
 */

export type OAuthNotice =
  | "oauthFailed"
  | "oauthExists"
  | "accountInUse"
  | "alreadyLinked"
  | "disabled"
  | "signupClosed"
  | "domainNotAllowed"
  | "inviteInvalid";

export type OAuthOutcome =
  | { kind: "signIn"; userId: string }
  | { kind: "linked"; userId: string }
  | { kind: "needEmail"; pending: OAuthPending }
  | { kind: "notice"; notice: OAuthNotice; domains?: string[] };

const notice = (n: OAuthNotice, domains?: string[]): OAuthOutcome => ({ kind: "notice", notice: n, ...(domains?.length ? { domains } : {}) });

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function linkAccount(userId: string, provider: AuthProvider, profile: ProviderProfile): Promise<boolean> {
  try {
    await prisma.account.create({
      data: {
        userId,
        provider,
        providerAccountId: profile.providerAccountId,
        email: normalizeEmail(profile.email),
        lastUsedAt: new Date(),
      },
    });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

/** 사용자를 만들고 제공자 계정을 붙인다. 그 사이 같은 제공자 계정이 먼저 붙었으면 만든 사람을 되돌리고 그쪽으로. */
async function createLinkedUser(input: {
  email: string;
  name: string;
  provider: AuthProvider;
  profile: ProviderProfile;
  invitation: InvitationView | null;
  locale: AppLocale;
  timeZone?: string | null;
}): Promise<OAuthOutcome> {
  const user = await createUser({ email: input.email, name: input.name, emailVerifiedAt: new Date(), locale: input.locale, timeZone: input.timeZone });
  if (!user) return notice("oauthExists");
  if (!(await linkAccount(user.id, input.provider, input.profile))) {
    await prisma.user.delete({ where: { id: user.id } });
    return notice("accountInUse");
  }
  if (input.invitation && !(await redeemInvitation(input.invitation.id, user.id))) {
    await prisma.user.delete({ where: { id: user.id } });
    return notice("inviteInvalid");
  }
  return { kind: "signIn", userId: user.id };
}

export async function resolveOAuth(input: {
  provider: AuthProvider;
  profile: ProviderProfile;
  tx: OAuthTx;
  /** 콜백 시점의 세션 사용자 */
  sessionUserId: string | null;
  locale: AppLocale;
}): Promise<OAuthOutcome> {
  const { provider, profile, tx } = input;
  const existing = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId } },
    select: { id: true, userId: true, user: { select: { disabledAt: true } } },
  });

  // 2. 설정에서 시작한 연결
  if (tx.intent === "link") {
    if (!input.sessionUserId || input.sessionUserId !== tx.linkUserId) return notice("oauthFailed");
    if (existing) return existing.userId === input.sessionUserId ? { kind: "linked", userId: existing.userId } : notice("accountInUse");
    const already = await prisma.account.findUnique({ where: { userId_provider: { userId: input.sessionUserId, provider } }, select: { id: true } });
    if (already) return notice("alreadyLinked");
    return (await linkAccount(input.sessionUserId, provider, profile))
      ? { kind: "linked", userId: input.sessionUserId }
      : notice("accountInUse");
  }

  // 1. 이미 연결된 계정
  if (existing) {
    if (existing.user.disabledAt) return notice("disabled");
    await prisma.account.update({ where: { id: existing.id }, data: { lastUsedAt: new Date() } });
    return { kind: "signIn", userId: existing.userId };
  }

  // 3·4. 처음 보는 제공자 계정 — 가입
  const invitation = tx.invite ? await findInvitation(tx.invite) : null;
  if (tx.invite && !invitation) return notice("inviteInvalid");
  const verifiedEmail = profile.emailVerified ? normalizeEmail(profile.email) : null;

  if (verifiedEmail && !(invitation?.email && invitation.email !== verifiedEmail)) {
    if (await prisma.user.findUnique({ where: { email: verifiedEmail }, select: { id: true } })) return notice("oauthExists");
    if (!invitation) {
      const open = await checkSignup(verifiedEmail);
      if (!open.ok) return notice(open.reason, open.domains);
    }
    const name = cleanName(profile.name) ?? cleanName(verifiedEmail.slice(0, verifiedEmail.indexOf("@"))) ?? verifiedEmail;
    return createLinkedUser({ email: verifiedEmail, name, provider, profile, invitation, locale: input.locale });
  }

  // 4. 확인된 주소가 없다(또는 초대 주소와 다르다) — 가입할 길이 있을 때만 이메일을 묻는다.
  if (!invitation && !(await signupScreenOpen())) return notice("signupClosed");
  return {
    kind: "needEmail",
    pending: {
      provider,
      providerAccountId: profile.providerAccountId,
      name: cleanName(profile.name),
      suggestedEmail: invitation?.email ?? normalizeEmail(profile.email),
      ...(tx.invite ? { invite: tx.invite } : {}),
    },
  };
}

/* ── 이메일을 적어 가입(확인 링크) ─────────────────────── */

type PendingOAuthSignup = {
  kind: "oauth";
  provider: AuthProvider;
  providerAccountId: string;
  name: string;
  invitationId: string | null;
  locale: AppLocale;
  timeZone: string | null;
};

/**
 * 이메일을 확인해 주지 않는 제공자로 처음 온 사람 — 적은 주소로 확인 링크를 보낸다.
 * 이미 있는 주소면 링크 대신 "이미 계정이 있습니다" 메일(화면은 같다). 자동 연결은 하지 않는다.
 */
export async function startOAuthEmailSignup(input: {
  pending: OAuthPending;
  email: unknown;
  name: unknown;
  ip: string | null;
  locale: AppLocale;
  timeZone?: string | null;
}): Promise<AuthResult<{ sentTo: string }>> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "invalidEmail" };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "nameRequired" };

  const r = hitRateLimits([
    ...(input.ip ? [{ key: `mail:ip:${input.ip}`, ...LIMITS.mailIp }] : []),
    { key: `mail:min:${email}`, ...LIMITS.mailPerMinute },
    { key: `mail:hour:${email}`, ...LIMITS.mailPerHour },
  ]);
  if (!r.ok) return { ok: false, error: "tooManyAttempts", retryAfterSec: r.retryAfterSec };

  const invitation = input.pending.invite ? await findInvitation(input.pending.invite) : null;
  if (input.pending.invite && (!invitation || (invitation.email && invitation.email !== email))) return { ok: false, error: "inviteInvalid" };
  if (!invitation) {
    const open = await checkSignup(email);
    if (!open.ok) return { ok: false, error: open.reason, domains: open.domains };
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await sendAfterResponse(email, await accountExistsMail(input.locale, appUrl("/login")), existing.id);
    return { ok: true, sentTo: email };
  }

  const data: PendingOAuthSignup = {
    kind: "oauth",
    provider: input.pending.provider,
    providerAccountId: input.pending.providerAccountId,
    name,
    invitationId: invitation?.id ?? null,
    locale: input.locale,
    timeZone: input.timeZone ?? null,
  };
  const token = await issueToken({ purpose: "OAUTH_SIGNUP", email, data });
  await sendAfterResponse(email, await verifyEmailMail(input.locale, name, appUrl(`/auth/verify?token=${token}`)));
  return { ok: true, sentTo: email };
}

/**
 * 확인 링크를 누른 뒤 — 사용자를 만들고 제공자 계정을 붙인다.
 *
 * 그 사이 같은 주소의 사용자가 생겼으면 **붙이지 않는다**. 누른 사람이 주소의 주인이어도, 제공자 계정은
 * 링크를 요청한 다른 사람의 것일 수 있다(남의 네이버 계정이 내 계정에 붙는 길).
 */
export async function completeOAuthSignup(token: unknown): Promise<AuthResult<{ userId: string }>> {
  const used = await consumeToken("OAUTH_SIGNUP", token);
  const data = used?.data as PendingOAuthSignup | null | undefined;
  if (!used || data?.kind !== "oauth") return { ok: false, error: "linkInvalid" };

  const linked = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: data.provider, providerAccountId: data.providerAccountId } },
    select: { userId: true, user: { select: { email: true, disabledAt: true } } },
  });
  if (linked) {
    if (linked.user.email !== used.email) return { ok: false, error: "linkInvalid" };
    return linked.user.disabledAt ? { ok: false, error: "disabled" } : { ok: true, userId: linked.userId };
  }
  if (await prisma.user.findUnique({ where: { email: used.email }, select: { id: true } })) {
    return { ok: false, error: "accountExists" };
  }

  const invitation = data.invitationId
    ? { id: data.invitationId, email: null, expiresAt: new Date(), inviterName: null }
    : null;
  if (!invitation) {
    const open = await checkSignup(used.email);
    if (!open.ok) return { ok: false, error: open.reason, domains: open.domains };
  }
  const outcome = await createLinkedUser({
    email: used.email,
    name: data.name,
    provider: data.provider,
    profile: { providerAccountId: data.providerAccountId, email: used.email, emailVerified: true, name: data.name },
    invitation,
    locale: data.locale,
    timeZone: data.timeZone,
  });
  if (outcome.kind === "signIn") return { ok: true, userId: outcome.userId };
  return { ok: false, error: outcome.kind === "notice" && outcome.notice === "inviteInvalid" ? "inviteInvalid" : "linkInvalid" };
}
