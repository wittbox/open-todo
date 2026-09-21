import { describe, expect, it } from "vitest";
import { mergeMessages } from "@/lib/projects/merge";
import type { MessageItem } from "@/lib/queries/project";

/**
 * 폴링 결과 합치기.
 *
 * 화면이 숨겨져 있다가 다시 보이면 한 묶음에 원글(서버가 센 답글 수)과 그 답글이 같이 온다.
 * 그때 답글을 또 더하면 "답글 1개" 가 "2개" 가 됐다(2026-09-16 확인 중 발견).
 */
function m(id: string, over: Partial<MessageItem> = {}): MessageItem {
  return {
    id, seq: 1, parentId: null, author: null, body: id, createdAt: "2026-09-16T01:00:00.000Z",
    updatedAt: "2026-09-16T01:00:00.000Z", editedAt: null, deletedAt: null, pinnedAt: null, pinnedByName: null,
    replyCount: 0, lastReplyAt: null, mentionsAll: false, mentions: [], files: [], isMine: false, canDelete: false,
    ...over,
  };
}
const count = (map: Map<string, MessageItem>, id: string) => map.get(id)!.replyCount;

describe("폴링 합치기", () => {
  it("원글 없이 온 답글은 원글의 답글 수를 하나 올리고, 같은 답글이 또 와도 다시 올리지 않는다", () => {
    let map = new Map([["root", m("root")]]);
    map = mergeMessages(map, [m("r1", { parentId: "root" })]);
    expect(count(map, "root")).toBe(1);
    map = mergeMessages(map, [m("r1", { parentId: "root" })]);
    expect(count(map, "root")).toBe(1);
  });

  it("원글과 답글이 한 묶음에 오면 서버가 센 수를 믿고 더하지 않는다", () => {
    let map = new Map([["root", m("root")]]);
    map = mergeMessages(map, [m("root", { replyCount: 1 }), m("r1", { parentId: "root" })]);
    expect(count(map, "root")).toBe(1);
    // 뒤에 답글이 하나 더 오면 그때는 올린다
    map = mergeMessages(map, [m("r2", { parentId: "root" })]);
    expect(count(map, "root")).toBe(2);
  });

  it("지운 답글은 내리고, 답글 없는 삭제 원글은 사라지며, 답글 있는 삭제 원글은 남는다", () => {
    let map = new Map([["root", m("root")], ["lone", m("lone")]]);
    map = mergeMessages(map, [m("r1", { parentId: "root" })]);
    map = mergeMessages(map, [m("r1", { parentId: "root", deletedAt: "2026-09-16T02:00:00.000Z" })]);
    expect(count(map, "root")).toBe(0);
    map = mergeMessages(map, [
      m("lone", { deletedAt: "2026-09-16T02:00:00.000Z" }),
      m("root", { deletedAt: "2026-09-16T02:00:00.000Z", replyCount: 1 }),
    ]);
    expect(map.has("lone")).toBe(false);
    expect(map.get("root")?.deletedAt).not.toBeNull();
  });

  it("빈 묶음은 같은 Map 을 돌려준다", () => {
    const map = new Map([["root", m("root")]]);
    expect(mergeMessages(map, [])).toBe(map);
  });
});
