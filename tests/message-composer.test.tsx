// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageComposer, type MentionCandidate } from "@/components/project/MessageComposer";

/**
 * 입력창의 키보드. Enter 전송, Shift+Enter 줄바꿈, 한글 조합 중 Enter 무시.
 * 브라우저 자동화의 Enter 에는 key 가 비어 있어 여기서 직접 쏜다(코멘트 입력 시험과 같은 이유).
 * @ 자동완성: 고른 사람만 <@id> 토큰이 되고, 손으로 친 @이름은 평문으로 나간다.
 */
afterEach(cleanup);

const MEMBERS: MentionCandidate[] = [
  { userId: "u1aaaaaaaaaaaaaaaaaaaaa", name: "오세린", department: "생산팀" },
  { userId: "u2bbbbbbbbbbbbbbbbbbbbb", name: "박서연", department: "영업팀" },
];

function show(onSend = vi.fn(async () => true), opts: { disabled?: boolean; members?: MentionCandidate[] } = {}) {
  render(
    <MessageComposer placeholder="메시지 보내기" disabled={opts.disabled} disabledHint="읽기 전용" members={opts.members} onSend={onSend} />,
  );
  return { onSend, box: screen.queryByRole("textbox", { name: "메시지 보내기" }) as HTMLTextAreaElement | null };
}

function type(box: HTMLTextAreaElement, text: string) {
  fireEvent.change(box, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } });
}

describe("메시지 입력창", () => {
  it("Enter 로 보내고 성공하면 비운다", async () => {
    const { onSend, box } = show();
    type(box!, "안녕");
    fireEvent.keyDown(box!, { key: "Enter" });
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith("안녕", []));
    await vi.waitFor(() => expect(box!.value).toBe(""));
  });

  it("실패하면 쓴 글이 남는다", async () => {
    const { box } = show(vi.fn(async () => false));
    type(box!, "남는다");
    fireEvent.keyDown(box!, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 10));
    expect(box!.value).toBe("남는다");
  });

  it("한글 조합을 끝내는 Enter 와 Shift+Enter 는 보내지 않는다", async () => {
    const { onSend, box } = show();
    type(box!, "조합");
    fireEvent.keyDown(box!, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box!, { key: "Enter", shiftKey: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("빈 글은 보내지 않는다", async () => {
    const { onSend, box } = show();
    type(box!, "   ");
    fireEvent.keyDown(box!, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 10));
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "보내기" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("보관된 프로젝트에서는 입력칸 대신 안내만", () => {
    const { box } = show(undefined, { disabled: true });
    expect(box).toBeNull();
    expect(screen.getByText("읽기 전용")).toBeTruthy();
  });
});

describe("@ 자동완성", () => {
  it("@ 뒤 글자로 거르고, Enter 로 고르면 @이름 이 들어가며, 보낼 때만 토큰이 된다", async () => {
    const { onSend, box } = show(undefined, { members: MEMBERS });
    type(box!, "사진은 @박서");
    const list = screen.getByRole("listbox", { name: "멘션할 사람" });
    expect(list.textContent).toContain("박서연");
    expect(list.textContent).not.toContain("오세린");

    fireEvent.keyDown(box!, { key: "Enter" }); // 고르기 — 전송이 아니다
    expect(onSend).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(box!.value).toBe("사진은 @박서연 "));

    type(box!, "사진은 @박서연 올려요 @손으로");
    fireEvent.keyDown(box!, { key: "Enter" });
    await vi.waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("사진은 <@u2bbbbbbbbbbbbbbbbbbbbb> 올려요 @손으로", []),
    );
  });

  it("'전체' 는 맨 위에 있고 <@all> 로 나간다. Esc 로 닫힌다", async () => {
    const { onSend, box } = show(undefined, { members: MEMBERS });
    type(box!, "@");
    const list = screen.getByRole("listbox", { name: "멘션할 사람" });
    expect(list.querySelector('[role=option]')?.textContent).toContain("전체");
    fireEvent.keyDown(box!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    type(box!, "@전");
    fireEvent.keyDown(box!, { key: "Tab" });
    await vi.waitFor(() => expect(box!.value).toBe("@전체 "));
    fireEvent.keyDown(box!, { key: "Enter" });
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith("<@all> ", []));
  });

  it("멤버 목록이 없으면 @ 를 쳐도 뜨지 않는다", () => {
    const { box } = show();
    type(box!, "@박");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
