import { describe, expect, it } from "vitest";
import { addDays, dateOnly, dateOnlyToString, dayRange, dayStart, isOverdue, todayDateOnly } from "@/lib/date";
import { checkScheduleAt, earliestSlot, scheduleLabel, slotToInstant } from "@/lib/report/schedule";
import { dayKeyOf, timeOf } from "@/lib/projects/format";
import { zonedParts } from "@/lib/tz";
import { classify, type SourceTask } from "@/lib/report/aggregate";

/**
 * 시간대 계산.
 *
 * 예전 구현은 서울(+9h)을 박아 계산했다. 사용자 시간대를 받게 바꾸면서 **서울 결과는 한 글자도 바뀌면 안 된다** —
 * 아래 "황금 시험" 이 옛 구현을 그대로 옮겨 두고 2년치 순간에서 새 구현과 비교한다.
 * 그다음 서머타임(뉴욕)과 30·45분 어긋난 곳(카트만두 +5:45)에서 맞는지 본다.
 */

const SEOUL = "Asia/Seoul";
const NY = "America/New_York";
const KTM = "Asia/Kathmandu";
const MIN = 60_000;

/* ── 옛 구현(서울 고정) — 비교용으로만 둔다 ─────────────────────── */

const old = {
  today(now: Date): Date {
    const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: SEOUL, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(now)
      .split("-")
      .map(Number);
    return dateOnly(y, m, d);
  },
  kstInstant: (d: Date) => new Date(d.getTime() - 9 * 3_600_000),
  kstToInstant(day: Date, hhmm: string): Date {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m) - 9 * 60 * MIN);
  },
  earliestSlot(now: Date): { day: Date; hhmm: string } {
    const step = 10 * MIN;
    const t = Math.ceil((now.getTime() + 10 * MIN) / step) * step;
    const kst = new Date(t + 9 * 60 * MIN);
    return {
      day: new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())),
      hhmm: `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`,
    };
  },
  scheduleLabel(at: Date): string {
    const W = ["일", "월", "화", "수", "목", "금", "토"];
    const kst = new Date(at.getTime() + 9 * 60 * MIN);
    const hh = String(kst.getUTCHours()).padStart(2, "0");
    const mm = String(kst.getUTCMinutes()).padStart(2, "0");
    return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}(${W[kst.getUTCDay()]}) ${hh}:${mm}`;
  },
  timeOf: (iso: string) =>
    new Intl.DateTimeFormat("ko-KR", { timeZone: SEOUL, hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date(iso))
      .replace(/^24:/, "00:"),
};

describe("황금 시험 — 서울 결과는 예전과 같다", () => {
  it("2년치 순간에서 오늘·하루 시작·예약 시각·표기가 모두 같다", () => {
    const start = Date.UTC(2025, 0, 1, 0, 7, 13);
    const end = Date.UTC(2027, 0, 1);
    let checked = 0;
    // 97분 13초 간격 — 모든 시각·분·초 조합을 고르게 훑는다.
    for (let t = start; t < end; t += 97 * MIN + 13_000) {
      const now = new Date(t);
      const today = todayDateOnly(now);
      expect(today.getTime()).toBe(old.today(now).getTime());
      expect(dayStart(today).getTime()).toBe(old.kstInstant(today).getTime());

      const slot = earliestSlot(now);
      const want = old.earliestSlot(now);
      expect(`${dateOnlyToString(slot.day)} ${slot.hhmm}`).toBe(`${dateOnlyToString(want.day)} ${want.hhmm}`);
      expect(slotToInstant(slot.day, slot.hhmm).getTime()).toBe(old.kstToInstant(want.day, want.hhmm).getTime());

      expect(scheduleLabel(now)).toBe(old.scheduleLabel(now));
      expect(timeOf(now.toISOString())).toBe(old.timeOf(now.toISOString()));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10_000);
  });
});

describe("서머타임 — 뉴욕", () => {
  it("밤 11시 반(EST)은 아직 그날이다 — UTC 로는 이미 다음 날이어도", () => {
    const now = new Date("2026-03-08T04:30:00Z"); // 3/7 23:30 EST
    expect(dateOnlyToString(todayDateOnly(now, NY))).toBe("2026-03-07");
    expect(dateOnlyToString(todayDateOnly(now, SEOUL))).toBe("2026-03-08");
  });

  it("하루가 시작하는 순간은 서머타임 전후로 한 시간 다르다", () => {
    expect(dayStart(dateOnly(2026, 3, 8), NY).toISOString()).toBe("2026-03-08T05:00:00.000Z"); // EST
    expect(dayStart(dateOnly(2026, 3, 9), NY).toISOString()).toBe("2026-03-09T04:00:00.000Z"); // EDT
  });

  it("서머타임이 낀 주는 167시간이다(보고서 주 범위)", () => {
    const { from, to } = dayRange(dateOnly(2026, 3, 2), 7, NY);
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(167);
  });

  it("기한 지남도 그 시간대의 오늘로 본다", () => {
    const now = new Date("2026-03-08T04:30:00Z"); // 뉴욕은 3/7, 서울은 3/8
    const due = dateOnly(2026, 3, 7);
    expect(isOverdue(due, now, NY)).toBe(false);
    expect(isOverdue(due, now, SEOUL)).toBe(true);
  });
});

describe("30·45분 어긋난 시간대 — 카트만두 +5:45", () => {
  it("고른 17:00 은 그 벽시계의 17:00 이다", () => {
    expect(slotToInstant(dateOnly(2026, 9, 11), "17:00", KTM).toISOString()).toBe("2026-09-11T11:15:00.000Z");
  });

  it("예약 눈금은 현지 벽시계로 본다 — UTC 로 보면 맞던 시각이 현지로는 16:55 다", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    expect(checkScheduleAt("2026-09-11T11:15:00.000Z", now, KTM).ok).toBe(true); // 현지 17:00
    expect(checkScheduleAt("2026-09-11T11:10:00.000Z", now, KTM).ok).toBe(false); // 현지 16:55
  });

  it("가장 이른 예약은 현지 10분 눈금에 맞는다", () => {
    for (let i = 0; i < 200; i++) {
      const now = new Date(Date.UTC(2026, 8, 11, 0, 0, 0) + i * 7 * MIN + 17_000);
      const slot = earliestSlot(now, KTM);
      expect(Number(slot.hhmm.slice(3)) % 10, slot.hhmm).toBe(0);
      const at = slotToInstant(slot.day, slot.hhmm, KTM);
      expect(at.getTime() - now.getTime()).toBeGreaterThanOrEqual(10 * MIN);
      expect(at.getTime() - now.getTime()).toBeLessThan(21 * MIN);
      expect(checkScheduleAt(at.toISOString(), now, KTM).ok).toBe(true);
    }
  });
});

describe("표기", () => {
  it("예약·메시지 시각은 넘긴 시간대의 벽시계", () => {
    const at = new Date("2026-09-12T08:00:00Z");
    expect(scheduleLabel(at)).toBe("9/12(토) 17:00");
    expect(scheduleLabel(at, NY)).toBe("9/12(토) 04:00");
    expect(timeOf(at.toISOString(), "Europe/Berlin")).toBe("10:00");
    expect(dayKeyOf("2026-09-12T02:00:00Z", NY)).toBe("2026-09-11");
    expect(dayKeyOf("2026-09-12T02:00:00Z")).toBe("2026-09-12");
  });

  it("벽시계 조각", () => {
    expect(zonedParts(new Date("2026-03-08T07:30:00Z"), NY)).toEqual({ year: 2026, month: 3, day: 8, hour: 3, minute: 30, weekday: 0 });
  });

  it("날짜만 값은 시간대와 상관없이 같은 날을 가리킨다", () => {
    const due = dateOnly(2026, 9, 18);
    expect(dateOnlyToString(addDays(due, 1))).toBe("2026-09-19");
  });
});

describe("주간보고서 주 범위는 작성자 시간대", () => {
  // 뉴욕 일요일 밤 11시(EDT)에 끝낸 일. 서울로는 이미 다음 주 월요일 낮이다.
  const task = { id: "t", isCompleted: true, completedAt: "2026-09-14T03:00:00.000Z" } as unknown as SourceTask;
  const week = dateOnly(2026, 9, 7); // 9/7(월) ~ 9/13(일)

  it("뉴욕 작성자에게는 이번 주 완료, 서울 작성자에게는 다음 주 일", () => {
    expect(classify(task, week, NY)?.key).toBe("done");
    expect(classify(task, week, SEOUL)).toBeNull();
    expect(classify(task, week)).toBeNull(); // 기본은 서울
  });
});
