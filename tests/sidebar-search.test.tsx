// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SidebarSearchResult, IssueSearchHit } from "@/lib/queries/issues";
import type { SearchHit } from "@/lib/queries/tasks";

/**
 * 사이드바 검색 — 작업과 이슈를 묶음으로(묶음마다 5개, 더 있으면 펼치기). BUG-23 은 맨 위 "바로 이동".
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SearchBox } = await import("@/components/sidebar/Sidebar");

let answer: SidebarSearchResult;
beforeEach(() => {
  vi.useFakeTimers();
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => answer })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const task = (n: number): SearchHit => ({ id: `t${n}`, seq: n, title: `로그인 작업 ${n}`, listId: "l1", listName: "백로그", isCompleted: false });
const issue = (n: number, p: Partial<IssueSearchHit> = {}): IssueSearchHit => ({
  id: `i${n}`, ref: `BUG-${n}`, title: `로그인 이슈 ${n}`, status: "OPEN", projectName: "버그 리포트",
  href: `/projects/p1?tab=issues&issue=${n}`, inComment: false, ...p,
});

async function search(q: string) {
  render(<SearchBox />);
  fireEvent.change(screen.getByPlaceholderText("검색"), { target: { value: q } });
  await act(() => vi.advanceTimersByTimeAsync(300));
}

describe("사이드바 검색 — 작업·이슈 묶음", () => {
  it("묶음마다 5개, 나머지는 'N개 더 보기' 로 펼친다", async () => {
    answer = { jump: null, hits: [task(1), task(2)], issueJump: null, issues: Array.from({ length: 7 }, (_, i) => issue(i + 1)) };
    await search("로그인");
    expect(screen.getByText("작업 2")).toBeTruthy();
    expect(screen.getByText("이슈 7")).toBeTruthy();
    expect(document.querySelectorAll("[data-search-issue]")).toHaveLength(5);
    fireEvent.click(screen.getByText("이슈 2개 더 보기"));
    expect(document.querySelectorAll("[data-search-issue]")).toHaveLength(7);
  });

  it("이슈를 누르면 그 프로젝트의 이슈 탭으로. 댓글에서만 찾은 것은 그렇게 적는다", async () => {
    answer = { jump: null, hits: [], issueJump: null, issues: [issue(3, { inComment: true, status: "CLOSED" })] };
    await search("로그인");
    expect(screen.getByText("· 댓글에서")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-search-issue='BUG-3']")!);
    expect(push).toHaveBeenCalledWith("/projects/p1?tab=issues&issue=3");
  });

  it("BUG-23 은 맨 위 '바로 이동' — Enter 로 바로 간다", async () => {
    answer = { jump: null, hits: [], issueJump: issue(23), issues: [issue(2)] };
    await search("BUG-23");
    expect(screen.getByText("바로 이동")).toBeTruthy();
    expect(screen.getByText("로그인 이슈 23(으)로 이동")).toBeTruthy();
    fireEvent.keyDown(screen.getByPlaceholderText("검색"), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/projects/p1?tab=issues&issue=23");
  });

  it("작업만 있으면 지금처럼 — Enter 는 첫 작업", async () => {
    answer = { jump: null, hits: [task(9)], issueJump: null, issues: [] };
    await search("로그인");
    expect(screen.queryByText(/^이슈 /)).toBeNull();
    fireEvent.keyDown(screen.getByPlaceholderText("검색"), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/list/l1?task=t9");
  });

  it("아무것도 없으면 '결과가 없습니다.'", async () => {
    answer = { jump: null, hits: [], issueJump: null, issues: [] };
    await search("없는말");
    expect(screen.getByText("결과가 없습니다.")).toBeTruthy();
  });
});
