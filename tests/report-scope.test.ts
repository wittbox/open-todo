import { describe, expect, it } from "vitest";
import { parseScope, EMPTY_SCOPE } from "@/lib/queries/report";
import { nextSectionOverride, type SourceTask } from "@/lib/report/aggregate";
import { dateOnly } from "@/lib/date";

/**
 * 집계 범위.
 *
 * 예전에는 groupIds 가 비어 있으면 "전체"였다. 그러면 "아무것도 안 고름"을 적을
 * 자리가 없어서 전체를 해제할 수 없었고, 전체 상태에서 하나를 빼면 그 하나만
 * 남았다 — 해제하려던 것만 켜지는 셈이었다. 두 상태를 갈라 둔 뒤의 규칙을 고정한다.
 */

describe("저장된 값 읽기", () => {
  it("아무것도 없으면 전체", () => {
    expect(parseScope(null)).toEqual(EMPTY_SCOPE);
    expect(parseScope({})).toEqual(EMPTY_SCOPE);
    expect(parseScope(undefined).allGroups).toBe(true);
  });

  it("예전 값(빈 배열)은 전체로 읽는다 — 이미 만든 보고서가 바뀌면 안 된다", () => {
    const s = parseScope({ groupIds: [], excludedTaskIds: [], comments: {} });
    expect(s.allGroups).toBe(true);
  });

  it("예전 값에 그룹이 있으면 그것만 고른 상태다", () => {
    const s = parseScope({ groupIds: ["g1", "g2"] });
    expect(s.allGroups).toBe(false);
    expect(s.groupIds).toEqual(["g1", "g2"]);
  });

  it("새 값은 적힌 대로 읽는다 — 전체 해제(아무것도 안 고름)도 그대로", () => {
    const none = parseScope({ allGroups: false, groupIds: [] });
    expect(none.allGroups).toBe(false);
    expect(none.groupIds).toEqual([]);

    const all = parseScope({ allGroups: true, groupIds: [] });
    expect(all.allGroups).toBe(true);
  });

  it("문자열이 아닌 값은 버린다", () => {
    const s = parseScope({ allGroups: false, groupIds: ["g1", 3, null, "g2"] });
    expect(s.groupIds).toEqual(["g1", "g2"]);
  });

  it("손으로 옮긴 구간을 읽는다. 모르는 값은 버린다", () => {
    const s = parseScope({
      sections: { t1: "upcoming", t2: "inProgress", t3: "done", t4: "아무말" },
    });
    // done 은 옮길 수 있는 구간이 아니다 — 완료는 사실이라 판단할 여지가 없다.
    expect(s.sections).toEqual({ t1: "upcoming", t2: "inProgress" });
  });

  it("예전 보고서에는 이 칸이 없다 — 빈 값으로 읽는다", () => {
    expect(parseScope({ groupIds: ["g1"] }).sections).toEqual({});
  });
});

/**
 * 손으로 옮긴 자리를 저장하는 규칙.
 * 자동 분류와 같은 자리로 되돌리면 표시가 남지 않아야 한다.
 */
describe("구간 직접 옮기기", () => {
  const WEEK = dateOnly(2026, 8, 10);
  // 기한이 다음 주 — 자동으로는 예정이다.
  const task: SourceTask = {
    id: "t1", seq: 1, title: "작업", listId: "l1", listName: "목록", groupName: null,
    isCompleted: false, completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    dueDate: "2026-08-20", steps: [],
  };

  it("자동 분류와 다른 자리로 옮기면 저장한다", () => {
    expect(nextSectionOverride(task, WEEK, "inProgress", {})).toEqual({ t1: "inProgress" });
  });

  it("자동 분류와 같은 자리로 되돌리면 표시를 지운다", () => {
    const moved = nextSectionOverride(task, WEEK, "inProgress", {});
    expect(nextSectionOverride(task, WEEK, "upcoming", moved)).toEqual({});
  });

  it("다른 작업의 표시는 건드리지 않는다", () => {
    expect(nextSectionOverride(task, WEEK, "inProgress", { other: "upcoming" })).toEqual({
      other: "upcoming",
      t1: "inProgress",
    });
  });
});

/**
 * 화면의 체크 규칙. ReportEditor 의 toggleGroup 과 같은 계산을 여기서 못박는다.
 * 컴포넌트를 띄우지 않고도 "무엇이 켜지는가"를 검사할 수 있게 뽑아 둔 형태다.
 */
function toggleGroup(
  scope: { allGroups: boolean; groupIds: string[] },
  all: string[],
  id: string,
): { allGroups: boolean; groupIds: string[] } {
  const selected = scope.allGroups ? all : scope.groupIds;
  const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  return {
    allGroups: next.length === all.length,
    groupIds: next.length === all.length ? [] : next,
  };
}

describe("그룹 하나 켜고 끄기", () => {
  const ALL = ["a", "b", "c"];

  it("전체에서 하나를 빼면 나머지가 남는다", () => {
    const r = toggleGroup({ allGroups: true, groupIds: [] }, ALL, "b");
    expect(r.allGroups).toBe(false);
    expect(r.groupIds).toEqual(["a", "c"]);
  });

  it("하나만 남기고 또 빼도 남은 것이 유지된다", () => {
    let s = toggleGroup({ allGroups: true, groupIds: [] }, ALL, "b");
    s = toggleGroup(s, ALL, "c");
    expect(s.groupIds).toEqual(["a"]);
  });

  it("다시 전부 고르면 전체로 돌아간다", () => {
    let s = toggleGroup({ allGroups: true, groupIds: [] }, ALL, "b");
    s = toggleGroup(s, ALL, "b");
    expect(s.allGroups).toBe(true);
    expect(s.groupIds).toEqual([]);
  });

  it("아무것도 안 고른 상태에서 하나를 켜면 그것만 켜진다", () => {
    const r = toggleGroup({ allGroups: false, groupIds: [] }, ALL, "b");
    expect(r.allGroups).toBe(false);
    expect(r.groupIds).toEqual(["b"]);
  });
});
