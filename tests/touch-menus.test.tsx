// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ContextMenu, RowMenuButton, type MenuItem } from "@/components/ui/menu";
import { MessageRow, messagePlainText } from "@/components/project/MessageRow";
import { MessageEditor } from "@/components/project/MessageEditor";
import { MessageComposer } from "@/components/project/MessageComposer";
import type { MessageItem } from "@/lib/queries/project";

/**
 * 터치 기기의 메뉴(2026-09-17 모바일 3조각).
 *
 * 폰·태블릿에는 오른쪽 클릭도, 마우스 올리기도, Esc·Shift+Enter 도 없다. 그래서 막혀 있던 길들 —
 * 사이드바 목록 메뉴, 메시지 답글·수정·삭제, 메시지 고치기 취소, 여러 줄 메시지 — 을 손가락으로 여는지 본다.
 * CSS 로만 달라지는 것(pointer-coarse: 로 보이기·크기)은 브라우저에서 확인했다.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const media = (matching: string[]) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: matching.includes(q), addEventListener() {}, removeEventListener() {} }));

const ITEMS = (onRename = vi.fn()): MenuItem[] => [
  { icon: "edit", label: "목록 이름 바꾸기", onSelect: onRename },
  { kind: "separator" },
  { icon: "trash", label: "목록 삭제", danger: true },
];

describe("메뉴 — PC 는 누른 자리, 폰은 아래 시트", () => {
  it("PC: 누른 자리에 뜨고 화면 왼쪽 밖으로 나가지 않는다", () => {
    render(<ContextMenu anchor={{ x: -200, y: 40 }} items={ITEMS()} onClose={() => {}} />);
    const menu = screen.getByRole("menu");
    expect(menu.hasAttribute("data-menu-sheet")).toBe(false);
    expect(menu.style.left).toBe("8px");
  });

  it("폰: 아래 시트에 무엇의 메뉴인지 머리를 달고, 항목을 누르면 실행하고 닫힌다. 뒤 판을 누르면 닫힌다", async () => {
    media(["(max-width: 767.98px)"]);
    const onRename = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu anchor={{ x: 10, y: 10 }} items={ITEMS(onRename)} title="기능 구현" onClose={onClose} />);
    const sheet = screen.getByRole("menu", { name: "기능 구현" });
    expect(sheet.hasAttribute("data-menu-sheet")).toBe(true);

    fireEvent.click(within(sheet).getByRole("menuitem", { name: "목록 이름 바꾸기" }));
    expect(onRename).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 1));
    fireEvent.mouseDown(document.querySelector("[data-menu-backdrop]")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("줄의 ⋯ 버튼이 메뉴를 연다 — 끌기 센서가 누름을 가져가지 않는다", () => {
    const onOpen = vi.fn();
    const rowDown = vi.fn();
    render(
      <div onMouseDown={rowDown} onTouchStart={rowDown}>
        <RowMenuButton label="기능 구현 메뉴" onOpen={onOpen} />
      </div>,
    );
    const btn = screen.getByRole("button", { name: "기능 구현 메뉴" });
    fireEvent.mouseDown(btn);
    fireEvent.touchStart(btn);
    fireEvent.click(btn);
    expect(rowDown).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });
});

function message(p: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "m1", seq: 1, projectId: "p1", parentId: null,
    author: { id: "u1", name: "홍길동", avatarColor: "#c2185b" },
    body: "<@u2bbbbbbbbbbbbbbbbbbbbb> 확인 부탁 <@all>",
    mentions: [{ userId: "u2bbbbbbbbbbbbbbbbbbbbb", name: "윤재원" }],
    mentionsAll: true, editedAt: null, deletedAt: null, pinnedAt: null,
    createdAt: "2026-09-17T00:45:00.000Z", updatedAt: "2026-09-17T00:45:00.000Z",
    files: [], replyCount: 0, lastReplyAt: null, isMine: true, canDelete: true,
    ...p,
  } as MessageItem;
}

function showMessage(m = message(), readOnly = false) {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onPin: vi.fn(), onOpenThread: vi.fn(), onCopyLink: vi.fn() };
  render(<MessageRow m={m} meId="u1" readOnly={readOnly} {...handlers} />);
  return handlers;
}

const row = () => document.querySelector("[data-message]") as HTMLElement;
const press = (x = 50, y = 50) => fireEvent.touchStart(row(), { touches: [{ clientX: x, clientY: y }] });

describe("메시지 — 길게 누르기와 ⋯", () => {
  it("길게 누르면(0.5초) 메뉴. 내 글이면 답글·고정·링크·텍스트 복사·수정·삭제", () => {
    vi.useFakeTimers();
    const h = showMessage();
    press();
    act(() => void vi.advanceTimersByTime(499));
    expect(screen.queryByRole("menu")).toBeNull();
    act(() => void vi.advanceTimersByTime(1));

    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
      "답글 달기", "고정", "링크 복사", "텍스트 복사", "수정", "삭제",
    ]);
    // 손을 뗀 뒤 click 이 오지 않는 브라우저에서도 첫 메뉴 누름이 먹혀야 한다(삼키는 표시가 남아 있어도)
    fireEvent.click(within(menu).getByRole("menuitem", { name: "삭제" }));
    expect(h.onDelete).toHaveBeenCalledWith("m1");
  });

  it("길게 눌러 연 뒤 손을 떼며 오는 click 은 줄 안의 버튼을 누르지 않는다", () => {
    vi.useFakeTimers();
    const h = showMessage(message({ replyCount: 2, lastReplyAt: "2026-09-17T01:00:00.000Z" }));
    const replies = screen.getByRole("button", { name: /답글 2개/ });
    fireEvent.touchStart(replies, { touches: [{ clientX: 50, clientY: 50 }] });
    act(() => void vi.advanceTimersByTime(500));
    fireEvent.click(replies);
    expect(h.onOpenThread).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("누른 채 움직이면(스크롤) 메뉴가 뜨지 않는다", () => {
    vi.useFakeTimers();
    showMessage();
    press(50, 50);
    fireEvent.touchMove(row(), { touches: [{ clientX: 50, clientY: 80 }] });
    act(() => void vi.advanceTimersByTime(800));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("보관된 프로젝트·남의 글이면 복사만. ⋯ 버튼으로도 연다", () => {
    showMessage(message({ isMine: false, canDelete: false }), true);
    fireEvent.click(screen.getByRole("button", { name: "메시지 메뉴" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
      "링크 복사", "텍스트 복사",
    ]);
  });

  it("텍스트 복사는 멘션을 이름으로 푼 글이다", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    showMessage();
    fireEvent.click(screen.getByRole("button", { name: "메시지 메뉴" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "텍스트 복사" }));
    expect(writeText).toHaveBeenCalledWith("@윤재원 확인 부탁 @전체");
    expect(messagePlainText({ body: "<@zzzzzzzzzzzzzzzzzzzzzz>", mentions: [] }, { all: "전체", unknown: "알 수 없음" })).toBe(
      "@알 수 없음",
    );
  });
});

describe("메시지 고치기 — 폰 자판에는 Esc 가 없다", () => {
  it("취소 버튼은 고친 것을 버리고, 저장 버튼은 고친 글로 끝낸다", () => {
    const onDone = vi.fn();
    render(<MessageEditor initial="처음" onDone={onDone} />);
    fireEvent.change(screen.getByRole("textbox", { name: "메시지 고치기" }), { target: { value: "고침" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onDone).toHaveBeenCalledWith(null);
    cleanup();

    const onSave = vi.fn();
    render(<MessageEditor initial="처음" onDone={onSave} />);
    fireEvent.change(screen.getByRole("textbox", { name: "메시지 고치기" }), { target: { value: "고침" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith("고침");
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("메시지 입력 — 터치 기기의 Enter 는 줄바꿈", () => {
  it("손가락 기기에서는 Enter 로 보내지 않고, 보내기 버튼으로 보낸다", async () => {
    media(["(pointer: coarse)"]);
    const onSend = vi.fn(async () => true);
    render(<MessageComposer placeholder="메시지 보내기" onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "메시지 보내기" });
    fireEvent.change(box, { target: { value: "첫 줄" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 10));
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith("첫 줄", []));
  });
});
