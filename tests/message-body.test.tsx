// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MessageBody } from "@/components/project/MessageBody";

/**
 * 메시지 본문 그리기.
 *
 * 본문은 남이 쓴 글이다. HTML 로 넣으면 스크립트가 우리 주소에서 돈다 — 언제나 글자로.
 * #번호는 조회 없이 링크만 만든다(권한은 /t/번호 가 본다). 멘션은 딸려 온 이름으로만 푼다.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const show = (body: string, mentions: { userId: string; name: string }[] = []) =>
  render(<MessageBody body={body} mentions={mentions} meId="me00000000000000000000" />);

describe("메시지 본문", () => {
  it("HTML 은 글자로 남는다", () => {
    const { container } = show('<script>alert(1)</script> <b>굵게</b>');
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("#1042 는 /t/1042 링크, 자릿수가 넘치거나 글자에 붙으면 아니다", () => {
    show("출고준비 #1042 는 목요일까지. 코드#77 아님, #12345678901 도 아님");
    expect(screen.getByRole("link", { name: "#1042" }).getAttribute("href")).toBe("/t/1042");
    expect(screen.queryByRole("link", { name: "#77" })).toBeNull();
    expect(screen.queryByRole("link", { name: "#12345678901" })).toBeNull();
  });

  it("주소는 새 창 링크가 되고 우리 창을 넘기지 않는다", () => {
    show("문서: https://example.com/a?b=1 끝");
    const a = screen.getByRole("link", { name: "https://example.com/a?b=1" });
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("멘션 토큰은 이름으로, 모르는 사람은 '알 수 없음', 나는 다른 색", () => {
    const { container } = show("<@u1aaaaaaaaaaaaaaaaaaaaa> 와 <@zzzzzzzzzzzzzzzzzzzzzz> 그리고 <@me00000000000000000000> <@all>", [
      { userId: "u1aaaaaaaaaaaaaaaaaaaaa", name: "오세린" },
    ]);
    expect(screen.getByText("@오세린")).toBeTruthy();
    expect(screen.getByText("@알 수 없음")).toBeTruthy();
    expect(screen.getByText("@나")).toBeTruthy();
    expect(screen.getByText("@전체")).toBeTruthy();
    const me = container.querySelector('[data-mention="me00000000000000000000"]')!;
    expect(me.className).toContain("fff4ce");
    expect(container.textContent).not.toContain("<@");
  });
});
