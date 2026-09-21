// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { MessageItem } from "@/lib/queries/project";
import { ThreadPane } from "@/components/project/ThreadPane";

/**
 * 스레드 창. 답글은 원글 id 를 달고 나가고, 닫기는 주소에서 thread·msg 를 뗀다.
 * 삭제된 원글에는 답글 입력이 잠긴다.
 */
const replace = vi.fn();
type Post = (...a: unknown[]) => Promise<{ ok: true; data: MessageItem }>;
const postMessage = vi.fn<Post>(async () => ({ ok: true, data: reply("new", "새 답글") }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/p1",
  useSearchParams: () => new URLSearchParams("thread=root"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/message", () => ({
  postMessage: (...a: unknown[]) => postMessage(...a),
  editMessage: vi.fn(async () => ({ ok: true })),
  deleteMessage: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/actions/session-guard", () => ({
  runAction: (fn: () => unknown) => fn(),
  handledAuthFailure: () => false,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 })));
});

function msg(id: string, body: string, over: Partial<MessageItem> = {}): MessageItem {
  return {
    id, seq: 1, parentId: null, author: { id: "u1", name: "윤재원", avatarColor: "#0f7b6c" }, body,
    createdAt: "2026-09-16T01:00:00.000Z", updatedAt: "2026-09-16T01:00:00.000Z", editedAt: null, deletedAt: null,
    pinnedAt: null, pinnedByName: null, replyCount: 0, lastReplyAt: null, mentionsAll: false, mentions: [], files: [],
    isMine: false, canDelete: false, ...over,
  };
}
const reply = (id: string, body: string) => msg(id, body, { parentId: "root", seq: 2 });

describe("스레드 창", () => {
  it("원글과 답글을 보여 주고, 답글은 원글 id 를 달고 나간다", async () => {
    render(<ThreadPane projectId="p1" parent={msg("root", "원글")} replies={[reply("r1", "첫 답글")]} meId="me" readOnly={false} />);
    const pane = screen.getByRole("complementary", { name: "스레드" });
    expect(within(pane).getByText("원글")).toBeTruthy();
    expect(within(pane).getByText("첫 답글")).toBeTruthy();
    expect(within(pane).getByText("답글 1개")).toBeTruthy();

    const box = within(pane).getByRole("textbox", { name: "답글 남기기" });
    fireEvent.change(box, { target: { value: "새 답글" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith("p1", "새 답글", "root"));
    await vi.waitFor(() => expect(within(pane).getByText("새 답글")).toBeTruthy());
  });

  it("닫으면 주소에서 thread 가 빠진다", () => {
    render(<ThreadPane projectId="p1" parent={msg("root", "원글")} replies={[]} meId="me" readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "스레드 닫기" }));
    expect(replace).toHaveBeenCalledWith("/projects/p1", { scroll: false });
  });

  it("삭제된 원글에는 답글 입력이 잠긴다", () => {
    render(<ThreadPane projectId="p1" parent={msg("root", "", { deletedAt: "2026-09-16T02:00:00.000Z" })} replies={[]} meId="me" readOnly={false} />);
    expect(screen.queryByRole("textbox", { name: "답글 남기기" })).toBeNull();
    expect(screen.getByText("삭제된 메시지에는 답글을 달 수 없습니다.")).toBeTruthy();
  });
});
