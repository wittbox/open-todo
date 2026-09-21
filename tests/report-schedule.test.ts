import { describe, expect, it } from "vitest";
import {
  checkScheduleAt,
  earliestSlot,
  slotToInstant,
  nextAttemptAt,
  scheduleLabel,
  timeSlots,
} from "@/lib/report/schedule";
import { isDue } from "@/lib/report/scheduled-sends";

/**
 * 예약 발송의 시각 규칙.
 *
 * 예약은 우리 서버가 5분마다 대신 보낸다. 시각은 한국 시간으로
 * 고르고 UTC 로 저장하므로, 경계(자정·10분 눈금)가 어긋나기 쉬운 자리를 여기서 못박는다.
 */

// 2026-09-11(금) 17:03 한국 시간
const NOW = new Date("2026-09-11T08:03:00.000Z");

describe("예약 시각 따지기", () => {
  it("10분 뒤 이후, 10분 눈금이면 받는다", () => {
    const r = checkScheduleAt("2026-09-11T08:20:00.000Z", NOW);
    expect(r.ok).toBe(true);
  });

  it("10분 눈금이 아니면 거절한다", () => {
    const r = checkScheduleAt("2026-09-11T08:25:00.000Z", NOW);
    // 문구가 아니라 번역 열쇠로 돌려준다 — 보는 사람의 언어로 바꾸는 것은 부르는 쪽 몫이다.
    expect(r).toEqual({ ok: false, key: "reports.errors.scheduleStep", values: { step: 10 } });
  });

  it("지금부터 10분이 안 되면 거절한다 — 누르자마자 나가는 예약은 예약이 아니다", () => {
    const r = checkScheduleAt("2026-09-11T08:10:00.000Z", NOW);
    expect(r.ok).toBe(false);
  });

  it("30일 넘게 먼 예약은 거절한다", () => {
    expect(checkScheduleAt("2026-10-12T08:00:00.000Z", NOW).ok).toBe(false);
    expect(checkScheduleAt("2026-10-11T08:00:00.000Z", NOW).ok).toBe(true);
  });

  it("시각이 아닌 값은 거절한다", () => {
    expect(checkScheduleAt("내일 오후", NOW).ok).toBe(false);
    expect(checkScheduleAt(12345, NOW).ok).toBe(false);
  });
});

describe("한국 시간 ↔ 실제 시각", () => {
  it("달력의 날짜와 17:00(한국) 은 UTC 08:00 이다", () => {
    const day = new Date(Date.UTC(2026, 8, 12));
    expect(slotToInstant(day, "17:00").toISOString()).toBe("2026-09-12T08:00:00.000Z");
  });

  it("한국 새벽 시각은 UTC 로 전날이다", () => {
    const day = new Date(Date.UTC(2026, 8, 12));
    expect(slotToInstant(day, "07:30").toISOString()).toBe("2026-09-11T22:30:00.000Z");
  });

  it("가장 이른 예약 가능 시각은 10분 뒤를 10분 눈금으로 올린 것", () => {
    // 17:03 + 10분 = 17:13 → 17:20
    const e = earliestSlot(NOW);
    expect(e.hhmm).toBe("17:20");
    expect(e.day.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("한국 자정을 넘기면 날짜도 넘어간다", () => {
    // 23:55 한국 → 00:05 + 10분 올림 → 다음 날 00:10
    const e = earliestSlot(new Date("2026-09-11T14:55:00.000Z"));
    expect(e.hhmm).toBe("00:10");
    expect(e.day.toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });

  it("표기는 한국 시간 요일까지", () => {
    expect(scheduleLabel(new Date("2026-09-12T08:00:00.000Z"))).toBe("9/12(토) 17:00");
  });

  it("하루치 눈금은 144개, 00:00 부터 23:50 까지", () => {
    const t = timeSlots();
    expect(t).toHaveLength(144);
    expect([t[0], t[t.length - 1]]).toEqual(["00:00", "23:50"]);
  });
});

describe("다시 시도", () => {
  it("실패하면 10분 뒤, 세 번까지", () => {
    expect(nextAttemptAt(1, NOW)?.toISOString()).toBe("2026-09-11T08:13:00.000Z");
    expect(nextAttemptAt(3, NOW)).toBeNull();
  });

  it("원래 예약 시각은 그대로 두고, 시도 횟수만큼 뒤로 미룬다", () => {
    const at = new Date("2026-09-11T08:00:00.000Z");
    expect(isDue({ scheduledAt: at, attempts: 0 }, NOW)).toBe(true);
    // 한 번 실패 → 08:10 부터
    expect(isDue({ scheduledAt: at, attempts: 1 }, NOW)).toBe(false);
    expect(isDue({ scheduledAt: at, attempts: 1 }, new Date("2026-09-11T08:10:00.000Z"))).toBe(true);
  });

  it("예약 시각이 없는 줄은 때가 오지 않는다", () => {
    expect(isDue({ scheduledAt: null, attempts: 0 }, NOW)).toBe(false);
  });
});
