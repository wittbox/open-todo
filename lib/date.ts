import { DEFAULT_TZ, zonedDayStart, zonedYMD } from "@/lib/tz";

/**
 * 날짜 전용 값(@db.Date — 기한, 나의 하루, 보고서 주차) 규칙.
 *
 * Postgres DATE 컬럼에는 시간이 없다. 여기에 현지 자정 Date 객체를 그대로 넣으면
 * UTC로 바뀌면서 전날이 저장된다(8/7 00:00 KST = 8/6 15:00 UTC → 8/6).
 * 그래서 날짜 전용 값은 **항상 UTC 자정**으로 만들고, 읽을 때도 UTC 파트로 읽는다.
 * "오늘"이 언제인지만 사용자 시간대(`tz`, 기본은 서울)로 판단한다.
 */

/** 날짜 전용 값 만들기 (월은 1부터) */
export function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** 그 시간대의 오늘 (UTC 자정) */
export function todayDateOnly(now: Date = new Date(), tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = zonedYMD(now, tz);
  return dateOnly(y, m, d);
}

/** "YYYY-MM-DD" → 날짜 전용 Date. 서버·클라이언트 어디서 불러도 같은 값이 나온다. */
export function dateOnlyFromString(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** 날짜 전용 Date → "YYYY-MM-DD" */
export function dateOnlyToString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** 그 시간대의 오늘로부터 n일 뒤의 날짜 전용 값 */
export function daysFromToday(days: number, now: Date = new Date(), tz: string = DEFAULT_TZ): Date {
  return addDays(todayDateOnly(now, tz), days);
}

/**
 * 날짜 전용 값을 사람이 읽는 말로 바꾸는 일은 여기서 하지 않는다 — 보는 사람의 언어로 해야 하므로
 * 화면은 next-intl 의 `useFormatter()`, 메일·알림은 `formatterFor(locale, tz)` 를 쓴다.
 * 이 값들은 UTC 자정이므로 **반드시 `timeZone: "UTC"`** 로 찍는다(서쪽 시간대에서 하루 앞당겨지지 않게).
 */

export function isSameDateOnly(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

/** 기한이 지났는지 (오늘은 지나지 않은 것으로 본다) */
export function isOverdue(due: Date, now: Date = new Date(), tz: string = DEFAULT_TZ): boolean {
  return due.getTime() < todayDateOnly(now, tz).getTime();
}

/**
 * 그 날짜가 속한 주의 월요일 (날짜 전용 값).
 * 주간보고서의 주 범위는 작성자 시간대의 월요일 00:00 ~ 일요일 24:00 이다.
 */
export function weekStartOf(dateOnlyValue: Date): Date {
  const dow = (dateOnlyValue.getUTCDay() + 6) % 7; // 월=0
  return addDays(dateOnlyValue, -dow);
}

/** 이번 주 월요일 */
export function currentWeekStart(now: Date = new Date(), tz: string = DEFAULT_TZ): Date {
  return weekStartOf(todayDateOnly(now, tz));
}

/**
 * 날짜 전용 값(UTC 자정)이 가리키는 하루가 그 시간대에서 실제로 시작하는 순간.
 * 서울 자정은 그 날짜의 UTC 자정보다 9시간 이르다. 서머타임이 있는 곳은 날마다 다르다.
 * completedAt / updatedAt 같은 타임스탬프를 비교할 때 쓴다.
 */
export function dayStart(dateOnlyValue: Date, tz: string = DEFAULT_TZ): Date {
  return zonedDayStart(dateOnlyValue, tz);
}

/** [시작일 00:00, 시작일+days 00:00) 구간 — 그 시간대 기준 */
export function dayRange(startDateOnly: Date, days: number, tz: string = DEFAULT_TZ): { from: Date; to: Date } {
  return { from: dayStart(startDateOnly, tz), to: dayStart(addDays(startDateOnly, days), tz) };
}

