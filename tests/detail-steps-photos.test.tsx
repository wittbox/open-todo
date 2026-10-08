// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TaskDetail } from "@/lib/queries/list";
import { DetailPane } from "@/components/detail-pane/DetailPane";

/**
 * 상세 창의 단계 칸과 첨부 사진.
 *
 * 단계 이름이 한 줄 입력칸이라 길게 쓰면 잘렸다 → 내용만큼 늘어나는 칸. Enter 는 저장이고 줄바꿈은 없다
 * (작업 제목 칸과 같게). 한글 조합 중의 Enter 로 저장하면 마지막 글자가 빠지므로 그것은 넘긴다.
 * 첨부 사진은 새 탭 대신 모달로 — 같은 작업의 사진끼리 넘긴다. 사진이 아닌 첨부는 지금처럼 내려받는다.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/list/l1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const calls = vi.hoisted(() => ({ createStep: vi.fn(), updateStep: vi.fn() }));
vi.mock("@/lib/actions/task", () => {
  const ok = async () => ({ ok: true });
  return {
    createStep: async (...a: unknown[]) => (calls.createStep(...a), { ok: true }),
    updateStep: async (...a: unknown[]) => (calls.updateStep(...a), { ok: true }),
    deleteAttachment: ok, deleteStep: ok, deleteTask: ok, setAssignee: ok, setReminder: ok, setRepeat: ok, updateTask: ok,
  };
});
vi.mock("@/lib/actions/session-guard", () => ({
  runAction: (fn: () => unknown) => fn(),
  handledAuthFailure: () => false,
}));

beforeEach(() => {
  calls.createStep.mockClear();
  calls.updateStep.mockClear();
});
afterEach(cleanup);

const LONG = "판정 근거가 자동생성이라 되어있으나 생성 규칙이 문서에 없음 — 근거 문서 번호를 함께 적도록 양식 수정 요청";

function detail(p: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: "t1", seq: 212, title: "시험 성적서 검토", note: null, isImportant: false, isCompleted: false,
    completedAt: null, dueDate: null, inMyDay: false, order: "a0", createdAt: "2026-10-01T00:00:00.000Z",
    listId: "l1", listName: "품질", groupName: null, stepCount: 1, stepDoneCount: 0,
    assignee: null, repeat: null, attachmentCount: 0, remindAt: null, listOwnerName: null,
    steps: [{ id: "s1", title: LONG, isCompleted: false, order: "a0" }],
    attachments: [],
    ...p,
  };
}

const file = (id: string, name: string, mimeType: string) => ({
  id, name, mimeType, size: 320_000, uploaderName: "김하늘", createdAt: "2026-10-01T00:00:00.000Z",
});

describe("단계 칸", () => {
  it("한 줄 입력칸이 아니라 여러 줄로 접히는 칸 — 긴 이름이 통째로 들어 있다", () => {
    render(<DetailPane task={detail()} canWrite />);
    const step = screen.getByRole("textbox", { name: "단계 이름" });
    expect(step.tagName).toBe("TEXTAREA");
    expect((step as HTMLTextAreaElement).value).toBe(LONG);
    expect(screen.getByRole("textbox", { name: "다음 단계" }).tagName).toBe("TEXTAREA");
  });

  it("Enter 는 저장(칸을 벗어남). Shift+Enter 도 줄바꿈 대신 저장", () => {
    render(<DetailPane task={detail()} canWrite />);
    const step = screen.getByRole("textbox", { name: "단계 이름" }) as HTMLTextAreaElement;
    step.focus();
    fireEvent.change(step, { target: { value: "고친 이름" } });
    const enter = fireEvent.keyDown(step, { key: "Enter", shiftKey: true });
    expect(enter).toBe(false); // 기본 동작(줄바꿈)을 막았다
    expect(document.activeElement).not.toBe(step);
    fireEvent.blur(step);
    expect(calls.updateStep).toHaveBeenCalledWith("s1", { title: "고친 이름" });
  });

  it("한글 조합 중의 Enter 는 넘긴다 — 조합이 끝난 뒤 오는 Enter 로 처리", () => {
    render(<DetailPane task={detail()} canWrite />);
    const next = screen.getByRole("textbox", { name: "다음 단계" }) as HTMLTextAreaElement;
    fireEvent.change(next, { target: { value: "시료 수량 확" } });
    fireEvent.keyDown(next, { key: "Enter", keyCode: 229, isComposing: true });
    expect(calls.createStep).not.toHaveBeenCalled();
  });

  it("다음 단계: Enter 로 추가하고 칸을 비운다. 붙여 넣은 줄바꿈은 띄어쓰기로", () => {
    render(<DetailPane task={detail()} canWrite />);
    const next = screen.getByRole("textbox", { name: "다음 단계" }) as HTMLTextAreaElement;
    fireEvent.change(next, { target: { value: "  회의록에 담당자와\n다음 일정 적기  " } });
    fireEvent.keyDown(next, { key: "Enter" });
    expect(calls.createStep).toHaveBeenCalledWith("t1", "회의록에 담당자와 다음 일정 적기");
    expect(next.value).toBe("");
  });

  it("읽기 전용이면 고칠 수 없고 다음 단계 칸도 없다", () => {
    render(<DetailPane task={detail()} canWrite={false} />);
    expect((screen.getByRole("textbox", { name: "단계 이름" }) as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByRole("textbox", { name: "다음 단계" })).toBeNull();
  });
});

describe("첨부 사진 모달", () => {
  const attachments = [
    file("p1", "현장 사진 1.jpg", "image/jpeg"),
    file("d1", "성적서.pdf", "application/pdf"),
    file("p2", "라벨.png", "image/png"),
  ];

  it("사진을 누르면 모달 — 이름·크기·올린 사람, 내려받기, 같은 작업의 사진끼리 '1 / 2'", () => {
    render(<DetailPane task={detail({ attachments })} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "현장 사진 1.jpg 보기" }));
    const dialog = screen.getByRole("dialog", { name: "현장 사진 1.jpg" });
    expect(within(dialog).getByText(/김하늘/)).toBeTruthy();
    expect(within(dialog).getByText("1 / 2")).toBeTruthy();
    const download = within(dialog).getByRole("link", { name: "내려받기" });
    expect(download.getAttribute("href")).toBe("/api/files/p1");
    expect(download.getAttribute("download")).toBe("현장 사진 1.jpg");
  });

  it("◀ ▶ · ← → 로 넘기고(끝에서 처음으로), Esc 로 닫는다", () => {
    render(<DetailPane task={detail({ attachments })} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "현장 사진 1.jpg 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 사진" }));
    expect(screen.getByRole("dialog", { name: "라벨.png" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "현장 사진 1.jpg" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: "라벨.png" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("사진을 누르면 원본 크기 ↔ 화면 맞춤, 어두운 바탕을 누르면 닫힌다", () => {
    render(<DetailPane task={detail({ attachments })} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "라벨.png 보기" }));
    const img = within(screen.getByRole("dialog")).getByRole("img", { name: "라벨.png" });
    expect(img.className).toContain("cursor-zoom-in");
    fireEvent.click(img);
    expect(img.className).toContain("cursor-zoom-out");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog").querySelector("[data-backdrop]")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("사진이 아닌 첨부는 지금처럼 내려받기 링크", () => {
    render(<DetailPane task={detail({ attachments })} canWrite />);
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/api/files/d1");
    expect(links.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "성적서.pdf 보기" })).toBeNull();
  });

  it("사진 한 장이면 넘기기 버튼과 번호가 없다", () => {
    render(<DetailPane task={detail({ attachments: [attachments[0]] })} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "현장 사진 1.jpg 보기" }));
    expect(screen.queryByRole("button", { name: "다음 사진" })).toBeNull();
    expect(screen.queryByText("1 / 1")).toBeNull();
  });
});

describe("프로젝트 메시지의 사진도 같은 모달", () => {
  it("사진을 누르면 모달 — 그 메시지의 사진끼리 넘기고, 파일은 지금처럼 링크", async () => {
    const { MessageRow } = await import("@/components/project/MessageRow");
    const m = {
      id: "m1", seq: 1, projectId: "p1", parentId: null,
      author: { id: "u1", name: "김하늘", avatarColor: "#c2185b" },
      body: "현장 사진입니다", mentions: [], mentionsAll: false, editedAt: null, deletedAt: null, pinnedAt: null,
      createdAt: "2026-10-07T00:45:00.000Z", updatedAt: "2026-10-07T00:45:00.000Z",
      files: [
        { id: "f1", name: "앞면.jpg", size: 1000, mimeType: "image/jpeg" },
        { id: "f2", name: "견적.pdf", size: 2000, mimeType: "application/pdf" },
        { id: "f3", name: "뒷면.jpg", size: 3000, mimeType: "image/jpeg" },
      ],
      replyCount: 0, lastReplyAt: null, isMine: true, canDelete: true, issues: [],
    } as unknown as import("@/lib/queries/project").MessageItem;
    render(<MessageRow m={m} meId="u1" readOnly={false} onEdit={() => {}} onDelete={() => {}} />);

    expect(screen.getByRole("link", { name: /견적\.pdf/ }).getAttribute("href")).toBe("/api/files/f2");
    fireEvent.click(screen.getByTitle("뒷면.jpg"));
    expect(screen.getByRole("dialog", { name: "뒷면.jpg" })).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다음 사진" }));
    expect(screen.getByRole("dialog", { name: "앞면.jpg" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
