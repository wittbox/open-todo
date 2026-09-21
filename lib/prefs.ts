import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { isLocale, LOCALE_COOKIE, negotiateLocale, type AppLocale } from "@/i18n/locales";
import { DEFAULT_TZ, isValidTimeZone } from "@/lib/tz";
import { todayDateOnly } from "@/lib/date";

/**
 * 언어·시간대 고르기 (서버 전용).
 *
 * 언어: 사용자 설정 → `NEXT_LOCALE` 쿠키 → 브라우저 `Accept-Language` → 설치 기본값(`DEFAULT_LOCALE`).
 * 시간대: 사용자 설정 → 설치 기본값(`APP_TZ`).
 * 둘 다 `User.settings` JSON 에 둔다(`{ locale, timeZone }`).
 */

export type Prefs = { locale: AppLocale; timeZone: string };

/** 설치 기본 언어. 잘못된 값이면 한국어. */
export function defaultLocale(): AppLocale {
  const v = process.env.DEFAULT_LOCALE;
  return isLocale(v) ? v : "ko";
}

/** 설치 기본 시간대. 잘못된 값이면 서울 — 조용히 UTC 로 떨어지면 날짜가 하루씩 밀린다. */
export function appTimeZone(): string {
  const v = process.env.APP_TZ;
  return isValidTimeZone(v) ? v : DEFAULT_TZ;
}

type SettingsJson = { locale?: unknown; timeZone?: unknown };

function fromSettings(settings: unknown): Partial<Prefs> {
  const s = (settings && typeof settings === "object" ? settings : {}) as SettingsJson;
  return {
    locale: isLocale(s.locale) ? s.locale : undefined,
    timeZone: isValidTimeZone(s.timeZone) ? s.timeZone : undefined,
  };
}

/** `User.settings` JSON → 언어·시간대. 빠졌거나 틀린 값은 설치 기본값. 이미 읽어 온 행에 쓴다. */
export function prefsFromSettings(settings: unknown): Prefs {
  const p = fromSettings(settings);
  return { locale: p.locale ?? defaultLocale(), timeZone: p.timeZone ?? appTimeZone() };
}

/**
 * 특정 사용자의 언어·시간대 — 요청 밖(cron 메일, 알림)에서 받는 사람 기준으로 쓸 때.
 */
export async function getUserPrefs(userId: string): Promise<Prefs> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  return prefsFromSettings(row?.settings);
}

/** 여러 사람의 언어·시간대를 한 번에. 없는 사람은 설치 기본값. */
export async function getUsersPrefs(userIds: string[]): Promise<Map<string, Prefs>> {
  const ids = [...new Set(userIds)];
  const rows = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, settings: true } })
    : [];
  const byId = new Map(rows.map((r) => [r.id, prefsFromSettings(r.settings)]));
  return new Map(ids.map((id) => [id, byId.get(id) ?? prefsFromSettings(null)]));
}

/**
 * 지금 요청의 언어·시간대. 요청마다 한 번만 읽는다(React cache).
 * 요청 밖(시험·스크립트)에서 불리면 설치 기본값을 준다.
 */
export const getRequestPrefs = cache(async (): Promise<Prefs> => {
  try {
    const userId = await getSessionUserId();
    const mine = userId ? fromSettings((await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } }))?.settings) : {};
    const jar = await cookies();
    const cookieLocale = jar.get(LOCALE_COOKIE)?.value;
    const locale =
      mine.locale ??
      (isLocale(cookieLocale) ? cookieLocale : null) ??
      negotiateLocale((await headers()).get("accept-language")) ??
      defaultLocale();
    return { locale, timeZone: mine.timeZone ?? appTimeZone() };
  } catch {
    return { locale: defaultLocale(), timeZone: appTimeZone() };
  }
});

/** 서버 코드에서 "지금 요청의 시간대" 만 필요할 때. */
export async function getRequestTimeZone(): Promise<string> {
  return (await getRequestPrefs()).timeZone;
}

/** 지금 요청한 사람의 오늘(날짜 전용 값). 나의 하루·반복 다음 회차처럼 "오늘" 이 사람마다 다른 곳에 쓴다. */
export async function requestToday(now: Date = new Date()): Promise<Date> {
  return todayDateOnly(now, await getRequestTimeZone());
}
