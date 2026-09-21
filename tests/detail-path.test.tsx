// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TaskDetail } from "@/lib/queries/list";
import { DetailPane } from "@/components/detail-pane/DetailPane";

/**
 * 상세 창 맨 윗줄의 목록 경로.
 *
 * 달력·오늘 할 일처럼 여러 목록이 섞이는 화면에서 작업을 열면 어느 그룹의 어느 목록
 * 작업인지 알 수 없었다(2026-09-12 요청). 경로를 보이고, 누르면 그 목록으로 가게 한다.
 */

let pathname = "/calendar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
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
    createStep: ok, deleteAttachment: ok, deleteStep: ok, deleteTask: ok, setAssignee: ok,
    setReminder: ok, setRepeat: ok, updateStep: ok, updateTask: ok,
  };
});
vi.mock("@/lib/actions/session-guard", () => ({
  runAction: (fn: () => unknown) => fn(),
  handledAuthFailure: () => false,
}));

afterEach(cleanup);

function detail(p: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: "t1", seq: 330, title: "월간 회의 일정 공지", note: null, isImportant: false, isCompleted: false,
    completedAt: null, dueDate: "2026-08-18", inMyDay: false, order: "a0", createdAt: "2026-08-05T00:00:00.000Z",
    listId: "l1", listName: "2026년 9월", groupName: "운영", stepCount: 0, stepDoneCount: 0,
    assignee: null, repeat: null, attachmentCount: 0, remindAt: null,
    steps: [], attachments: [], listOwnerName: null,
    ...p,
  };
}

describe("상세 창의 목록 경로", () => {
  it("다른 화면에서 열면 그룹 › 목록이 그 목록으로 가는 링크 — 작업은 열린 채", () => {
    pathname = "/calendar";
    render(<DetailPane task={detail()} canWrite />);
    const link = screen.getByRole("link", { name: /운영.*2026년 9월/ });
    expect(link.getAttribute("href")).toBe("/list/l1?task=t1");
  });

  it("그 목록 화면에서 열면 글자만 — 이미 거기 있다", () => {
    pathname = "/list/l1";
    render(<DetailPane task={detail()} canWrite />);
    expect(screen.queryByRole("link", { name: /2026년 9월/ })).toBeNull();
    expect(screen.getByTitle("운영 › 2026년 9월")).toBeTruthy();
  });

  it("그룹 밖 목록은 목록 이름만", () => {
    pathname = "/calendar";
    render(<DetailPane task={detail({ groupName: null, listName: "작업" })} canWrite />);
    expect(screen.getByRole("link", { name: "작업" })).toBeTruthy();
    expect(screen.queryByText("›")).toBeNull();
  });

  it("공유받은 목록이면 누가 공유했는지, 읽기 전용이면 그것도", () => {
    pathname = "/calendar";
    render(
      <DetailPane
        task={detail({ groupName: "영업", listName: "견적 관리", listOwnerName: "윤재원" })}
        canWrite={false}
      />,
    );
    expect(screen.getByText("윤재원 공유 · 읽기 전용")).toBeTruthy();
  });

  it("내 목록이면 공유 표시가 없다", () => {
    pathname = "/calendar";
    render(<DetailPane task={detail()} canWrite />);
    expect(screen.queryByText(/공유/)).toBeNull();
  });
});
