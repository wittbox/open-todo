/**
 * 날짜·시간을 찍을 때 함께 쓰는 옵션 묶음.
 *
 * 날짜 전용 값(기한·주차 — UTC 자정으로 저장한다)은 **반드시 `timeZone: "UTC"`** 로 찍는다.
 * 사용자 시간대로 찍으면 서쪽 시간대에서 하루 앞당겨진다.
 *
 * 쓰는 곳: 화면은 next-intl `useFormatter()`/`getFormatter()`, 메일·알림은 `formatterFor(locale, tz)`.
 */

/** "8월 7일 (금)" · "Fri, Aug 7" */
export const DATE_ONLY = { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" } as const;

/** 좁은 자리(보고서 주차 목록·메일 제목) */
export const DATE_ONLY_SHORT = { month: "numeric", day: "numeric", weekday: "short", timeZone: "UTC" } as const;

/** 연·월·일만 */
export const DATE_ONLY_PLAIN = { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" } as const;

/**
 * "8/7(금)" · "8/7(Fri)" — 좁은 자리(보고서 주 범위·예약 버튼)에 쓰는 짧은 날짜.
 *
 * 언어별 숫자 날짜 형식("8. 7.")은 이 자리에 넣기엔 길고 읽기 나쁘다. 그래서 월·일은 숫자로 고정하고
 * 요일만 언어에 맞게 가져온다. 날짜 전용 값(UTC 자정)을 그대로 넘긴다.
 */
export function shortDayLabel(date: Date, locale: string): string {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${weekday})`;
}
