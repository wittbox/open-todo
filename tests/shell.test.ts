import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { activeKeyOf, openPanel, shellNames, shellTitle } from "@/components/shell/shell";
import { DEFAULT_APP_NAME } from "@/lib/brand";
import { loadMessages } from "@/i18n/messages";
import type { SidebarData } from "@/lib/queries/sidebar";

/**
 * 폰·태블릿 셸의 순수 규칙 — 위 줄 제목과 '뒤로' 로 닫히는 상세 창.
 *
 * 좁은 화면에서는 상세 창이 본문을 덮는다. 열 때 기록을 남기지 않으면 휴대폰의 '뒤로' 가
 * 창을 닫지 않고 앱 밖으로 나간다(2026-09-17 모바일 작업).
 */

const list = (id: string, name: string) => ({ id, name }) as SidebarData["ungrouped"][number];

const DATA = {
  inboxListId: "inbox",
  groups: [{ lists: [list("l1", "기능 구현")] }],
  ungrouped: [list("inbox", "작업"), list("l2", "개인")],
  shared: [list("s1", "영업팀")],
  projects: [{ id: "p1", name: "해외 설치" }],
} as unknown as SidebarData;

describe("위 줄 제목", () => {
  const names = shellNames(DATA);
  // 고정 이름은 번역 파일에서 온다(nav.titles). 사용자가 지은 목록·프로젝트 이름은 그대로다.
  const titles = createTranslator({ locale: "ko", messages: loadMessages("ko"), namespace: "nav.titles" });
  const title = (pathname: string) => shellTitle(pathname, names, titles, DEFAULT_APP_NAME);

  it("주소마다 화면 이름 — 목록·공유받은 목록·프로젝트는 이름을 찾는다", () => {
    expect(title("/calendar")).toBe("달력");
    expect(title("/")).toBe("달력");
    expect(title("/list/l1")).toBe("기능 구현");
    expect(title("/list/s1")).toBe("영업팀");
    expect(title("/list/inbox")).toBe("작업");
    expect(title("/projects/p1")).toBe("해외 설치");
    expect(title("/projects")).toBe("프로젝트");
    expect(title("/reports/abc")).toBe("주간보고서");
    expect(title("/notifications")).toBe("알림");
  });

  it("모르는 목록·프로젝트나 주소는 뭉뚱그린 이름", () => {
    expect(title("/list/zzz")).toBe("목록");
    expect(title("/projects/zzz")).toBe("프로젝트");
    expect(title("/t/1042")).toBe(DEFAULT_APP_NAME);
  });

  it("사이드바 선택 열쇠는 전과 같다", () => {
    expect(activeKeyOf("/list/l1/x")).toBe("list:l1");
    expect(activeKeyOf("/projects/p1")).toBe("project:p1");
    expect(activeKeyOf("/")).toBe("calendar");
  });
});

describe("상세 창 열기", () => {
  afterEach(() => vi.unstubAllGlobals());
  const router = () => ({ push: vi.fn(), replace: vi.fn() });
  const media = (narrow: boolean) =>
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("max-width") ? narrow : !narrow }) });

  it("좁은 화면(1280px 미만)은 기록을 남긴다 — '뒤로' 가 창을 닫는다", () => {
    media(true);
    const r = router();
    openPanel(r, "/calendar?task=a");
    expect(r.push).toHaveBeenCalledWith("/calendar?task=a", { scroll: false });
    expect(r.replace).not.toHaveBeenCalled();
  });

  it("넓은 화면·폭을 모르는 곳은 지금처럼 바꿔치기", () => {
    media(false);
    const r = router();
    openPanel(r, "/calendar?task=a");
    expect(r.replace).toHaveBeenCalledWith("/calendar?task=a", { scroll: false });

    vi.stubGlobal("window", {});
    const r2 = router();
    openPanel(r2, "/calendar?task=b");
    expect(r2.replace).toHaveBeenCalled();
  });
});
