import { DEFAULT_TZ } from "@/lib/tz";

/**
 * 메시지 시각 표기. 사용자 시간대(`tz`) 기준이며, 브라우저의 시간대를 따르지 않는다
 * (lib/date.ts 와 같은 이유 — 서버와 화면이 같은 말을 해야 한다).
 *
 * 문구는 여기서 짓지 않는다. "오늘"·"방금" 같은 말은 `projects` 번역에서 받아 오고,
 * 달·요일 이름은 Intl 이 그 언어로 만든다 — 이 파일은 next-intl 을 부르지 않는다.
 */

/** `useTranslations("projects")` 처럼 열쇠와 값을 받아 문장을 돌려주는 것. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

const ymdFmts = new Map<string, Intl.DateTimeFormat>();
const hmFmts = new Map<string, Intl.DateTimeFormat>();
const dayNameFmts = new Map<string, Intl.DateTimeFormat>();

function ymdFmt(tz: string): Intl.DateTimeFormat {
  let f = ymdFmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    ymdFmts.set(tz, f);
  }
  return f;
}

function hmFmt(tz: string): Intl.DateTimeFormat {
  let f = hmFmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    hmFmts.set(tz, f);
  }
  return f;
}

/** 달·요일 이름은 언어가 정한다. 날짜 열쇠는 UTC 자정으로 세우므로 UTC 로 읽는다. */
function dayNameFmt(locale: string, withYear: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${withYear ? "y" : ""}`;
  let f = dayNameFmts.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      ...(withYear ? { year: "numeric" as const } : {}),
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    dayNameFmts.set(key, f);
  }
  return f;
}

/** "YYYY-MM-DD" (사용자 시간대) — 날짜 구분선의 묶음 열쇠 */
export function dayKeyOf(iso: string, tz: string = DEFAULT_TZ): string {
  return ymdFmt(tz).format(new Date(iso));
}

/** "09:03" */
export function timeOf(iso: string, tz: string = DEFAULT_TZ): string {
  return hmFmt(tz).format(new Date(iso)).replace(/^24:/, "00:");
}

function utcOf(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 두 날짜 열쇠 사이의 날수. 구분선과 상대 시각이 같은 셈을 쓴다. */
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((utcOf(toKey).getTime() - utcOf(fromKey).getTime()) / 86_400_000);
}

/** 구분선 문구: 오늘 / 어제 / "9월 16일 수요일" / 다른 해면 "2025년 12월 3일 수요일" */
export function dayLabel(dayKey: string, todayKey: string, t: Translate, locale: string = "ko"): string {
  if (dayKey === todayKey) return t("day.today");
  if (daysBetween(dayKey, todayKey) === 1) return t("day.yesterday");
  const date = utcOf(dayKey);
  const sameYear = date.getUTCFullYear() === utcOf(todayKey).getUTCFullYear();
  return dayNameFmt(locale, !sameYear).format(date);
}

/** 답글 꼬리·툴팁용 짧은 상대 시각 */
export function relativeShort(iso: string, now: Date, tz: string | undefined, t: Translate): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t("relative.justNow");
  if (min < 60) return t("relative.minutes", { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("relative.hours", { count: h });
  const todayKey = dayKeyOf(now.toISOString(), tz);
  const day = dayKeyOf(iso, tz);
  if (daysBetween(day, todayKey) === 1) return t("relative.yesterdayAt", { time: timeOf(iso, tz) });
  const [, m, d] = day.split("-").map(Number);
  return t("relative.dateAt", { month: m, day: d, time: timeOf(iso, tz) });
}
