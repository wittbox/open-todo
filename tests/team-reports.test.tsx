// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TeamCell, TeamReports as Data } from "@/lib/queries/report";

/** 팀 보고서 탭(팀장용) — 주별 목록과 제출 현황 표. 공유받지 않은 발행본은 상태만 보이고 열리지 않는다. */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { TeamReports } = await import("@/components/report/TeamReports");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const none: TeamCell = { status: "none", reportId: null, title: null, publishedAt: null, counts: null };
const data: Data = {
  members: [
    { userId: "me", name: "김하늘", avatarColor: "#c43e1c", isMe: true },
    { userId: "a", name: "이준", avatarColor: "#0f7b6c", isMe: false },
    { userId: "b", name: "박서연", avatarColor: "#8a8886", isMe: false },
    { userId: "c", name: "최도윤", avatarColor: "#c8c6c4", isMe: false },
  ],
  weeks: ["2026-10-05", "2026-09-28"],
  cells: {
    me: {
      "2026-10-05": { status: "published", reportId: "r1", title: "주간업무보고 - 개발팀 10월 9일", publishedAt: "2026-10-09T08:40:00.000Z", counts: { done: 11, inProgress: 6, upcoming: 4 } },
      "2026-09-28": none,
    },
    a: { "2026-10-05": { status: "published", reportId: null, title: null, publishedAt: "2026-10-10T00:12:00.000Z", counts: null }, "2026-09-28": none },
    b: { "2026-10-05": { status: "draft", reportId: null, title: null, publishedAt: null, counts: null }, "2026-09-28": none },
    c: { "2026-10-05": none, "2026-09-28": none },
  },
};

describe("팀 보고서", () => {
  it("주별 목록: 이번 주 팀원마다 한 줄 — 열 수 있는 것만 링크", () => {
    render(<TeamReports data={data} />);
    expect(screen.getByText(/발행 2 · 작성 중 1 · 없음 1/)).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "팀원 보고서" })).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/reports/r1");
    expect(rows[0].textContent).toContain("완료 11 · 진행 중 6 · 예정 4");
    // 발행 시각은 사용자 시간대·언어로 — 서울 기준 10/9 오후 5:40
    expect(rows[0].textContent).toContain("10. 9. (금) 오후 05:40");
    expect(within(rows[1]).queryByRole("link")).toBeNull();
    expect(rows[1].textContent).toContain("공유받지 않아 볼 수 없습니다");
    expect(rows[2].textContent).toContain("작성 중");
    expect(rows[3].textContent).toContain("아직 만들지 않음");
  });

  it("주 칩에 발행 수/팀원 수, 누르면 그 주로", () => {
    render(<TeamReports data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /9\/28\(월\) ~ 10\/4\(일\) · 0\/4/ }));
    expect(screen.getByText(/발행 0 · 작성 중 0 · 없음 4/)).toBeTruthy();
  });

  it("제출 현황 표: 공유받은 발행본은 날짜 링크, 아니면 잠긴 ‘발행’ — 고른 보기는 기억", () => {
    render(<TeamReports data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "제출 현황 표" }));
    const table = screen.getByRole("table", { name: "제출 현황 표" });
    expect(within(table).getByRole("link", { name: "10. 9." }).getAttribute("href")).toBe("/reports/r1");
    expect(within(table).getByTitle("발행됨 — 공유받지 않아 볼 수 없습니다").textContent).toContain("발행");
    expect(within(table).getAllByRole("link")).toHaveLength(1);
    expect(localStorage.getItem("todo.teamReportView")).toBe("table");
  });

  it("머리말은 나에게 공유한 사람 수", () => {
    render(<TeamReports data={data} />);
    expect(screen.getByText(/나에게 보고서를 공유한/).textContent).toContain("3명");
  });

  it("아직 아무도 공유하지 않았으면 안내만", () => {
    render(<TeamReports data={{ members: [], weeks: ["2026-10-05"], cells: {} }} />);
    expect(screen.getByText(/아직 나에게 보고서를 공유한 사람이 없습니다/)).toBeTruthy();
  });
});
