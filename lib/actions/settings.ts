"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { AuthProvider } from "@/app/generated/prisma/enums";
import { ActionError, run, type ActionResult } from "@/lib/actions/_helpers";
import { requireUserId, revokeSessions } from "@/lib/session";
import { cleanName } from "@/lib/auth/users";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { isLocale, LOCALE_COOKIE } from "@/i18n/locales";
import { isValidTimeZone } from "@/lib/tz";

/**
 * 내 설정 — 언어·시간대·소속·아침 요약 메일, 비밀번호, 연결된 계정, 모든 기기에서 로그아웃.
 *
 * 비밀번호를 바꾸거나 계정 연결을 풀면 다른 기기의 세션이 끊긴다. 지금 쓰는 창은 그대로 둔다.
 */

const DEPARTMENT_MAX = 50;

export async function saveProfile(input: {
  name: string;
  department: string;
  locale: string;
  timeZone: string;
  dailyMail: boolean;
}): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const name = cleanName(input.name);
    if (!name) throw ActionError.key("auth.errors.nameRequired");
    if (!isLocale(input.locale)) throw ActionError.key("settings.errors.badLocale");
    if (!isValidTimeZone(input.timeZone)) throw ActionError.key("settings.errors.badTimeZone");
    const department = input.department.trim().slice(0, DEPARTMENT_MAX) || null;

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { settings: true } });
    const settings = row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
    await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        department,
        dailyMail: input.dailyMail,
        settings: { ...settings, locale: input.locale, timeZone: input.timeZone },
      },
    });
    // 로그인 전 화면도 같은 언어로 보이게 쿠키를 맞춰 둔다.
    (await cookies()).set(LOCALE_COOKIE, input.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    revalidatePath("/settings");
  });
}

/** 비밀번호 바꾸기(또는 외부 로그인만 쓰던 사람이 처음 만들기). 다른 기기는 모두 로그아웃된다. */
export async function changePassword(current: string, next: string, confirm: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, passwordHash: true } });

    if (user.passwordHash) {
      const check = await verifyPassword(user.passwordHash, current);
      if (!check.ok) throw ActionError.key("settings.errors.wrongPassword");
    }
    if (next !== confirm) throw ActionError.key("auth.errors.passwordMismatch");
    const problem = await passwordProblem(next, user.email);
    if (problem) {
      throw ActionError.key(
        problem === "tooShort" ? "auth.errors.passwordTooShort" : problem === "tooLong" ? "auth.errors.passwordTooLong" : "auth.errors.passwordCommon",
      );
    }

    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
    await revokeSessions(userId, { keepCurrent: true });
    revalidatePath("/settings");
  });
}

/** 연결된 계정 풀기. 마지막 로그인 방법은 풀 수 없다 — 들어올 길이 사라진다. */
export async function unlinkProvider(provider: AuthProvider): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, accounts: { select: { id: true, provider: true } } },
    });
    const account = user.accounts.find((a) => a.provider === provider);
    if (!account) throw ActionError.key("settings.errors.notLinked");
    const methodsLeft = (user.passwordHash ? 1 : 0) + user.accounts.length - 1;
    if (methodsLeft < 1) throw ActionError.key("settings.errors.lastMethod");

    await prisma.account.delete({ where: { id: account.id } });
    // 그 제공자로 열어 둔 다른 기기의 세션을 끊는다.
    await revokeSessions(userId, { keepCurrent: true });
    revalidatePath("/settings");
  });
}

export async function signOutEverywhere(): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await revokeSessions(userId, { keepCurrent: true });
    revalidatePath("/settings");
  });
}
