"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clientIp, internalPath } from "@/lib/http";
import { HOME_PATH } from "@/lib/home";
import { getRequestPrefs } from "@/lib/prefs";
import { getSessionUserId } from "@/lib/session";
import { completeSignIn } from "@/lib/auth/users";
import {
  completeSignup,
  loginWithPassword,
  requestPasswordReset,
  resendSignupEmail,
  resetPassword,
  startPasswordSignup,
  type AuthFailure,
} from "@/lib/auth/flows";
import { completeOAuthSignup, startOAuthEmailSignup } from "@/lib/auth/oauth/resolve";
import { PENDING_COOKIE, readPending } from "@/lib/auth/oauth/tx";
import { translatorFor } from "@/i18n/server";
import { isLocale, LOCALE_COOKIE, type AppLocale } from "@/i18n/locales";

/**
 * 로그인·가입·재설정 화면의 서버 액션. 판단은 lib/auth/flows.ts 가 하고, 여기서는 폼을 읽고
 * 세션을 심고 보낼 곳을 정한다. 폼 상태는 useActionState 로 돌려준다.
 *
 * 서버 액션은 Next 가 Origin 을 확인한다(다른 사이트의 폼이 로그인시키지 못한다).
 */

export type AuthFormState = {
  error?: string;
  /** 확인 메일을 보낸 주소 */
  sentTo?: string;
  /** 요청을 받았다(재설정 링크·다시 보내기) */
  done?: boolean;
  /** 적었던 값 — 액션이 끝나면 React 가 폼을 비우므로 다시 채워 준다(비밀번호는 돌려주지 않는다) */
  fields?: { email?: string; name?: string };
} | null;

async function context(): Promise<{ ip: string | null; locale: AppLocale }> {
  return { ip: clientIp(await headers()), locale: (await getRequestPrefs()).locale };
}

function errorText(locale: AppLocale, f: AuthFailure): string {
  const t = translatorFor(locale);
  switch (f.error) {
    case "tooManyAttempts":
      return t("auth.errors.tooManyAttempts", { minutes: Math.max(1, Math.ceil((f.retryAfterSec ?? 60) / 60)) });
    case "domainNotAllowed":
      return t("auth.errors.domainNotAllowed", { domains: (f.domains ?? []).join(", ") });
    default:
      return t(`auth.errors.${f.error}`);
  }
}

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

export async function loginAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { ip, locale } = await context();
  const res = await loginWithPassword({ email: field(form, "email"), password: field(form, "password"), ip });
  if (!res.ok) return { error: errorText(locale, res), fields: { email: field(form, "email") } };
  await completeSignIn(res.userId);
  redirect(internalPath(field(form, "returnTo") || HOME_PATH));
}

export async function signupAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { ip, locale } = await context();
  const res = await startPasswordSignup({
    email: field(form, "email"),
    name: field(form, "name"),
    password: field(form, "password"),
    inviteToken: field(form, "invite") || undefined,
    timeZone: field(form, "timeZone") || null,
    ip,
    locale,
  });
  if (!res.ok) return { error: errorText(locale, res), fields: { email: field(form, "email"), name: field(form, "name") } };
  if (res.userId) {
    await completeSignIn(res.userId);
    redirect(HOME_PATH);
  }
  return { sentTo: res.sentTo };
}

export async function resendSignupAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { ip, locale } = await context();
  const res = await resendSignupEmail({ email: field(form, "email"), ip, locale });
  return res.ok ? { done: true } : { error: errorText(locale, res) };
}

export async function verifySignupAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { locale } = await context();
  // 비밀번호 가입의 확인 링크인지, 제공자 가입의 확인 링크인지는 화면이 토큰을 보고 알려 준다(틀리면 링크가 안 맞을 뿐).
  const token = field(form, "token");
  const res = field(form, "kind") === "oauth" ? await completeOAuthSignup(token) : await completeSignup(token);
  if (!res.ok) return { error: errorText(locale, res) };
  await completeSignIn(res.userId);
  redirect(HOME_PATH);
}

/** 이메일을 확인해 주지 않는 제공자로 처음 온 사람 — 적은 주소로 확인 링크를 보낸다. */
export async function oauthEmailAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { ip, locale } = await context();
  const fields = { email: field(form, "email"), name: field(form, "name") };
  const pending = await readPending((await cookies()).get(PENDING_COOKIE)?.value);
  if (!pending) return { error: translatorFor(locale)("auth.oauthEmail.expired"), fields };
  const res = await startOAuthEmailSignup({ pending, ...fields, ip, locale, timeZone: field(form, "timeZone") || null });
  if (!res.ok) return { error: errorText(locale, res), fields };
  return { sentTo: res.sentTo, fields };
}

export async function forgotPasswordAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { ip, locale } = await context();
  const res = await requestPasswordReset({ email: field(form, "email"), ip, locale });
  const fields = { email: field(form, "email") };
  return res.ok ? { done: true, fields } : { error: errorText(locale, res), fields };
}

export async function resetPasswordAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { locale } = await context();
  const res = await resetPassword({
    token: field(form, "token"),
    password: field(form, "password"),
    confirm: field(form, "confirm"),
  });
  if (!res.ok) return { error: errorText(locale, res) };
  // 세션 번호가 올라가 다른 기기는 모두 끊겼다. 이 브라우저에는 새 번호로 심는다.
  await completeSignIn(res.userId);
  redirect(HOME_PATH);
}

/**
 * 화면 언어 바꾸기 — 로그인 전에도 쓴다. 쿠키에 남기고, 로그인했으면 그 사람 설정에도 적는다
 * (메일·알림을 그 언어로 보내려면 설정에 있어야 한다).
 */
export async function setLocaleAction(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const userId = await getSessionUserId();
  if (!userId) return;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const settings = row?.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
  await prisma.user.update({ where: { id: userId }, data: { settings: { ...settings, locale } } });
}
