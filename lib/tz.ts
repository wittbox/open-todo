import { TZDate } from "@date-fns/tz";

/**
 * 시간대 계산(서버·브라우저 공용, 아무 설정도 읽지 않는다).
 *
 * 앱은 두 종류의 시각을 다룬다.
 *   - 날짜 전용 값(기한·나의 하루·보고서 주차): 항상 **UTC 자정**으로 저장한다(lib/date.ts).
 *     "오늘이 며칠인가" 만 사용자 시간대로 정한다.
 *   - 순간(완료 시각·알림·예약 발송): 그대로 UTC 순간이다. 사용자 시간대의 벽시계로 바꿀 때만 여기를 쓴다.
 *
 * 예전에는 서울(+9h)을 고정해 계산했다. 서머타임이 있는 곳이나 +5:45 같은 곳에서도 맞게
 * @date-fns/tz 의 TZDate 로 계산한다.
 */

export const DEFAULT_TZ = "Asia/Seoul";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const ymdFormatters = new Map<string, Intl.DateTimeFormat>();

/** 그 시간대에서 이 순간의 달력 날짜 [연, 월(1부터), 일] */
export function zonedYMD(now: Date, tz: string): [number, number, number] {
  let f = ymdFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    ymdFormatters.set(tz, f);
  }
  const [y, m, d] = f.format(now).split("-").map(Number);
  return [y, m, d];
}

/** 그 시간대의 벽시계 시각 → 순간. 월은 1부터. */
export function zonedToInstant(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  return new Date(new TZDate(year, month - 1, day, hour, minute, tz).getTime());
}

/** 날짜 전용 값(UTC 자정)이 가리키는 하루가 그 시간대에서 시작하는 순간 */
export function zonedDayStart(dateOnlyValue: Date, tz: string): Date {
  return zonedToInstant(
    dateOnlyValue.getUTCFullYear(),
    dateOnlyValue.getUTCMonth() + 1,
    dateOnlyValue.getUTCDate(),
    0,
    0,
    tz,
  );
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** 순간 → 그 시간대의 벽시계. weekday 는 일=0. */
export function zonedParts(instant: Date, tz: string): ZonedParts {
  const t = new TZDate(instant.getTime(), tz);
  return {
    year: t.getFullYear(),
    month: t.getMonth() + 1,
    day: t.getDate(),
    hour: t.getHours(),
    minute: t.getMinutes(),
    weekday: t.getDay(),
  };
}
