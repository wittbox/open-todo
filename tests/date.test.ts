import { describe, expect, it } from "vitest";
import { addDays, dateOnly, daysFromToday, isOverdue, todayDateOnly } from "@/lib/date";
import { DATE_ONLY, shortDayLabel } from "@/lib/format";
import { formatterFor } from "@/i18n/server";

/**
 * 날짜 전용 값은 UTC 자정으로 저장하고 UTC 파트로 읽는다.
 * 이 규칙이 깨지면 기한이 하루씩 밀린다 (KST 자정을 그대로 넣었을 때 실제로 겪은 버그).
 */

describe("todayDateOnly", () => {
  it("서울 기준 날짜를 UTC 자정으로 만든다", () => {
    // 2026-08-09 23:00 UTC = 2026-08-10 08:00 KST → 서울에서는 이미 10일
    expect(todayDateOnly(new Date("2026-08-09T23:00:00Z")).toISOString()).toBe("2026-08-10T00:00:00.000Z");
    // 2026-08-09 14:00 UTC = 2026-08-09 23:00 KST → 아직 9일
    expect(todayDateOnly(new Date("2026-08-09T14:00:00Z")).toISOString()).toBe("2026-08-09T00:00:00.000Z");
  });

  it("자정 직전/직후 경계", () => {
    // 15:00 UTC = 다음 날 00:00 KST
    expect(todayDateOnly(new Date("2026-08-09T15:00:00Z")).toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(todayDateOnly(new Date("2026-08-09T14:59:59Z")).toISOString()).toBe("2026-08-09T00:00:00.000Z");
  });
});

/**
 * 날짜 전용 값은 보는 사람의 언어로 찍되 **UTC 로** 읽어야 한다 — 시간대를 빠뜨리면
 * 서쪽 시간대에서 하루 앞당겨진다. lib/format.ts 의 옵션 묶음이 그것을 못박는다.
 */
describe("포맷", () => {
  const ko = formatterFor("ko", "America/New_York");
  const en = formatterFor("en", "America/New_York");

  it("사용자 시간대가 서쪽이어도 날짜가 밀리지 않는다", () => {
    expect(ko.dateTime(dateOnly(2026, 8, 7), DATE_ONLY)).toContain("8월 7일");
    expect(shortDayLabel(dateOnly(2026, 8, 7), "ko")).toBe("8/7(금)");
    expect(shortDayLabel(dateOnly(2026, 8, 7), "en")).toBe("8/7(Fri)");
    expect(en.dateTime(dateOnly(2026, 8, 7), DATE_ONLY)).toContain("August 7");
  });

  it("요일도 UTC 파트로 읽는다", () => {
    expect(ko.dateTime(dateOnly(2026, 8, 7), DATE_ONLY)).toContain("금");
    expect(en.dateTime(dateOnly(2026, 8, 7), DATE_ONLY)).toContain("Fri");
  });

  it("월말·연말을 넘겨도 맞다", () => {
    expect(ko.dateTime(addDays(dateOnly(2026, 12, 31), 1), DATE_ONLY)).toContain("1월 1일");
    expect(ko.dateTime(addDays(dateOnly(2026, 2, 28), 1), DATE_ONLY)).toContain("3월 1일");
  });
});

describe("daysFromToday", () => {
  it("오프셋이 날짜에 그대로 적용된다", () => {
    const now = new Date("2026-08-09T05:00:00Z"); // 서울 8/9 14:00
    expect(daysFromToday(-2, now).toISOString()).toBe("2026-08-07T00:00:00.000Z");
    expect(daysFromToday(3, now).toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-08-09T05:00:00Z"); // 서울 8/9 (일)
  it("어제는 지났다", () => expect(isOverdue(dateOnly(2026, 8, 8), now)).toBe(true));
  it("오늘은 아직 안 지났다", () => expect(isOverdue(dateOnly(2026, 8, 9), now)).toBe(false));
  it("내일은 안 지났다", () => expect(isOverdue(dateOnly(2026, 8, 10), now)).toBe(false));
});
