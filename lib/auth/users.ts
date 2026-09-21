import { prisma } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma/client";
import { colorFor, ensureInbox } from "@/lib/auth/provision";
import { createSession } from "@/lib/session";
import { isLocale, type AppLocale } from "@/i18n/locales";
import { isValidTimeZone } from "@/lib/tz";
import { getUserPrefs } from "@/lib/prefs";
import { bootstrapEmail } from "@/lib/auth/instance";

/**
 * 사용자 만들기·로그인 마무리 — 이메일·Google·카카오·네이버 가입이 함께 쓴다.
 */

export const NAME_MAX = 50;

/** 이름 정리 — 앞뒤 공백을 떼고 가운데 공백은 하나로. 비었거나 너무 길면 null. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0 || [...name].length > NAME_MAX) return null;
  return name;
}

export type NewUser = {
  /** 소문자로 정리된 주소 */
  email: string;
  name: string;
  passwordHash?: string | null;
  /** 확인된 주소만 사용자로 만든다 — 확인한 시각 */
  emailVerifiedAt: Date;
  /** 가입할 때 보던 언어·브라우저 시간대를 처음 설정으로 둔다 */
  locale?: AppLocale | null;
  timeZone?: string | null;
};

/**
 * 첫 관리자 자리를 차지한다 — 아직 아무도 쓰지 않았을 때 한 번만 성공한다(원자적).
 * 두 사람이 동시에 가입해도 관리자는 한 명이다.
 */
async function claimFirstAdmin(email: string): Promise<boolean> {
  const only = bootstrapEmail();
  if (only && only !== email) return false;
  await prisma.instanceSettings.upsert({ where: { id: "singleton" }, create: {}, update: {} });
  const { count } = await prisma.instanceSettings.updateMany({
    where: { id: "singleton", setupCompletedAt: null },
    data: { setupCompletedAt: new Date() },
  });
  return count === 1;
}

/**
 * 사용자를 만들고 기본 목록을 준비한다. 같은 주소가 먼저 생겼으면(동시에 두 번 가입) null.
 * 아무도 없는 설치에서는 이 사람이 관리자가 된다.
 */
export async function createUser(input: NewUser): Promise<{ id: string } | null> {
  const settings: Record<string, string> = {};
  if (isLocale(input.locale)) settings.locale = input.locale;
  if (isValidTimeZone(input.timeZone)) settings.timeZone = input.timeZone;
  const first = (await prisma.user.count()) === 0 && (await claimFirstAdmin(input.email));
  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash ?? null,
        emailVerifiedAt: input.emailVerifiedAt,
        avatarColor: colorFor(input.email),
        role: first ? "ADMIN" : "USER",
        settings,
      },
      select: { id: true },
    });
    if (first) console.warn(`[setup] first administrator: ${input.email}`);
    await ensureInbox(user.id, input.locale ?? undefined);
    return user;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

/** 로그인 마무리 — 마지막 로그인 시각을 남기고 세션을 심는다. */
export async function completeSignIn(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await ensureInbox(userId, (await getUserPrefs(userId)).locale);
  await createSession(userId);
}
