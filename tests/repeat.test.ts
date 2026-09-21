import { describe, expect, it } from "vitest";
import { describeRule, nextDue, normalizeRule, presetRules, type RepeatRule, type Translate } from "@/lib/repeat";
import { dateOnly, dateOnlyToString } from "@/lib/date";
import { translatorFor } from "@/i18n/server";

/**
 * 반복 날짜 계산.
 *
 * 여기가 틀리면 사람이 아니라 앱이 일정을 밀어 버린다. 특히 두 가지:
 *  - 늦게 완료해도 지난 날짜가 다시 잡히면 안 된다
 *  - 그 달에 없는 날(2월 31일)이 만들어지면 안 된다
 */

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const S = dateOnlyToString;
const rule = (r: Partial<RepeatRule>): RepeatRule => normalizeRule({ unit: "DAY", every: 1, days: [], ...r })!;

/** 문구는 messages/<언어>/tasks.json 에서 온다. 요일 이름은 Intl 이 준다. */
const ko = ((key, values) =>
  (translatorFor("ko") as unknown as Translate)(`tasks.${key}`, values)) satisfies Translate;
const en = ((key, values) =>
  (translatorFor("en") as unknown as Translate)(`tasks.${key}`, values)) satisfies Translate;
const say = (r: RepeatRule, anchor: Date) => describeRule(r, anchor, ko, "ko");

describe("규칙 정리", () => {
  it("간격은 1 아래로 내려가지 않고 30 을 넘지 않는다", () => {
    expect(rule({ every: 0 }).every).toBe(1);
    expect(rule({ every: -5 }).every).toBe(1);
    expect(rule({ every: 999 }).every).toBe(30);
    expect(rule({ every: 2.7 }).every).toBe(2);
  });

  it("요일은 주 단위일 때만 남고, 중복·범위 밖은 버린다", () => {
    expect(rule({ unit: "WEEK", days: [3, 3, 1, 9, -2] }).days).toEqual([1, 3]);
    expect(rule({ unit: "MONTH", days: [1, 2] }).days).toEqual([]);
  });

  it("unit 이 없으면 규칙이 아니다", () => {
    expect(normalizeRule(null)).toBeNull();
    expect(normalizeRule({})).toBeNull();
  });
});

describe("문구", () => {
  const wed = D("2026-08-12"); // 수요일

  it("사람이 읽는 말로 쓴다", () => {
    expect(say(rule({ unit: "DAY" }), wed)).toBe("매일");
    expect(say(rule({ unit: "WEEK", days: [1, 2, 3, 4, 5] }), wed)).toBe("평일");
    expect(say(rule({ unit: "WEEK", days: [3] }), wed)).toBe("매주 수요일");
    expect(say(rule({ unit: "MONTH" }), wed)).toBe("매월 12일");
    expect(say(rule({ unit: "YEAR" }), wed)).toBe("매년 8월 12일");
  });

  it("간격이 있으면 그대로 드러낸다", () => {
    expect(say(rule({ unit: "WEEK", every: 2, days: [1, 3] }), wed)).toBe("2주마다 월요일, 수요일");
    expect(say(rule({ unit: "DAY", every: 3 }), wed)).toBe("3일마다");
  });

  it("요일을 안 고르면 기준 날짜의 요일을 쓴다", () => {
    expect(say(rule({ unit: "WEEK", days: [] }), wed)).toBe("매주 수요일");
  });

  it("요일·날짜 이름은 언어를 따라간다", () => {
    expect(describeRule(rule({ unit: "WEEK", days: [3] }), wed, en, "en")).toBe("Weekly on Wednesday");
    expect(describeRule(rule({ unit: "YEAR" }), wed, en, "en")).toBe("Yearly on August 12");
  });
});

describe("다음 기한", () => {
  const wed = D("2026-08-12");

  it("제때 완료하면 한 칸 뒤", () => {
    expect(S(nextDue(rule({ unit: "WEEK", days: [3] }), wed, wed))).toBe("2026-08-19");
    expect(S(nextDue(rule({ unit: "DAY" }), wed, wed))).toBe("2026-08-13");
    expect(S(nextDue(rule({ unit: "MONTH" }), wed, wed))).toBe("2026-09-12");
    expect(S(nextDue(rule({ unit: "YEAR" }), wed, wed))).toBe("2027-08-12");
  });

  it("일찍 완료해도 같은 기한을 다시 잡지 않는다", () => {
    // 8/12 기한을 8/10 에 끝냄 → 8/12 가 아니라 8/19
    expect(S(nextDue(rule({ unit: "WEEK", days: [3] }), wed, D("2026-08-10")))).toBe("2026-08-19");
    expect(S(nextDue(rule({ unit: "DAY" }), wed, D("2026-08-01")))).toBe("2026-08-13");
    expect(S(nextDue(rule({ unit: "MONTH" }), wed, D("2026-07-01")))).toBe("2026-09-12");
  });

  it("늦게 완료해도 지난 날짜를 다시 잡지 않는다", () => {
    // 8/12 기한을 8/20 에 완료 → 8/19 를 건너뛰고 8/26
    expect(S(nextDue(rule({ unit: "WEEK", days: [3] }), wed, D("2026-08-20")))).toBe("2026-08-26");
    // 두 달 늦게 완료해도 마찬가지
    expect(S(nextDue(rule({ unit: "MONTH" }), wed, D("2026-10-15")))).toBe("2026-11-12");
  });

  it("평일은 토·일을 건너뛴다", () => {
    const weekdays = rule({ unit: "WEEK", days: [1, 2, 3, 4, 5] });
    const fri = D("2026-08-14");
    expect(S(nextDue(weekdays, fri, fri))).toBe("2026-08-17"); // 월요일
    const thu = D("2026-08-13");
    expect(S(nextDue(weekdays, thu, thu))).toBe("2026-08-14");
  });

  it("한 주에 여러 요일이면 그 주 안에서 먼저 온다", () => {
    const monWed = rule({ unit: "WEEK", days: [1, 3] });
    const mon = D("2026-08-10");
    expect(S(nextDue(monWed, mon, mon))).toBe("2026-08-12"); // 같은 주 수요일
    expect(S(nextDue(monWed, mon, D("2026-08-12")))).toBe("2026-08-17"); // 다음 주 월요일
  });

  it("2주마다는 중간 주를 건너뛴다", () => {
    const biweekly = rule({ unit: "WEEK", every: 2, days: [3] });
    expect(S(nextDue(biweekly, wed, wed))).toBe("2026-08-26");
  });

  it("그 달에 없는 날은 말일로 당긴다", () => {
    // 1/31 매월 → 2/28 (2026년은 평년)
    expect(S(nextDue(rule({ unit: "MONTH" }), D("2026-01-31"), D("2026-01-31")))).toBe("2026-02-28");
    // 3/31 매월 → 4/30
    expect(S(nextDue(rule({ unit: "MONTH" }), D("2026-03-31"), D("2026-03-31")))).toBe("2026-04-30");
  });

  it("2월 29일 매년은 평년에 28일로 당긴다", () => {
    expect(S(nextDue(rule({ unit: "YEAR" }), D("2028-02-29"), D("2028-02-29")))).toBe("2029-02-28");
  });

  it("어떤 규칙이든 완료일보다 뒤를 준다", () => {
    const late = D("2027-06-01");
    for (const r of [
      rule({ unit: "DAY", every: 3 }),
      rule({ unit: "WEEK", days: [0, 6] }),
      rule({ unit: "MONTH", every: 2 }),
      rule({ unit: "YEAR" }),
    ]) {
      expect(nextDue(r, wed, late).getTime()).toBeGreaterThan(late.getTime());
    }
  });
});

describe("기본 선택지", () => {
  it("기한 날짜에서 요일과 일자를 뽑는다", () => {
    const labels = presetRules(dateOnly(2026, 8, 12), ko, "ko").map((p) => p.label);
    expect(labels).toEqual(["매일", "평일", "매주 수요일", "매월 12일", "매년 8월 12일"]);
  });
});
