// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReportBody, type ReportBodyEditing } from "@/lib/report/render";
import type { ReportContent } from "@/lib/report/aggregate";

/**
 * 보고서 편집 화면의 코멘트.
 *
 * 예전에는 코멘트가 있으면 입력칸을 늘 그렸다. 저장해도 입력칸이 남고, 같은 문장이
 * 입력칸과 기울임 글자로 두 번 보였다(2026-09-11 신고).
 *
 * 키보드 동작은 브라우저 자동화로는 확인이 안 됐다 — 그 도구가 보내는 Enter 에는
 * key 가 비어 있다. 그래서 여기서 이벤트를 직접 쏴서 못박는다.
 */

afterEach(cleanup);

function content(comment: string | null): ReportContent {
  return {
    weekStart: "2026-09-07",
    weekEnd: "2026-09-13",
    rangeLabel: "9/7(월) ~ 9/11(금)",
    title: "주간업무보고",
    summary: "",
    taskCount: 1,
    sections: [
      {
        key: "inProgress",
        label: "진행 중",
        groups: [
          {
            path: "인증 › 부품 변경",
            owner: null,
            tasks: [
              {
                id: "t18", seq: 18, title: "보완: 시험자료 제출 요청", listId: "l1", path: "",
                stepDone: 1, stepTotal: 3, dueDate: null, dueLabel: null, steps: [],
                comment, assignee: null, reason: "due",
              },
            ],
          },
        ],
      },
    ],
  };
}

function editing(comments: Record<string, string> = {}): ReportBodyEditing & { onComment: ReturnType<typeof vi.fn> } {
  return { comments, onExclude: vi.fn(), onComment: vi.fn(), onMoveSection: vi.fn() };
}

const input = () => screen.queryByPlaceholderText(/코멘트/);

describe("저장된 코멘트", () => {
  it("글자로만 보인다 — 입력칸은 없다", () => {
    render(<ReportBody content={content("시험기관 회신 대기 중")} editing={editing({ t18: "시험기관 회신 대기 중" })} />);
    expect(screen.getByText("시험기관 회신 대기 중")).toBeTruthy();
    expect(input()).toBeNull();
  });

  it("글자를 누르면 그 자리에서 입력칸이 열리고 원래 문장이 들어 있다", () => {
    render(<ReportBody content={content("회신 대기")} editing={editing({ t18: "회신 대기" })} />);
    fireEvent.click(screen.getByTitle("눌러서 고치기"));
    expect((input() as HTMLInputElement).value).toBe("회신 대기");
  });

  it("발행본(편집 아님)에서는 눌러도 아무 일이 없다", () => {
    render(<ReportBody content={content("회신 대기")} />);
    expect(screen.queryByTitle("눌러서 고치기")).toBeNull();
    expect(screen.getByText("회신 대기")).toBeTruthy();
  });
});

describe("코멘트 입력", () => {
  function open(e = editing()) {
    render(<ReportBody content={content(null)} editing={e} />);
    fireEvent.click(screen.getByText("코멘트"));
    return { e, box: input() as HTMLInputElement };
  }

  it("Enter 로 저장하고 입력칸이 닫힌다", () => {
    const { e, box } = open();
    fireEvent.change(box, { target: { value: "시험기관 회신 대기 중" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(e.onComment).toHaveBeenCalledWith("t18", "시험기관 회신 대기 중");
    expect(input()).toBeNull();
  });

  it("한글 조합 중의 Enter 는 저장으로 받지 않는다 — 마지막 글자가 잘린다", () => {
    const { e, box } = open();
    fireEvent.change(box, { target: { value: "회신 대" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(e.onComment).not.toHaveBeenCalled();
    expect(input()).not.toBeNull();
  });

  it("바깥을 누르면(blur) 저장한다", () => {
    const { e, box } = open();
    fireEvent.change(box, { target: { value: "메모" } });
    fireEvent.blur(box);
    expect(e.onComment).toHaveBeenCalledWith("t18", "메모");
  });

  it("Esc 는 취소 — 저장하지 않고 닫는다. 닫히며 오는 blur 도 무시한다", () => {
    const { e, box } = open();
    fireEvent.change(box, { target: { value: "쓰다 만 문장" } });
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.blur(box);
    expect(e.onComment).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });

  it("바뀐 게 없으면 저장하지 않는다", () => {
    const ed = editing({ t18: "그대로" });
    render(<ReportBody content={content("그대로")} editing={ed} />);
    fireEvent.click(screen.getByTitle("눌러서 고치기"));
    fireEvent.keyDown(input() as HTMLInputElement, { key: "Enter" });
    expect(ed.onComment).not.toHaveBeenCalled();
  });

  it("비우고 저장하면 빈 문자열로 넘긴다 — 코멘트가 사라진다", () => {
    const ed = editing({ t18: "지울 문장" });
    render(<ReportBody content={content("지울 문장")} editing={ed} />);
    fireEvent.click(screen.getByTitle("눌러서 고치기"));
    const box = input() as HTMLInputElement;
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(ed.onComment).toHaveBeenCalledWith("t18", "");
  });
});
