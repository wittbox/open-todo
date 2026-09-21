import { addDays } from "@/lib/date";

/**
 * 반복 규칙.
 *
 * 시리즈를 미리 만들어 두지 않는다. 완료하는 순간 다음 하나가 생기고, 규칙은
 * 그 작업이 들고 간다 — To Do 원본과 같은 방식이다. 그래서 "반복 시리즈"라는
 * 개체가 없고, 규칙을 바꾸면 다음 것부터 적용된다.
 *
 * 날짜는 전부 UTC 자정 기준 date-only 다 (lib/date.ts 규약).
 */

export type RepeatUnit = "DAY" | "WEEK" | "MONTH" | "YEAR";

export type RepeatRule = {
  unit: RepeatUnit;
  /** 몇 단위마다. 1 이상 */
  every: number;
  /** 주 단위일 때 반복할 요일 (0=일 … 6=토). 비면 기준 날짜의 요일을 쓴다. */
  days: number[];
};

const MAX_EVERY = 30;

/**
 * 문구 만들기에 필요한 것만 밖에서 받는다.
 *
 * 이 파일은 순수 함수만 두므로 next-intl 을 끌어오지 않는다. 컴포넌트가
 * `useTranslations("tasks")` 와 `useLocale()` 을, 서버가 `getTranslations`/요청 언어를 넘긴다.
 * 키는 `tasks` 묶음 기준이다(`repeat.daily` 처럼).
 */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** 2023-01-01(일요일) 부터 이레. 요일 이름은 언제나 Intl 에서 받는다. */
const WEEK_SAMPLE = Array.from({ length: 7 }, (_, d) => new Date(Date.UTC(2023, 0, 1 + d)));

/** 일요일부터 시작하는 요일 이름 (0=일 … 6=토). */
export function weekdayNames(locale: string, style: "long" | "short"): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" });
  return WEEK_SAMPLE.map((d) => fmt.format(d));
}

/** "8월 12일" · "August 12" — 날짜 전용 값(UTC 자정)이라 UTC 로 찍는다. */
function monthDay(locale: string, date: Date): string {
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

export function normalizeRule(raw: Partial<RepeatRule> | null | undefined): RepeatRule | null {
  if (!raw?.unit) return null;
  const every = Math.min(MAX_EVERY, Math.max(1, Math.trunc(raw.every ?? 1)));
  const days =
    raw.unit === "WEEK"
      ? [...new Set((raw.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [];
  return { unit: raw.unit, every, days };
}

/** 화면에 그대로 쓰는 문구. 규칙에서 만들기 때문에 두 곳이 어긋나지 않는다. */
export function describeRule(rule: RepeatRule, anchor: Date, t: Translate, locale: string): string {
  const { unit, every, days } = rule;

  if (unit === "WEEK") {
    const list = days.length > 0 ? days : [anchor.getUTCDay()];
    const isWeekdays = every === 1 && list.length === 5 && list.every((d) => d >= 1 && d <= 5);
    if (isWeekdays) return t("repeat.weekdays");
    const long = weekdayNames(locale, "long");
    const names = list.map((d) => long[d]).join(", ");
    return every === 1
      ? t("repeat.weeklyOn", { days: names })
      : t("repeat.everyWeeksOn", { every, days: names });
  }

  if (unit === "DAY") return every === 1 ? t("repeat.daily") : t("repeat.everyDays", { every });
  if (unit === "MONTH") {
    const day = anchor.getUTCDate();
    return every === 1 ? t("repeat.monthly", { day }) : t("repeat.everyMonths", { every, day });
  }
  const date = monthDay(locale, anchor);
  return every === 1 ? t("repeat.yearly", { date }) : t("repeat.everyYears", { every, date });
}

/** 그 달에 없는 날짜는 말일로 당긴다. 1/31 에 한 달을 더하면 2/28. */
function shiftMonths(base: Date, months: number): Date {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + months;
  const day = base.getUTCDate();
  // 다음 달 0일 = 그 달의 마지막 날
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

/**
 * 다음 기한.
 *
 * `anchor` 에서 규칙만큼 나아가되 `after` 보다 확실히 뒤인 첫 날을 고른다.
 * 늦게 완료해도 밀린 날짜가 쌓이지 않는 이유가 이 조건이다 —
 * 8/12 기한을 8/20 에 매주 완료하면 8/19 를 건너뛰고 8/26 이 된다.
 */
export function nextDue(rule: RepeatRule, anchor: Date, completedOn: Date): Date {
  const limit = 400; // 어떤 규칙이든 이 안에서 반드시 다음 날짜가 나온다

  // 기한보다 일찍 끝냈어도 그 기한 자체를 다시 잡지는 않는다. 반복은 어느
  // 방향으로 빗나갔든 앞으로만 간다.
  const after = completedOn.getTime() > anchor.getTime() ? completedOn : anchor;

  if (rule.unit === "WEEK") {
    const days = rule.days.length > 0 ? rule.days : [anchor.getUTCDay()];
    // 주 간격은 기준 날짜가 속한 주부터 센다.
    const anchorWeek = addDays(anchor, -anchor.getUTCDay());
    for (let w = 0; w < limit; w += 1) {
      if (w % rule.every !== 0) continue;
      const weekStart = addDays(anchorWeek, w * 7);
      for (const d of [...days].sort()) {
        const candidate = addDays(weekStart, d);
        if (candidate.getTime() > after.getTime()) return candidate;
      }
    }
    return addDays(after, 7);
  }

  for (let i = 1; i <= limit; i += 1) {
    const candidate =
      rule.unit === "DAY"
        ? addDays(anchor, rule.every * i)
        : rule.unit === "MONTH"
          ? shiftMonths(anchor, rule.every * i)
          : shiftMonths(anchor, rule.every * 12 * i);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return addDays(after, 1);
}

/**
 * 화면의 기본 선택지. 기한 날짜에서 요일·일자를 뽑아 만든다.
 * 문구는 describeRule 과 같은 것을 쓴다 — 고른 뒤에 보이는 말과 어긋나지 않는다.
 */
export function presetRules(
  anchor: Date,
  t: Translate,
  locale: string,
): { key: string; label: string; rule: RepeatRule }[] {
  const presets: { key: string; rule: RepeatRule }[] = [
    { key: "daily", rule: { unit: "DAY", every: 1, days: [] } },
    { key: "weekdays", rule: { unit: "WEEK", every: 1, days: [1, 2, 3, 4, 5] } },
    { key: "weekly", rule: { unit: "WEEK", every: 1, days: [anchor.getUTCDay()] } },
    { key: "monthly", rule: { unit: "MONTH", every: 1, days: [] } },
    { key: "yearly", rule: { unit: "YEAR", every: 1, days: [] } },
  ];
  return presets.map((p) => ({ ...p, label: describeRule(p.rule, anchor, t, locale) }));
}
