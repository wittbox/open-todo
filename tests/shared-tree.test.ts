import { describe, expect, it } from "vitest";
import { arrangeShared, type SharedRow } from "@/lib/shared-tree";

/**
 * 공유된 목록의 사이드바 배치.
 *
 * 신고(2026-09-14): 공유된 목록이 가나다순 두 줄이라 같은 그룹의 목록이 흩어졌다.
 * 내 목록처럼 그룹 아래에 모으고, 순서는 주인이 정한 그대로 둔다.
 */

const row = (
  name: string,
  order: string,
  ownerName: string,
  group: SharedRow<string>["group"] = null,
): SharedRow<string> => ({ item: name, order, ownerName, group });

const EDU = { id: "g-edu", name: "교육훈련", order: "a1" };
const SHIP = { id: "g-ship", name: "제품 출하", order: "a0" };

describe("공유된 목록 배치", () => {
  it("같은 그룹의 목록은 그룹 아래에 모이고, 그룹 밖 목록은 그 아래 — 들어온 순서가 섞여 있어도", () => {
    const t = arrangeShared([
      row("장비 관리", "a0", "김철수"),
      row("신입 교육", "a0", "김철수", EDU),
      row("출하검사", "a0", "김철수", SHIP),
      row("제품 교육", "a2", "김철수", EDU),
    ]);
    expect(t.groups.map((g) => [g.name, g.lists])).toEqual([
      ["제품 출하", ["출하검사"]],
      ["교육훈련", ["신입 교육", "제품 교육"]],
    ]);
    expect(t.lists).toEqual(["장비 관리"]);
  });

  it("순서는 주인이 정한 그대로 — 가나다순이 아니다", () => {
    const t = arrangeShared([
      row("안전 교육", "a0", "김철수", EDU),
      row("신입 교육", "a1", "김철수", EDU),
      row("재고 관리", "a0", "김철수"),
      row("장비 관리", "a1", "김철수"),
    ]);
    expect(t.groups[0].lists).toEqual(["안전 교육", "신입 교육"]);
    expect(t.lists).toEqual(["재고 관리", "장비 관리"]);
  });

  it("여러 사람에게서 받으면 주인 이름 순 — 이름이 같은 그룹이라도 주인이 다르면 따로", () => {
    const t = arrangeShared([
      row("신입 교육", "a0", "김철수", EDU),
      row("영업 신입 교육", "a0", "윤재원", { id: "g-edu-2", name: "교육훈련", order: "a0" }),
      row("견적 관리", "a0", "윤재원"),
      row("재고 관리", "a0", "김철수"),
    ]);
    expect(t.groups.map((g) => `${g.ownerName}/${g.name}/${g.lists.join(",")}`)).toEqual([
      "김철수/교육훈련/신입 교육",
      "윤재원/교육훈련/영업 신입 교육",
    ]);
    expect(t.lists).toEqual(["재고 관리", "견적 관리"]);
  });

  it("공유된 목록이 없으면 빈 트리", () => {
    expect(arrangeShared([])).toEqual({ groups: [], lists: [] });
  });
});
