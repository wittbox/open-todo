import { describe, expect, it } from "vitest";
import {
  countByState,
  describeEvent,
  filterIssues,
  issueRef,
  normalizeIssueKey,
  parseIssueRef,
  type IssueListRow,
} from "@/lib/issues/format";
import { translatorFor } from "@/i18n/server";

/**
 * 이슈 번호·거르기·정렬·활동 문구 — 순수 규칙.
 */

describe("번호", () => {
  it("약어-번호로 쓰고 읽는다. 소문자·앞뒤 공백도 받는다", () => {
    expect(issueRef("BUG", 23)).toBe("BUG-23");
    expect(parseIssueRef("BUG-23")).toEqual({ key: "BUG", number: 23 });
    expect(parseIssueRef(" bug-7 ")).toEqual({ key: "BUG", number: 7 });
    expect(parseIssueRef("Q2-1")).toEqual({ key: "Q2", number: 1 });
  });

  it("모양이 틀리면 null — 숫자로 시작하는 약어, 7자, 0번, 번호 없음", () => {
    for (const bad of ["2B-1", "TOOLONG-1", "BUG-0", "BUG-", "BUG23", "B-1", "#23"]) expect(parseIssueRef(bad)).toBeNull();
  });

  it("약어는 영문 대문자로 시작하는 2~6자", () => {
    expect(normalizeIssueKey(" bug ")).toBe("BUG");
    expect(normalizeIssueKey("QA2")).toBe("QA2");
    for (const bad of ["B", "1AB", "ABCDEFG", "버그", "AB-C", ""]) expect(normalizeIssueKey(bad)).toBeNull();
  });
});

const row = (p: Partial<IssueListRow> & { number: number }): IssueListRow => ({
  title: `이슈 ${p.number}`, body: "", status: "OPEN", priority: "NORMAL", assigneeId: null, labelIds: [],
  updatedAt: "2026-10-01T00:00:00.000Z", ...p,
});

const ROWS = [
  row({ number: 1, status: "CLOSED", title: "로그인 빈 화면" }),
  row({ number: 2, status: "OPEN", priority: "LOW", assigneeId: "u1", labelIds: ["bug"] }),
  row({ number: 3, status: "IN_PROGRESS", priority: "NORMAL", assigneeId: "u2", body: "PDF 머리글이 사라짐" }),
  row({ number: 4, status: "OPEN", priority: "URGENT", labelIds: ["bug", "ui"], updatedAt: "2026-10-02T00:00:00.000Z" }),
  row({ number: 5, status: "RESOLVED", priority: "HIGH", assigneeId: "u1" }),
  row({ number: 6, status: "OPEN", priority: "URGENT", updatedAt: "2026-10-03T00:00:00.000Z" }),
];
const nums = (rs: IssueListRow[]) => rs.map((r) => r.number);

describe("거르기·정렬", () => {
  it("열림 = 닫힘이 아닌 것(해결됨은 확인 대기라 열린 쪽). 정렬은 진행 중 → 열림 → 해결됨, 그 안에서 우선순위 → 최근 갱신", () => {
    expect(nums(filterIssues(ROWS, { state: "open" }, "BUG"))).toEqual([3, 6, 4, 2, 5]);
    expect(nums(filterIssues(ROWS, { state: "closed" }, "BUG"))).toEqual([1]);
    expect(filterIssues(ROWS, { state: "all" }, "BUG")).toHaveLength(6);
    expect(countByState(ROWS)).toEqual({ open: 5, closed: 1 });
  });

  it("담당자 · 담당자 없음 · 라벨 · 우선순위", () => {
    expect(nums(filterIssues(ROWS, { state: "all", assignee: "u1" }, "BUG"))).toEqual([2, 5]);
    expect(nums(filterIssues(ROWS, { state: "open", assignee: "none" }, "BUG"))).toEqual([6, 4]);
    expect(nums(filterIssues(ROWS, { state: "all", labelId: "ui" }, "BUG"))).toEqual([4]);
    expect(nums(filterIssues(ROWS, { state: "all", priority: "URGENT" }, "BUG"))).toEqual([6, 4]);
  });

  it("검색 — 제목·본문, 번호는 BUG-3 · 3 · #3 모두", () => {
    expect(nums(filterIssues(ROWS, { state: "all", q: "빈 화면" }, "BUG"))).toEqual([1]);
    expect(nums(filterIssues(ROWS, { state: "all", q: "pdf" }, "BUG"))).toEqual([3]);
    for (const q of ["BUG-3", "bug-3", "3", "#3"]) expect(nums(filterIssues(ROWS, { state: "all", q }, "BUG"))).toContain(3);
    expect(nums(filterIssues(ROWS, { state: "all", q: "BUG-3" }, "BUG"))).toEqual([3]);
  });
});

describe("활동 문구", () => {
  const nameOf = (id: string) => ({ u1: "이준", u2: "박서연" })[id] ?? "알 수 없음";
  const dateLabel = (ymd: string) => ymd.slice(5).replace("-", "/");
  const issuesT = (locale: "ko" | "en") => (key: string, values?: Record<string, string | number>) =>
    (translatorFor(locale) as unknown as (k: string, v?: Record<string, string | number>) => string)(`issues.${key}`, values);
  const say = (kind: string, fromValue: string | null, toValue: string | null) =>
    describeEvent({ kind, fromValue, toValue }, issuesT("ko"), nameOf, dateLabel);

  it("상태·우선순위는 한국어 이름으로", () => {
    expect(say("STATUS", "OPEN", "IN_PROGRESS")).toBe("상태: 열림 → 진행 중");
    expect(say("PRIORITY", "NORMAL", "URGENT")).toBe("우선순위: 보통 → 긴급");
  });

  it("담당자는 처음 맡김 · 바꿈 · 뺌을 가른다", () => {
    expect(say("ASSIGNEE", null, "u1")).toBe("이준님에게 맡겼습니다");
    expect(say("ASSIGNEE", "u1", "u2")).toBe("담당자: 이준 → 박서연");
    expect(say("ASSIGNEE", "u2", null)).toBe("담당자에서 박서연님을 뺐습니다");
  });

  it("라벨·기한·제목·만듦", () => {
    expect(say("LABELS", null, "버그, 화면")).toBe("라벨: 없음 → 버그, 화면");
    expect(say("DUE", null, "2026-10-10")).toBe("기한: 없음 → 10/10");
    expect(say("TITLE", "옛 제목", "새 제목")).toBe("제목을 바꿨습니다 — “옛 제목” → “새 제목”");
    expect(say("CREATED", null, null)).toBe("이슈를 열었습니다");
  });

  it("영어도 같은 열쇠로", () => {
    expect(describeEvent({ kind: "STATUS", fromValue: "OPEN", toValue: "RESOLVED" }, issuesT("en"), nameOf, dateLabel)).toBe(
      "status: Open → Resolved",
    );
  });
});
