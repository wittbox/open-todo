// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TaskDetail } from "@/lib/queries/list";
import { DetailPane } from "@/components/detail-pane/DetailPane";

/**
 * 달력의 작업 모달(2026-10-20).
 *
 * 오른쪽 상세 창 대신 가운데 넓은 두 단 모달. 덮개를 눌러도 닫히지 않고 ✕ · Esc 로 닫는다.
 * Esc 는 열린 고르기 창부터 닫는다.
 */

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams("from=2026-10-18&task=t1"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/task", () => {
  const ok = async () => ({ ok: true });
  return {
    createStep: ok, updateStep: ok, deleteAttachment: ok, deleteStep: ok, deleteTask: ok,
    setAssignee: ok, setReminder: ok, setRepeat: ok, updateTask: ok,
  };
});
vi.mock("@/lib/actions/session-guard", () => ({
  runAction: (fn: () => unknown) => fn(),
  handledAuthFailure: () => false,
}));

beforeEach(() => nav.replace.mockClear());
afterEach(cleanup);

function detail(p: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: "t1", seq: 323, title: "PDF 머리글 사라짐", note: null, isImportant: false, isCompleted: false,
    completedAt: null, dueDate: "2026-10-20", startDate: null, inMyDay: false, order: "a0", createdAt: "2026-10-13T00:00:00.000Z",
    listId: "l1", listName: "기능 구현", groupName: null, stepCount: 0, stepDoneCount: 0,
    assignee: null, repeat: null, attachmentCount: 0, remindAt: null, listOwnerName: null,
    steps: [], attachments: [],
    ...p,
  };
}

describe("달력의 작업 모달 (2026-10-20)", () => {
  it("가운데 모달 — 왼쪽 제목·단계·메모, 오른쪽 기한·담당·파일", () => {
    render(<DetailPane task={detail()} canWrite variant="modal" />);
    const dialog = screen.getByRole("dialog", { name: "PDF 머리글 사라짐" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByRole("textbox", { name: "작업 이름" })).toBeTruthy();
    expect(within(dialog).getByText(/기한 10월 20일/)).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("메모 추가")).toBeTruthy();
    expect(document.querySelector("aside")).toBeNull();
  });

  it("덮개를 눌러도 닫히지 않는다. ✕ 로 닫으면 주소에서 task 만 빠진다", () => {
    render(<DetailPane task={detail()} canWrite variant="modal" />);
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.click(backdrop);
    fireEvent.mouseDown(backdrop);
    expect(nav.replace).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));
    expect(nav.replace).toHaveBeenCalledWith("/calendar?from=2026-10-18", { scroll: false });
  });

  it("Esc 는 열린 고르기 창부터, 그다음 모달을 닫는다", () => {
    render(<DetailPane task={detail()} canWrite variant="modal" />);
    fireEvent.click(screen.getByText(/기한 10월 20일/));
    expect(screen.getByText("기한 지우기")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("기한 지우기")).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(nav.replace).toHaveBeenCalledWith("/calendar?from=2026-10-18", { scroll: false });
  });

  it("목록 화면은 지금처럼 오른쪽 창(덮개를 누르면 닫힘)", () => {
    render(<DetailPane task={detail()} canWrite />);
    expect(document.querySelector("aside")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(document.querySelector("[data-pane-backdrop]")!);
    expect(nav.replace).toHaveBeenCalled();
  });
});
