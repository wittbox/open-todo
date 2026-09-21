import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/email";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword, type PasswordProblem } from "@/lib/auth/password";
import { clearRateLimit, hitRateLimits, LIMITS } from "@/lib/auth/rate-limit";
import { consumeToken, issueToken, peekToken } from "@/lib/auth/tokens";
import { checkSignup } from "@/lib/auth/instance";
import { findInvitation, redeemInvitation } from "@/lib/auth/invitations";
import { cleanName, createUser } from "@/lib/auth/users";
import { accountExistsMail, resetPasswordMail, sendAfterResponse, verifyEmailMail } from "@/lib/mail/auth-mails";
import { appUrl } from "@/lib/app-url";
import type { AppLocale } from "@/i18n/locales";
import { PROVIDER_LABEL } from "@/lib/auth/oauth/config";

/**
 * 이메일·비밀번호 계정의 흐름 — 로그인, 가입, 가입 확인, 비밀번호 재설정.
 *
 * 쿠키·리다이렉트는 여기서 다루지 않는다(lib/actions/auth.ts). 그래서 요청 없이 시험할 수 있다.
 * 오류는 번역 열쇠(`auth.errors.<key>`)로 돌려준다.
 *
 * 지키는 것:
 * - 계정이 있는지 새지 않게 — 없는 계정 로그인도 비밀번호 확인만큼 일하고, 가입·재설정 요청은 계정이 있든 없든
 *   같은 답을 준다(메일은 응답 뒤에 보낸다).
 * - 확인된 이메일만 사용자가 된다 — 비밀번호 가입은 확인 링크를 누를 때 사용자를 만든다. 남의 주소를 선점할 수 없다.
 * - 메일 링크는 GET 으로 쓰지 않는다 — 메일 보안 검사기가 링크를 미리 열어 토큰을 태운다. 화면의 버튼(POST)으로 쓴다.
 */

export type AuthError =
  | "invalidEmail"
  | "invalidCredentials"
  | "tooManyAttempts"
  | "disabled"
  | "nameRequired"
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordCommon"
  | "passwordMismatch"
  | "signupClosed"
  | "domainNotAllowed"
  | "inviteInvalid"
  | "linkInvalid"
  | "accountExists";

export type AuthFailure = { ok: false; error: AuthError; retryAfterSec?: number; domains?: string[] };
export type AuthResult<T extends object = object> = ({ ok: true } & T) | AuthFailure;

const fail = (error: AuthError, extra: Omit<AuthFailure, "ok" | "error"> = {}): AuthFailure => ({ ok: false, error, ...extra });

const PASSWORD_ERRORS: Record<PasswordProblem, AuthError> = {
  tooShort: "passwordTooShort",
  tooLong: "passwordTooLong",
  common: "passwordCommon",
};

function limited(rules: { key: string; limit: number; windowMs: number }[]): AuthFailure | null {
  const r = hitRateLimits(rules);
  return r.ok ? null : fail("tooManyAttempts", { retryAfterSec: r.retryAfterSec });
}

const ipRule = (ip: string | null, prefix: string, rule: { limit: number; windowMs: number }) =>
  ip ? [{ key: `${prefix}:ip:${ip}`, ...rule }] : [];

const mailRules = (email: string) => [
  { key: `mail:min:${email}`, ...LIMITS.mailPerMinute },
  { key: `mail:hour:${email}`, ...LIMITS.mailPerHour },
];

/* ── 로그인 ─────────────────────────────────────────────── */

export async function loginWithPassword(input: {
  email: unknown;
  password: unknown;
  ip: string | null;
}): Promise<AuthResult<{ userId: string }>> {
  const password = typeof input.password === "string" ? input.password : "";
  const email = normalizeEmail(input.email);
  if (!email) {
    await burnPasswordCheck(password);
    return fail("invalidCredentials");
  }

  const tooMany = limited([
    ...ipRule(input.ip, "login", LIMITS.loginIp),
    { key: `login:email:${email}`, ...LIMITS.loginEmail },
  ]);
  if (tooMany) return tooMany;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, disabledAt: true },
  });
  const check = await verifyPassword(user?.passwordHash, password);
  if (!user || !check.ok) return fail("invalidCredentials");
  // 비밀번호가 맞은 뒤에만 알린다 — 그 전에 알리면 계정이 있다는 것이 샌다.
  if (user.disabledAt) return fail("disabled");

  clearRateLimit(`login:email:${email}`);
  if (check.needsRehash) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }
  return { ok: true, userId: user.id };
}

/* ── 가입 ───────────────────────────────────────────────── */

/** 확인 링크(VERIFY_EMAIL)에 담아 두는 가입 정보. 링크를 누를 때 사용자가 된다. */
type PendingSignup = {
  kind: "signup";
  name: string;
  passwordHash: string;
  invitationId: string | null;
  locale: AppLocale;
  timeZone: string | null;
};

/**
 * 이메일·비밀번호로 가입을 시작한다.
 *
 * - 초대에 주소가 정해져 있고 그 주소로 가입하면 곧바로 사용자가 된다(초대 링크를 받은 것이 확인이다) → `userId`.
 * - 그 밖에는 확인 메일을 보낸다 → `sentTo`. 이미 있는 주소면 가입 대신 "이미 계정이 있습니다" 메일을 보내고
 *   화면은 똑같이 "메일을 확인하세요" 를 보인다.
 */
export async function startPasswordSignup(input: {
  email: unknown;
  name: unknown;
  password: unknown;
  inviteToken?: unknown;
  ip: string | null;
  locale: AppLocale;
  timeZone?: string | null;
}): Promise<AuthResult<{ userId?: string; sentTo?: string }>> {
  const email = normalizeEmail(input.email);
  if (!email) return fail("invalidEmail");
  const name = cleanName(input.name);
  if (!name) return fail("nameRequired");
  const password = typeof input.password === "string" ? input.password : "";
  const problem = await passwordProblem(password, email);
  if (problem) return fail(PASSWORD_ERRORS[problem]);

  const tooMany = limited([...ipRule(input.ip, "signup", LIMITS.signupIp), ...mailRules(email)]);
  if (tooMany) return tooMany;

  const invitation = input.inviteToken ? await findInvitation(input.inviteToken) : null;
  if (input.inviteToken && !invitation) return fail("inviteInvalid");
  if (invitation?.email && invitation.email !== email) return fail("inviteInvalid");
  if (!invitation) {
    // 초대 없이 가입: 정책을 지금 한 번(빠른 안내), 확인 링크를 누를 때 한 번 더 본다.
    const open = await checkSignup(email);
    if (!open.ok) return fail(open.reason, { domains: open.domains });
  }

  // 해시는 계정이 있든 없든 만든다 — 두 갈래의 응답 시간을 같게.
  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await sendAfterResponse(email, await accountExistsMail(input.locale, appUrl("/login")), existing.id);
    return { ok: true, sentTo: email };
  }

  // 주소가 정해진 초대로 그 주소 그대로 가입 — 확인 메일 없이 바로.
  if (invitation?.email) {
    const user = await createUser({
      email,
      name,
      passwordHash,
      emailVerifiedAt: new Date(),
      locale: input.locale,
      timeZone: input.timeZone,
    });
    if (!user) return fail("inviteInvalid");
    if (!(await redeemInvitation(invitation.id, user.id))) {
      // 그 사이 초대가 쓰였거나 만료됐다 — 만든 사람을 되돌린다.
      await prisma.user.delete({ where: { id: user.id } });
      return fail("inviteInvalid");
    }
    return { ok: true, userId: user.id };
  }

  const data: PendingSignup = {
    kind: "signup",
    name,
    passwordHash,
    invitationId: invitation?.id ?? null,
    locale: input.locale,
    timeZone: input.timeZone ?? null,
  };
  const token = await issueToken({ purpose: "VERIFY_EMAIL", email, data });
  await sendAfterResponse(email, await verifyEmailMail(input.locale, name, appUrl(`/auth/verify?token=${token}`)));
  return { ok: true, sentTo: email };
}

/** 확인 메일을 다시 보낸다 — 아직 누르지 않은 가입이 있을 때만. 없어도 같은 답. */
export async function resendSignupEmail(input: { email: unknown; ip: string | null; locale: AppLocale }): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  if (!email) return fail("invalidEmail");
  const tooMany = limited([...ipRule(input.ip, "mail", LIMITS.mailIp), ...mailRules(email)]);
  if (tooMany) return tooMany;

  const pending = await prisma.verificationToken.findFirst({
    where: { purpose: "VERIFY_EMAIL", email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { data: true },
  });
  const data = pending?.data as PendingSignup | null | undefined;
  if (data?.kind === "signup") {
    const token = await issueToken({ purpose: "VERIFY_EMAIL", email, data });
    await sendAfterResponse(email, await verifyEmailMail(input.locale, data.name, appUrl(`/auth/verify?token=${token}`)));
  }
  return { ok: true };
}

/**
 * 확인 링크를 누른 뒤 — 사용자를 만든다. 그 사이 같은 주소의 계정이 생겼으면(다른 길로 가입) 그 계정으로 들어간다.
 * 링크가 주소를 가진 사람에게만 가므로, 누른 사람이 그 주소의 주인이다.
 */
export async function completeSignup(token: unknown): Promise<AuthResult<{ userId: string }>> {
  const used = await consumeToken("VERIFY_EMAIL", token);
  const data = used?.data as PendingSignup | null | undefined;
  if (!used || data?.kind !== "signup") return fail("linkInvalid");

  const existing = await prisma.user.findUnique({ where: { email: used.email }, select: { id: true, disabledAt: true } });
  if (existing) return existing.disabledAt ? fail("disabled") : { ok: true, userId: existing.id };

  if (!data.invitationId) {
    // 관리자가 그 사이 가입을 닫았을 수 있다.
    const open = await checkSignup(used.email);
    if (!open.ok) return fail(open.reason, { domains: open.domains });
  }
  const user = await createUser({
    email: used.email,
    name: data.name,
    passwordHash: data.passwordHash,
    emailVerifiedAt: new Date(),
    locale: data.locale,
    timeZone: data.timeZone,
  });
  if (!user) {
    const raced = await prisma.user.findUniqueOrThrow({ where: { email: used.email }, select: { id: true } });
    return { ok: true, userId: raced.id };
  }
  if (data.invitationId && !(await redeemInvitation(data.invitationId, user.id))) {
    await prisma.user.delete({ where: { id: user.id } });
    return fail("inviteInvalid");
  }
  return { ok: true, userId: user.id };
}

/* ── 비밀번호 재설정 ───────────────────────────────────── */

/** 재설정 링크를 보낸다. 계정이 없어도(또는 사용 중지여도) 같은 답. */
export async function requestPasswordReset(input: { email: unknown; ip: string | null; locale: AppLocale }): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  if (!email) return fail("invalidEmail");
  const tooMany = limited([...ipRule(input.ip, "mail", LIMITS.mailIp), ...mailRules(email)]);
  if (tooMany) return tooMany;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, disabledAt: true, accounts: { select: { provider: true } } },
  });
  if (user && !user.disabledAt) {
    const token = await issueToken({ purpose: "RESET_PASSWORD", email, userId: user.id });
    const providers = user.accounts.map((a) => PROVIDER_LABEL[a.provider]);
    await sendAfterResponse(email, await resetPasswordMail(input.locale, appUrl(`/reset-password?token=${token}`), providers), user.id);
  }
  return { ok: true };
}

/** 재설정 화면을 그릴 때 — 링크가 살아 있으면 그 주소. */
export async function resetLinkEmail(token: unknown): Promise<string | null> {
  return (await peekToken("RESET_PASSWORD", token))?.email ?? null;
}

/**
 * 새 비밀번호를 정한다. 그 사람의 모든 세션이 끊긴다(부르는 쪽이 이 브라우저에 새 세션을 심는다).
 * 링크를 받은 것이 이메일 확인이기도 하다.
 */
export async function resetPassword(input: {
  token: unknown;
  password: unknown;
  confirm: unknown;
}): Promise<AuthResult<{ userId: string }>> {
  const password = typeof input.password === "string" ? input.password : "";
  if (password !== input.confirm) return fail("passwordMismatch");
  const peek = await peekToken("RESET_PASSWORD", input.token);
  if (!peek?.userId) return fail("linkInvalid");
  // 규칙을 먼저 본다 — 틀린 비밀번호로 링크를 태우지 않게.
  const problem = await passwordProblem(password, peek.email);
  if (problem) return fail(PASSWORD_ERRORS[problem]);

  const used = await consumeToken("RESET_PASSWORD", input.token);
  if (!used?.userId) return fail("linkInvalid");
  const user = await prisma.user.findUnique({ where: { id: used.userId }, select: { disabledAt: true, emailVerifiedAt: true } });
  if (!user) return fail("linkInvalid");
  if (user.disabledAt) return fail("disabled");

  await prisma.user.update({
    where: { id: used.userId },
    data: {
      passwordHash: await hashPassword(password),
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      sessionVersion: { increment: 1 },
    },
  });
  // 같은 사람에게 나간 다른 재설정 링크도 함께 무효로.
  await prisma.verificationToken.updateMany({
    where: { purpose: "RESET_PASSWORD", userId: used.userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return { ok: true, userId: used.userId };
}
