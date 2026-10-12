import { describe, expect, it } from "vitest";
import { addDaysKey, daysBetweenKeys, layoutSpans, weekGrid } from "@/lib/calendar";

/**
 * 여러 날 작업의 막대 배치(2026-10-13). 주마다 끊고, 이어지는 쪽을 표시하고, 겹치면 층을 나눈다.
 */
const grid = weekGrid(new Date("2026-10-04T00:00:00.000Z")); // 10/4(일)부터 5주

describe("layoutSpans", () => {
  it("한 주 안의 3일짜리는 한 조각 — 시작·끝 모두 이 줄", () => {
    const { segments, lanes } = layoutSpans(grid.weeks, [{ id: "a", start: "2026-10-05", end: "2026-10-07" }]);
    expect(segments).toEqual([{ id: "a", week: 0, colStart: 1, colEnd: 3, lane: 0, startsHere: true, endsHere: true }]);
    expect(lanes.slice(0, 2)).toEqual([1, 0]);
  });

  it("주를 넘으면 두 조각 — 앞은 ▶, 뒤는 ◀", () => {
    const { segments } = layoutSpans(grid.weeks, [{ id: "b", start: "2026-10-08", end: "2026-10-14" }]);
    expect(segments).toEqual([
      { id: "b", week: 0, colStart: 4, colEnd: 6, lane: 0, startsHere: true, endsHere: false },
      { id: "b", week: 1, colStart: 0, colEnd: 3, lane: 0, startsHere: false, endsHere: true },
    ]);
  });

  it("겹치면 아래 층으로, 안 겹치면 같은 층을 다시 쓴다", () => {
    const { segments, lanes } = layoutSpans(grid.weeks, [
      { id: "long", start: "2026-10-05", end: "2026-10-09" },
      { id: "mid", start: "2026-10-07", end: "2026-10-08" },
      { id: "late", start: "2026-10-10", end: "2026-10-11" },
    ]);
    const lane = (id: string, week = 0) => segments.find((s) => s.id === id && s.week === week)!.lane;
    expect(lane("long")).toBe(0);
    expect(lane("mid")).toBe(1);
    expect(lane("late")).toBe(0); // 토요일은 비어 있다
    expect(lanes[0]).toBe(2);
  });

  it("보는 기간 밖에서 시작·끝나도 보이는 부분만", () => {
    const { segments } = layoutSpans(grid.weeks, [{ id: "c", start: "2026-09-20", end: "2026-10-05" }]);
    expect(segments).toEqual([{ id: "c", week: 0, colStart: 0, colEnd: 1, lane: 0, startsHere: false, endsHere: true }]);
  });

  it("날짜 문자열 계산", () => {
    expect(daysBetweenKeys("2026-10-05", "2026-10-07")).toBe(2);
    expect(daysBetweenKeys("2026-10-28", "2026-11-02")).toBe(5);
    expect(addDaysKey("2026-10-30", 3)).toBe("2026-11-02");
  });
});
