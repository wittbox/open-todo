// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IssueDetail, IssueLabelItem } from "@/lib/queries/issues";
import type { ProjectMemberItem } from "@/lib/queries/project";

/**
 * 이슈 상세 창. 해결됨이 되면 보고자(와 관리자)에게만 "확인하고 닫기 · 다시 열기",
 * 상태·담당자를 바꾸면 그대로 서버로, 보관된 프로젝트는 고칠 칸이 잠긴다. 본문의 "## 소제목" 은 소제목으로.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/p1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const calls = vi.hoisted(() => ({ update: vi.fn(), addLabel: vi.fn() }));
vi.mock("@/lib/actions/issue", () => {
  const ok = async () => ({ ok: true, data: null });
  return {
    updateIssueAction: async (...a: unknown[]) => (calls.update(...a), { ok: true, data: null }),
    addIssueLabelAction: async (...a: unknown[]) => (calls.addLabel(...a), { ok: true, data: { id: "new" } }),
    issueImageLinksAction: async () => ({ ok: true, data: [{ name: "화면.png", size: 2048, path: "/api/shared-file/f1?e=9&s=sig" }] }),
    addCommentAction: ok, deleteCommentAction: ok, deleteIssueAction: ok, editCommentAction: ok, setWatchingAction: ok,
  };
});
vi.mock("@/lib/actions/session-guard", () => ({ runAction: (fn: () => unknown) => fn(), handledAuthFailure: () => false }));

const { IssuePage } = await import("@/components/issues/IssuePage");

beforeEach(() => {
  calls.update.mockClear();
  calls.addLabel.mockClear();
});
afterEach(cleanup);

const person = (id: string, name: string) => ({ id, name, avatarColor: "#2564cf" });
const member = (userId: string, name: string, isMe = false): ProjectMemberItem => ({
  userId, name, email: `${userId}@x.test`, avatarColor: "#2564cf", department: null, role: "MEMBER", isOwner: false, isMe, disabled: false,
});
const MEMBERS = [member("rep", "김하늘", true), member("dev", "이준")];

function issue(p: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: "i1", number: 22, ref: "BUG-22", title: "회차가 두 번 생김", body: "## 재현 순서\n1. 끌어 놓는다\n## 실제 결과\n두 개",
    status: "OPEN", priority: "HIGH", assigneeId: "dev", assignee: person("dev", "이준"), reporter: person("rep", "김하늘"),
    labelIds: [], dueDate: null, commentCount: 0, createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z",
    attachments: [], events: [], people: [], watcherCount: 0, isWatching: false, canDelete: true, sourceMessageId: null, ...p,
  };
}

const show = (i: IssueDetail, o: { meId?: string; isAdmin?: boolean; readOnly?: boolean; labels?: IssueLabelItem[] } = {}) =>
  render(
    <IssuePage projectId="p1" projectName="시험 프로젝트" stamp="0" issue={i} issueKey="BUG" labels={o.labels ?? []} members={MEMBERS} meId={o.meId ?? "rep"} isAdmin={o.isAdmin ?? false} readOnly={o.readOnly ?? false} />,
  );

const LABELS: IssueLabelItem[] = [
  { id: "bug", name: "버그", color: "red" },
  { id: "imp", name: "개선", color: "yellow" },
  { id: "q", name: "질문", color: "blue" },
];

describe("이슈 페이지", () => {
  it("해결됨이면 보고자에게 '확인하고 닫기' — 누르면 닫힘으로", () => {
    show(issue({ status: "RESOLVED" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 닫기" }));
    expect(calls.update).toHaveBeenCalledWith("i1", { status: "CLOSED" });
  });

  it("보고자도 관리자도 아니면 배너가 없다. 관리자면 있다", () => {
    show(issue({ status: "RESOLVED" }), { meId: "dev" });
    expect(screen.queryByRole("button", { name: "확인하고 닫기" })).toBeNull();
    cleanup();
    show(issue({ status: "RESOLVED" }), { meId: "dev", isAdmin: true });
    expect(screen.getByRole("button", { name: "다시 열기" })).toBeTruthy();
  });

  it("자동 새로고침으로 남이 바꾼 제목은 따라가고, 내가 고치던 제목은 두고", () => {
    const pane = (i: IssueDetail) => (
      <IssuePage projectId="p1" projectName="시험 프로젝트" stamp="0" issue={i} issueKey="BUG" labels={[]} members={MEMBERS} meId="rep" isAdmin={false} readOnly={false} />
    );
    const { rerender } = render(pane(issue()));
    const input = () => screen.getByRole("textbox", { name: "이슈 제목" }) as HTMLTextAreaElement;
    rerender(pane(issue({ title: "남이 고친 제목" })));
    expect(input().value).toBe("남이 고친 제목");
    fireEvent.change(input(), { target: { value: "내가 쓰는 중" } });
    rerender(pane(issue({ title: "또 바뀐 제목" })));
    expect(input().value).toBe("내가 쓰는 중");
  });

  it("상태·담당자를 바꾸면 그대로 서버로", () => {
    show(issue());
    fireEvent.change(screen.getByRole("combobox", { name: "상태 바꾸기" }), { target: { value: "IN_PROGRESS" } });
    expect(calls.update).toHaveBeenCalledWith("i1", { status: "IN_PROGRESS" });
    fireEvent.change(screen.getByRole("combobox", { name: "담당자" }), { target: { value: "" } });
    expect(calls.update).toHaveBeenCalledWith("i1", { assigneeId: null });
  });

  it("본문의 '## 소제목' 은 소제목으로 그린다", () => {
    show(issue());
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["재현 순서", "실제 결과"]);
    expect(screen.queryByText(/##/)).toBeNull();
  });

  it("보관된 프로젝트는 고칠 칸이 잠기고 상태 고르기·지우기가 없다", () => {
    show(issue(), { readOnly: true });
    expect((screen.getByRole("textbox", { name: "이슈 제목" }) as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByRole("combobox", { name: "상태 바꾸기" })).toBeNull();
    expect((screen.getByRole("combobox", { name: "담당자" }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "이슈 지우기" })).toBeNull();
  });

  it("활동: 바뀐 기록은 사람이 읽는 말로", () => {
    show(
      issue({
        events: [
          { id: "e1", kind: "CREATED", actor: person("rep", "김하늘"), body: "", fromValue: null, toValue: null, createdAt: "2026-10-07T00:00:00.000Z", editedAt: null, deleted: false, isMine: true, attachments: [] },
          { id: "e2", kind: "ASSIGNEE", actor: person("rep", "김하늘"), body: "", fromValue: null, toValue: "dev", createdAt: "2026-10-07T00:01:00.000Z", editedAt: null, deleted: false, isMine: true, attachments: [] },
        ],
      }),
    );
    // 만듦은 제목 아래 한 줄로("…님이 … 열었다") — 타임라인에는 바뀐 기록만
    expect(screen.getByText(/열었다/)).toBeTruthy();
    expect(screen.queryByText(/이슈를 열었습니다/)).toBeNull();
    expect(screen.getByText(/이준님에게 맡겼습니다/)).toBeTruthy();
    expect(document.querySelectorAll("[data-event]")).toHaveLength(1);
  });

  const comment = (id: string, body: string, at: string) => ({
    id, kind: "COMMENT" as const, actor: person("dev", "이준"), body, fromValue: null, toValue: null, createdAt: at,
    editedAt: null, deleted: false, isMine: false, attachments: [],
  });

  it("타임라인: 댓글 카드 사이에 바뀐 기록이 시간순으로, 그 끝에 댓글 입력", () => {
    show(
      issue({
        events: [
          comment("c1", "재현됩니다", "2026-10-07T00:02:00.000Z"),
          { id: "e3", kind: "STATUS", actor: person("dev", "이준"), body: "", fromValue: "OPEN", toValue: "IN_PROGRESS", createdAt: "2026-10-07T00:03:00.000Z", editedAt: null, deleted: false, isMine: false, attachments: [] },
          comment("c2", "고쳤어요", "2026-10-07T00:04:00.000Z"),
        ],
      }),
    );
    const items = [...screen.getByRole("list", { name: "활동" }).children].map((li) =>
      li.hasAttribute("data-comment") ? `댓글:${li.textContent?.includes("재현") ? 1 : 2}` : li.hasAttribute("data-event") ? "기록" : "입력",
    );
    expect(items).toEqual(["댓글:1", "기록", "댓글:2", "입력"]);
    expect(screen.getByRole("textbox", { name: /댓글 쓰기/ })).toBeTruthy();
  });

  it("입력창 옆 상태 버튼 — 열림·진행 중이면 '해결됨으로', 닫힘이면 '다시 열기'", () => {
    show(issue({ status: "IN_PROGRESS" }));
    fireEvent.click(screen.getByRole("button", { name: /해결됨으로/ }));
    expect(calls.update).toHaveBeenCalledWith("i1", { status: "RESOLVED" });
    cleanup();
    show(issue({ status: "CLOSED" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 열기" }));
    expect(calls.update).toHaveBeenCalledWith("i1", { status: "OPEN" });
  });

  it("사진은 본문 폭으로 크게(누르면 보기 창), 다른 파일은 칩", () => {
    show(
      issue({
        attachments: [
          { id: "f1", name: "빈화면.png", size: 2048, mimeType: "image/png", createdAt: "2026-10-07T00:00:00.000Z", uploaderName: "김하늘" },
          { id: "f2", name: "log.txt", size: 100, mimeType: "text/plain", createdAt: "2026-10-07T00:00:00.000Z", uploaderName: "김하늘" },
        ] as never,
      }),
    );
    expect(document.querySelector("figure img")?.getAttribute("src")).toBe("/api/files/f1");
    expect(screen.getByText(/빈화면\.png ·/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /log\.txt/ }).getAttribute("href")).toBe("/api/files/f2");
    fireEvent.click(screen.getByRole("button", { name: "빈화면.png 보기" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("'← 이슈 목록' 과 메시지에서 만든 이슈의 원래 메시지 링크", () => {
    show(issue({ sourceMessageId: "m1" }));
    expect(screen.getByRole("link", { name: "← 이슈 목록" }).getAttribute("href")).toBe("/projects/p1?tab=issues");
    expect(screen.getByRole("link", { name: /원래 메시지/ }).getAttribute("href")).toBe("/projects/p1?msg=m1");
  });
});

describe("라벨 고르기 (2026-10-13)", () => {
  it("늘 펼쳐 두고 누르면 붙이고 떼기 — ‘고치기’·‘다 됐음’ 이 없다", () => {
    show(issue({ labelIds: ["bug"] }), { labels: LABELS });
    expect(screen.queryByRole("button", { name: "고치기" })).toBeNull();
    expect(screen.getByRole("button", { name: "✓버그" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "개선" }));
    expect(calls.update).toHaveBeenLastCalledWith("i1", { labelIds: ["bug", "imp"] });
    cleanup(); // 저장 중에는 잠기므로 새로 그려서 떼기를 본다
    show(issue({ labelIds: ["bug"] }), { labels: LABELS });
    fireEvent.click(screen.getByRole("button", { name: "✓버그" }));
    expect(calls.update).toHaveBeenLastCalledWith("i1", { labelIds: [] });
  });

  it("‘＋ 새 라벨’ — 이름을 쓰고 Enter 면 만들고 붙인다(아직 안 쓴 색이 골라져 있다)", async () => {
    show(issue(), { labels: LABELS });
    fireEvent.click(screen.getByRole("button", { name: "＋ 새 라벨" }));
    expect(screen.getByRole("radio", { checked: true }).getAttribute("aria-label")).toBe("orange");
    fireEvent.change(screen.getByLabelText("새 라벨 이름"), { target: { value: "화면 깨짐" } });
    fireEvent.keyDown(screen.getByLabelText("새 라벨 이름"), { key: "Enter" });
    expect(calls.addLabel).toHaveBeenCalledWith("i1", { name: "화면 깨짐", color: "orange" });
    await waitFor(() => expect(screen.queryByLabelText("새 라벨 이름")).toBeNull());
  });

  it("읽기만 하면 붙은 라벨만, 새 라벨 버튼 없음", () => {
    show(issue({ labelIds: ["q"] }), { labels: LABELS, readOnly: true });
    expect(screen.getByText("질문")).toBeTruthy();
    expect(screen.queryByText("개선")).toBeNull();
    expect(screen.queryByRole("button", { name: "＋ 새 라벨" })).toBeNull();
  });
});

describe("Claude Code 용 복사 (2026-10-13)", () => {
  it("머리말·본문을 마크다운으로, 본문 사진은 임시 링크로 복사한다", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      show(issue({ attachments: [{ id: "f1", name: "화면.png", size: 2048, mimeType: "image/png", uploaderName: null, createdAt: "" }] }));
      fireEvent.click(screen.getByRole("button", { name: "Claude Code 용 복사" }));
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      const text = (writeText.mock.calls[0] as unknown as [string])[0];
      expect(text).toContain("# BUG-22 회차가 두 번 생김");
      expect(text).toContain("- 프로젝트: 시험 프로젝트 · 상태: 열림 · 우선순위: 높음");
      expect(text).toContain("## 재현 순서");
      expect(text).toContain(`- 화면.png (2 KB): ${window.location.origin}/api/shared-file/f1?e=9&s=sig`);
      expect(await screen.findByText(/사진 1장은 24시간 동안 열리는 링크/)).toBeTruthy();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});

describe("나에게 할당됨의 이슈 묶음", () => {
  it("이슈 수와 줄 — 번호·제목·프로젝트, 누르면 그 이슈로, 기한 지남은 붉게", async () => {
    const { MyIssueRows } = await import("@/components/issues/MyIssueRows");
    render(
      <MyIssueRows
        today="2026-10-08"
        issues={[
          { id: "a", ref: "BUG-3", number: 3, title: "진행 중인 것", status: "IN_PROGRESS", priority: "HIGH", dueDate: "2026-10-01", projectId: "p1", projectName: "버그 리포트", href: "/projects/p1?tab=issues&issue=3" },
          { id: "b", ref: "BUG-4", number: 4, title: "열린 것", status: "OPEN", priority: "NORMAL", dueDate: null, projectId: "p1", projectName: "버그 리포트", href: "/projects/p1?tab=issues&issue=4" },
        ]}
      />,
    );
    expect(screen.getByText("이슈").parentElement?.textContent).toContain("2");
    const first = screen.getByRole("link", { name: /BUG-3/ });
    expect(first.getAttribute("href")).toBe("/projects/p1?tab=issues&issue=3");
    expect(first.querySelector('[class*="--overdue"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: /BUG-4/ }).querySelector('[class*="--overdue"]')).toBeNull();
  });
});
