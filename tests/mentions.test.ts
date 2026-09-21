import { describe, expect, it } from "vitest";
import { encodeMentions, extractMentions, tokenIds } from "@/lib/mentions";

/**
 * 멘션 토큰 규칙. 비공개 프로젝트의 청중이 멘션으로 넓어지면 안 되고(비멤버는 평문),
 * 자기 자신은 알림 대상이 아니며, 손으로 친 @이름은 멘션이 아니다.
 */
const A = "u1aaaaaaaaaaaaaaaaaaaaa";
const B = "u2bbbbbbbbbbbbbbbbbbbbb";
const OUT = "u3ccccccccccccccccccccc"; // 멤버 아님
const GHOST = "u4ddddddddddddddddddddd"; // 아무도 모름
const members = new Map([[A, "오세린"], [B, "최민아"]]);
const known = new Map([[OUT, "윤재원"]]);

describe("extractMentions", () => {
  it("멤버 토큰은 멘션, 비멤버는 평문 이름, 모르는 id 는 지운다", () => {
    const r = extractMentions(`<@${A}> 확인 <@${OUT}> 도 <@${GHOST}> 끝`, { members, known, authorId: B });
    expect(r.userIds).toEqual([A]);
    expect(r.body).toBe(`<@${A}> 확인 @윤재원 도  끝`);
    expect(r.all).toBe(false);
  });

  it("자기 자신은 대상이 아니고, 같은 사람은 한 번만", () => {
    const r = extractMentions(`<@${B}> <@${A}> <@${A}>`, { members, authorId: B });
    expect(r.userIds).toEqual([A]);
    expect(r.body).toBe(`<@${B}> <@${A}> <@${A}>`);
  });

  it("<@all> 은 전체이고 토큰은 남는다", () => {
    const r = extractMentions("<@all> 회의", { members, authorId: A });
    expect(r.all).toBe(true);
    expect(r.body).toBe("<@all> 회의");
  });

  it("손으로 친 @이름은 멘션이 아니다", () => {
    const r = extractMentions("@오세린 확인해요", { members, authorId: B });
    expect(r.userIds).toEqual([]);
  });

  it("21명 넘게 부르면 tooMany", () => {
    const many = new Map(Array.from({ length: 25 }, (_, i) => [`m${String(i).padStart(21, "0")}`, `사람${i}`]));
    const body = [...many.keys()].map((id) => `<@${id}>`).join(" ");
    expect(extractMentions(body, { members: many, authorId: "x" }).tooMany).toBe(25);
  });

  it("tokenIds 는 all 을 빼고 중복 없이", () => {
    expect(tokenIds(`<@${A}> <@all> <@${A}> <@${B}>`)).toEqual([A, B]);
  });
});

describe("encodeMentions", () => {
  it("고른 사람의 @이름만 토큰으로, 고른 순서대로 한 번씩", () => {
    const out = encodeMentions("@오세린 과 @오세린 그리고 @전체 @손으로", [
      { name: "오세린", id: A },
      { name: "오세린", id: B },
      { name: "전체", id: "all" },
    ]);
    expect(out).toBe(`<@${A}> 과 <@${B}> 그리고 <@all> @손으로`);
  });
});
