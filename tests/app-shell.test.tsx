// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppShell, useShell } from "@/components/shell/AppShell";

/**
 * 폰·태블릿 셸. 1024px 보다 좁거나 메뉴를 접으면 사이드바가 서랍이 된다.
 *
 * jsdom 에는 화면 폭이 없어 CSS 가 숨기는 것(lg:hidden)은 여기서 볼 수 없다 — 그건 브라우저에서
 * 확인했다. 여기서는 서랍이 열리고 닫히는 길과 접은 상태가 쿠키에 남는 것을 못박는다.
 */

let pathname = "/list/l1";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  pathname = "/list/l1";
  document.cookie = "side_collapsed=; max-age=0; path=/";
  // 폰 폭: 메뉴가 붙을 수 없다
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

function FakeSidebar() {
  const shell = useShell();
  return (
    <nav>
      <a href="/calendar" onClick={(e) => e.preventDefault()}>
        달력
      </a>
      <button type="button" onClick={shell.toggleCollapsed}>
        {shell.collapsed ? "메뉴 고정" : "메뉴 접기"}
      </button>
      <button type="button" onClick={shell.close}>
        메뉴 닫기
      </button>
    </nav>
  );
}

function show(initialCollapsed = false) {
  return render(
    <AppShell
      names={{ inboxListId: null, lists: { l1: "기능 구현" }, projects: {} }}
      unreadCount={3}
      initialCollapsed={initialCollapsed}
      sidebar={<FakeSidebar />}
    >
      <main>본문</main>
    </AppShell>,
  );
}

const frame = () => document.querySelector("[data-sidebar-frame]") as HTMLElement;
const backdrop = () => document.querySelector("[data-drawer-backdrop]");
const menuButton = () => screen.getByRole("button", { name: "메뉴 열기" });

describe("서랍", () => {
  it("위 줄에 지금 화면 이름과 알림 수. 처음에는 닫혀 있고 폰 폭에서는 사이드바에 손이 닿지 않는다", () => {
    show();
    expect(screen.getByText("기능 구현")).toBeTruthy();
    expect(screen.getByRole("link", { name: "알림 3개" }).getAttribute("href")).toBe("/notifications");
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    expect(frame().hasAttribute("inert")).toBe(true);
    expect(backdrop()).toBeNull();
  });

  it("☰ 로 열고, 바깥을 누르면 닫힌다", () => {
    show();
    fireEvent.click(menuButton());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(frame().hasAttribute("inert")).toBe(false);
    fireEvent.click(backdrop()!);
    expect(backdrop()).toBeNull();
  });

  it("Esc, 닫기 버튼, 서랍 안의 링크로도 닫힌다", () => {
    show();
    fireEvent.click(menuButton());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(backdrop()).toBeNull();

    fireEvent.click(menuButton());
    fireEvent.click(screen.getByRole("button", { name: "메뉴 닫기" }));
    expect(backdrop()).toBeNull();

    // 지금 화면과 같은 주소를 눌러도 닫혀야 한다
    fireEvent.click(menuButton());
    fireEvent.click(screen.getByRole("link", { name: "달력" }));
    expect(backdrop()).toBeNull();
  });

  it("다른 화면으로 옮기면 닫힌다", () => {
    const { rerender } = show();
    fireEvent.click(menuButton());
    pathname = "/calendar";
    rerender(
      <AppShell names={{ inboxListId: null, lists: {}, projects: {} }} unreadCount={0} initialCollapsed={false} sidebar={<FakeSidebar />}>
        <main>본문</main>
      </AppShell>,
    );
    expect(backdrop()).toBeNull();
    expect(screen.getByText("달력", { selector: "span" })).toBeTruthy();
  });

  it("메뉴 접기는 쿠키에 남아 다음에도 접힌 채로 그린다", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "메뉴 접기" }));
    expect(document.cookie).toContain("side_collapsed=1");
    fireEvent.click(screen.getByRole("button", { name: "메뉴 고정" }));
    expect(document.cookie).toContain("side_collapsed=0");
  });
});
