// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { RichEditor, type RichEditorHandle } from "@/components/issues/RichEditor";
import { IssueMarkdown } from "@/components/issues/IssueMarkdown";

/**
 * 이슈 글 편집기(2026-10-20, TipTap 3) — 보이는 그대로 편집하고 마크다운 글자로 저장한다.
 * 저장 형식이 예전과 같아야(멘션 토큰·소제목·번호 목록) 알림·검색·Claude Code 복사가 그대로 동작한다.
 */
afterEach(cleanup);

const ID = "cmsluucs100001ovbi9rw1d00";
const members = [{ userId: ID, name: "김하늘", department: "품질" }];

async function mount(initial: string) {
  const ref = createRef<RichEditorHandle>();
  render(<RichEditor ref={ref} initial={initial} placeholder="댓글 쓰기" ariaLabel="댓글" members={members} />);
  await waitFor(() => expect(ref.current?.getMarkdown()).toBeTruthy());
  return ref;
}

describe("RichEditor — 마크다운 저장", () => {
  it("굵게·멘션·체크 목록·번호 목록이 그대로 돌아온다", async () => {
    const md = `부적합 **연계** 확인 <@${ID}>\n\n- [x] 끝남\n- [ ] 남음\n\n1. 하나\n2. 둘`;
    const ref = await mount(md);
    const out = ref.current!.getMarkdown();
    expect(out).toContain("**연계**");
    expect(out).toContain(`<@${ID}>`);
    expect(out).toMatch(/- \[x\] 끝남/);
    expect(out).toMatch(/- \[ \] 남음/);
    expect(out).toMatch(/1\. 하나/);
    // 편집기 안에는 @이름 으로 보인다
    expect(screen.getByText("@김하늘")).toBeTruthy();
  });

  it("예전 평문 글(소제목·줄바꿈)도 읽고 다시 쓸 수 있다", async () => {
    const ref = await mount("## 재현 순서\n1. 양식을 연다\n\n## 기대 결과\n모든 글자가 보임\n둘째 줄");
    const out = ref.current!.getMarkdown();
    expect(out).toMatch(/^## 재현 순서/);
    expect(out).toContain("## 기대 결과");
    expect(out).toContain("모든 글자가 보임");
    expect(out).toContain("둘째 줄");
  });

  it("비우기", async () => {
    const ref = await mount("지울 글");
    act(() => ref.current!.clear());
    expect(ref.current!.getMarkdown().trim()).toBe("");
  });

  it("붙여넣은 파일은 글에 넣지 않고 onFiles 로", async () => {
    const onFiles = vi.fn();
    const ref = createRef<RichEditorHandle>();
    render(<RichEditor ref={ref} initial="" placeholder="댓글" ariaLabel="댓글" members={[]} onFiles={onFiles} />);
    const box = await screen.findByLabelText("댓글");
    const file = new File(["png"], "image.png", { type: "image/png" });
    const evt = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    evt.clipboardData = { items: [{ kind: "file", getAsFile: () => file }], files: [file], getData: () => "", types: ["Files"] };
    act(() => {
      box.dispatchEvent(evt);
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(ref.current!.getMarkdown().trim()).toBe("");
  });
});

describe("IssueMarkdown — 그리기", () => {
  const ctx = { mentions: [{ userId: ID, name: "김하늘" }], meId: "me", issueKey: "BUG" };

  it("굵게·목록·체크·인용·코드, 멘션과 이슈 번호는 링크·표시로", () => {
    const { container } = render(
      <IssueMarkdown
        body={`**기준** 칸이 좁음 <@${ID}> BUG-3\n\n- [x] 캡처\n- [ ] 다른 양식\n\n> 인용\n\n\`코드\``}
        {...ctx}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("기준");
    expect(screen.getByText("@김하늘")).toBeTruthy();
    expect(screen.getByRole("link", { name: "BUG-3" }).getAttribute("href")).toBe("/i/BUG-3");
    expect(screen.getByLabelText("완료한 항목")).toBeTruthy();
    expect(container.textContent).not.toContain("[x]");
    expect(container.textContent).not.toContain("[ ]");
    expect(container.querySelector("blockquote")?.textContent).toContain("인용");
    expect(container.querySelector("code")?.textContent).toBe("코드");
  });

  it("HTML 은 넣지 않고 글자로, javascript: 링크는 링크가 아니다", () => {
    const { container } = render(<IssueMarkdown body={"<script>alert(1)</script> [눌러](javascript:alert(1))"} {...ctx} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
    expect(container.querySelector("a")).toBeNull();
  });

  it("예전 평문: 한 줄 바꿈도 줄바꿈", () => {
    const { container } = render(<IssueMarkdown body={"첫 줄\n둘째 줄"} {...ctx} />);
    expect(container.querySelector("br")).not.toBeNull();
  });
});
