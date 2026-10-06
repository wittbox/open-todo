import { describe, expect, it } from "vitest";
import {
  CALENDAR_WEEKS,
  DEFAULT_PREFS,
  PAGE_WEEKS,
  compareCellEntries,
  defaultFrom,
  parseFrom,
  parsePrefs,
  projectRepeats,
  rangeNeedsYear,
  serializePrefs,
  shiftWeeks,
  weekGrid,
} from "@/lib/calendar";
import { HOLIDAY_YEARS, allHolidays, holidayName } from "@/lib/holidays";
import { nextDue, type RepeatRule } from "@/lib/repeat";
import { dateOnlyFromString, dateOnlyToString } from "@/lib/date";
import { LOCALES } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";

/**
 * 달력의 규칙.
 *
 * 칸 계산은 날짜 경계(일요일 시작·해 넘김)에서, 반복 회차는 "완료 버튼이 실제로
 * 만들 날짜와 같은가" 에서 어긋나기 쉽다. 공휴일 표는 사람이 옮겨 적은 것이라 표 자체도 훑는다.
 */

const D = dateOnlyFromString;
const TODAY = D("2026-09-11"); // 금

describe("보이는 5주", () => {
  const S = dateOnlyToString;

  it("처음에는 지난 1주 · 이번 주 · 앞으로 3주 — 이번 주가 둘째 줄", () => {
    const g = weekGrid(defaultFrom(TODAY)); // 9/11 금
    expect(g.weeks).toHaveLength(CALENDAR_WEEKS);
    expect(g.weeks[0][0]).toBe("2026-08-30");
    expect(g.weeks[1]).toContain("2026-09-11");
    expect(g.weeks[4][6]).toBe("2026-10-03");
    expect([S(g.start), S(g.end)]).toEqual(["2026-08-30", "2026-10-04"]);
  });

  it("달 끝에도 이번 주는 둘째 줄 — 앞으로 3주가 다음 달까지 이어진다", () => {
    const g = weekGrid(defaultFrom(D("2026-09-29"))); // 화
    expect(g.weeks[1]).toContain("2026-09-29");
    expect([g.weeks[0][0], g.weeks[4][6]]).toEqual(["2026-09-20", "2026-10-24"]);
  });

  it("일요일·토요일이 오늘이어도 같은 주 — 주는 일요일에 시작한다", () => {
    expect(S(defaultFrom(D("2026-09-27")))).toBe("2026-09-20");
    expect(S(defaultFrom(D("2026-10-03")))).toBe("2026-09-20");
  });

  it("칸은 늘 5주, 일요일 시작, 하루씩 빈틈없이 — 해를 건너도", () => {
    for (let i = 0; i < 60; i++) {
      const { weeks } = weekGrid(shiftWeeks(D("2026-11-01"), i));
      const days = weeks.flat();
      expect(weeks).toHaveLength(5);
      expect(weeks.every((w) => D(w[0]).getUTCDay() === 0)).toBe(true);
      days.forEach((d, j) => j > 0 && expect(D(d).getTime() - D(days[j - 1]).getTime()).toBe(86_400_000));
    }
  });

  it("넘기기는 4주 — 넘긴 뒤 맨 윗줄이 방금 보던 맨 아랫줄", () => {
    const now = weekGrid(defaultFrom(D("2026-09-29")));
    const next = weekGrid(shiftWeeks(now.start, PAGE_WEEKS));
    const prev = weekGrid(shiftWeeks(now.start, -PAGE_WEEKS));
    expect(next.weeks[0]).toEqual(now.weeks[4]);
    expect(prev.weeks[4]).toEqual(now.weeks[0]);
  });

  it("주소 ?from= 을 읽고, 다른 요일이면 그 주 일요일로 맞춘다", () => {
    expect(S(parseFrom({ from: "2026-10-18" }, TODAY))).toBe("2026-10-18");
    expect(S(parseFrom({ from: "2026-10-21" }, TODAY))).toBe("2026-10-18");
    expect(S(parseFrom({ from: "2027-01-02" }, TODAY))).toBe("2026-12-27");
  });

  it("예전 ?month= 링크는 그 달 1일이 든 주를 둘째 줄에", () => {
    const g = weekGrid(parseFrom({ month: "2026-12" }, TODAY));
    expect(g.weeks[1]).toContain("2026-12-01");
  });

  it("이상한 주소는 기본값(이번 주가 둘째 줄)", () => {
    for (const bad of ["2026-02-31", "2026-13-01", "2026-9-1", "1999-01-03", "어제", ["2026-10-18"], undefined]) {
      expect(S(parseFrom({ from: bad }, TODAY))).toBe("2026-08-30");
    }
    expect(S(parseFrom({ month: "2026-13" }, TODAY))).toBe("2026-08-30");
    // 둘 다 있으면 from 이 앞선다
    expect(S(parseFrom({ from: "2026-10-18", month: "2026-01" }, TODAY))).toBe("2026-10-18");
  });

  it("제목의 연도는 해가 걸치거나 다른 해를 볼 때만", () => {
    expect(rangeNeedsYear("2026-09-20", "2026-10-24", "2026-09-29")).toBe(false);
    expect(rangeNeedsYear("2026-12-20", "2027-01-23", "2026-12-29")).toBe(true);
    expect(rangeNeedsYear("2027-02-07", "2027-03-13", "2026-12-29")).toBe(true);
  });
});

describe("반복 다음 회차", () => {
  const weeklyFri: RepeatRule = { unit: "WEEK", every: 1, days: [5] };
  const sep = weekGrid(D("2026-08-30"));
  const src = (over: Partial<{ dueDate: string | null; isCompleted: boolean; repeat: RepeatRule | null }> = {}) => ({
    id: "t",
    dueDate: "2026-09-11",
    isCompleted: false,
    repeat: weeklyFri,
    ...over,
  });
  const dates = (r: { date: string }[]) => r.map((g) => g.date);

  it("이번 주 금요일이 기한이면 다음 금요일들 — 칸 끝까지만", () => {
    expect(dates(projectRepeats([src()], sep.start, sep.end, TODAY))).toEqual([
      "2026-09-18",
      "2026-09-25",
      "2026-10-02",
    ]);
  });

  it("기한이 지난 반복은 오늘 끝낸다고 보고 그 뒤부터 — 지난 금요일에는 회차가 없다", () => {
    const r = projectRepeats([src({ dueDate: "2026-08-28" })], sep.start, sep.end, TODAY);
    expect(dates(r)).toEqual(["2026-09-18", "2026-09-25", "2026-10-02"]);
    // 완료 버튼이 실제로 만들 다음 작업의 기한과 첫 회차가 같다
    expect(r[0].date).toBe(dateOnlyToString(nextDue(weeklyFri, D("2026-08-28"), TODAY)));
  });

  it("2주마다 월·목 — 칸 안의 회차가 규칙대로", () => {
    const rule: RepeatRule = { unit: "WEEK", every: 2, days: [1, 4] };
    expect(dates(projectRepeats([src({ dueDate: "2026-09-14", repeat: rule })], sep.start, sep.end, TODAY))).toEqual([
      "2026-09-17",
      "2026-09-28",
      "2026-10-01",
    ]);
  });

  it("매월 31일 반복은 짧은 달에서 말일 — 완료 계산과 같다", () => {
    const rule: RepeatRule = { unit: "MONTH", every: 1, days: [] };
    const feb = weekGrid(D("2026-02-01"));
    const r = projectRepeats([src({ dueDate: "2026-01-31", repeat: rule })], feb.start, feb.end, D("2026-01-20"));
    expect(dates(r)).toEqual(["2026-02-28"]);
  });

  it("완료했거나 반복이 없거나 기한이 없으면 회차가 없다", () => {
    const r = projectRepeats(
      [src({ isCompleted: true }), src({ repeat: null }), src({ dueDate: null })],
      sep.start,
      sep.end,
      TODAY,
    );
    expect(r).toEqual([]);
  });

  it("지난달 칸에는 회차를 그리지 않는다 — 지난 일은 실제 기록으로 본다", () => {
    const aug = weekGrid(D("2026-07-26"));
    expect(projectRepeats([src({ dueDate: "2026-08-07" })], aug.start, aug.end, TODAY)).toEqual([]);
  });

  it("몇 년 뒤 달을 봐도 멈추고, 칸 밖 날짜는 내놓지 않는다", () => {
    const far = weekGrid(D("2031-01-01"));
    const daily: RepeatRule = { unit: "DAY", every: 1, days: [] };
    const r = projectRepeats([src({ repeat: daily })], far.start, far.end, TODAY);
    for (const g of r) {
      expect(D(g.date).getTime()).toBeGreaterThanOrEqual(far.start.getTime());
      expect(D(g.date).getTime()).toBeLessThan(far.end.getTime());
    }
  });
});

describe("칸 안 순서", () => {
  it("할 일(별표 먼저) → 반복 다음 회차 → 완료, 같으면 먼저 만든 것부터", () => {
    const e = (name: string, seq: number, o: { ghost?: boolean; done?: boolean; star?: boolean } = {}) => ({
      name,
      ghost: Boolean(o.ghost),
      task: { seq, isCompleted: Boolean(o.done), isImportant: Boolean(o.star) },
    });
    const sorted = [
      e("완료", 1, { done: true }),
      e("회차", 2, { ghost: true }),
      e("보통2", 9),
      e("별표", 7, { star: true }),
      e("보통1", 3),
    ].sort(compareCellEntries);
    expect(sorted.map((x) => x.name)).toEqual(["별표", "보통1", "보통2", "회차", "완료"]);
  });
});

describe("공휴일", () => {
  // 표에는 이름이 아니라 열쇠가 들어 있다 — 보이는 이름은 calendar.holidays.<열쇠> 에서 꺼낸다.
  it("추석·대체공휴일·2026년에 새로 생긴 공휴일", () => {
    expect(holidayName("2026-09-25")).toBe("chuseok");
    expect(holidayName("2026-09-24")).toBe("chuseokHoliday");
    expect(holidayName("2026-10-05")).toBe("substitute");
    expect(holidayName("2026-05-01")).toBe("labor");
    expect(holidayName("2026-07-17")).toBe("constitution");
    expect(holidayName("2027-02-07")).toBe("seollal");
    expect(holidayName("2027-02-09")).toBe("substitute");
    expect(holidayName("2026-09-27")).toBeNull();
    expect(holidayName("2030-01-01")).toBeNull();
  });

  it("표의 열쇠마다 두 언어의 이름이 있다", () => {
    const keys = new Set(allHolidays().map(([, key]) => key));
    for (const locale of LOCALES) {
      const names: Record<string, string> = loadMessages(locale).calendar.holidays;
      for (const key of keys) expect(names[key], `${locale}.${key}`).toBeTruthy();
    }
  });

  it("표의 날짜는 모두 실제 있는 날이다", () => {
    for (const [date] of allHolidays()) expect(dateOnlyToString(D(date))).toBe(date);
  });

  it("대체공휴일은 모두 평일이다 — 주말로 적었다면 옮겨 적다 틀린 것", () => {
    const subs = allHolidays().filter(([, key]) => key === "substitute");
    expect(subs.length).toBeGreaterThan(0);
    for (const [date] of subs) expect([1, 2, 3, 4, 5]).toContain(D(date).getUTCDay());
  });

  it("월력요항의 해마다 공휴일 수와 맞다 (2026년 22일, 2027년 24일)", () => {
    const count = (y: number) => allHolidays().filter(([d]) => d.startsWith(`${y}-`)).length;
    expect([count(2026), count(2027)]).toEqual([22, 24]);
  });

  it("올해 공휴일 표가 있다 — 실패하면 월력요항을 보고 lib/holidays.ts 에 올해를 채울 때", () => {
    expect(HOLIDAY_YEARS).toContain(new Date().getFullYear());
  });
});

describe("보기 설정 쿠키", () => {
  it("없거나 깨졌으면 기본값", () => {
    expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("%%%")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("null")).toEqual(DEFAULT_PREFS);
  });

  it("쓴 그대로 읽힌다 — 이미 풀린 값이 와도", () => {
    const p = { showDone: false, hidden: ["l1", "l2"], addListId: "l3", overdueOpen: true };
    expect(parsePrefs(serializePrefs(p))).toEqual(p);
    expect(parsePrefs(decodeURIComponent(serializePrefs(p)))).toEqual(p);
  });

  it("모양이 틀린 칸만 기본값으로 — '지난 기한' 줄 펼침이 없던 옛 쿠키도", () => {
    const raw = encodeURIComponent(JSON.stringify({ showDone: "yes", hidden: [1, "a"], addListId: 5, overdueOpen: "y" }));
    expect(parsePrefs(raw)).toEqual({ showDone: true, hidden: ["a"], addListId: null, overdueOpen: false });
    const old = encodeURIComponent(JSON.stringify({ showDone: false, hidden: [], addListId: null }));
    expect(parsePrefs(old).overdueOpen).toBe(false);
  });
});
