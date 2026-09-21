// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TaskRow } from "@/components/list-view/TaskRow";
import { MessageRow } from "@/components/project/MessageRow";
import type { TaskItem } from "@/lib/queries/list";
import type { MessageItem } from "@/lib/queries/project";
import { resetTestIntl, setTestIntl } from "./helpers/intl";

/**
 * 화면도 사용자 시간대로 그린다 — 브라우저 시계의 시간대가 아니다.
 *
 * 같은 순간이 서울에서는 이미 다음 날이어도 뉴욕 사용자에게는 아직 전날이다. 기한 지남 표시와
 * 메시지 시각이 그 사람의 벽시계를 따라야 서버가 그린 것과 어긋나지 않는다.
 */

afterEach(() => {
  cleanup();
  resetTestIntl();
  vi.useRealTimers();
});

beforeEach(() => {
  // 뉴욕은 3/7 23:30(EST), 서울은 3/8 13:30
  vi.useFakeTimers({ now: new Date("2026-03-08T04:30:00Z"), toFake: ["Date"] });
});

function task(p: Partial<TaskItem>): TaskItem {
  return {
    id: "t", seq: 1, title: "보고서 제출", note: null, isImportant: false, isCompleted: false, completedAt: null,
    dueDate: "2026-03-07", inMyDay: false, order: "a0", createdAt: "2026-03-01T00:00:00.000Z", listId: "l",
    listName: "작업", groupName: null, stepCount: 0, stepDoneCount: 0, assignee: null, repeat: null,
    attachmentCount: 0, remindAt: null, ...p,
  };
}

function showRow() {
  render(
    <TaskRow
      task={task({})}
      showSeq={false}
      selected={false}
      canWrite
      onToggleComplete={() => {}}
      onToggleImportant={() => {}}
      onSelect={() => {}}
    />,
  );
  return screen.getByText(/3월 7일/).closest("span") as HTMLElement;
}

describe("기한 지남은 사용자 시간대의 오늘로 본다", () => {
  it("서울 사용자에게 3/7 기한은 이미 지났다", () => {
    expect(showRow().className).toContain("overdue");
  });

  it("뉴욕 사용자에게는 아직 3/7 이라 지나지 않았다", () => {
    setTestIntl({ timeZone: "America/New_York" });
    expect(showRow().className).not.toContain("overdue");
  });
});

describe("메시지 시각", () => {
  const m = {
    id: "m1", seq: 1, projectId: "p1", parentId: null,
    author: { id: "u1", name: "홍길동", avatarColor: "#c2185b" },
    body: "안녕하세요", mentions: [], mentionsAll: false, editedAt: null, deletedAt: null, pinnedAt: null,
    createdAt: "2026-03-08T04:30:00.000Z", updatedAt: "2026-03-08T04:30:00.000Z",
    files: [], replyCount: 0, lastReplyAt: null, isMine: false, canDelete: false,
  } as unknown as MessageItem;
  const show = () => render(<MessageRow m={m} meId="u2" readOnly onEdit={() => {}} onDelete={() => {}} />);

  it("서울은 13:30, 뉴욕은 23:30", () => {
    show();
    expect(screen.getByText("13:30")).toBeTruthy();
    cleanup();
    setTestIntl({ timeZone: "America/New_York" });
    show();
    expect(screen.getByText("23:30")).toBeTruthy();
  });
});
