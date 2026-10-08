// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

/**
 * 이슈 화면 자동 새로고침. 몇 초마다 '바뀜 표시' 만 묻고, 서버가 그린 화면과 다를 때만 다시 그린다.
 * 아무 일 없을 때 목록 전체를 다시 받지 않는 것이 요점이다.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { useIssueRefresh, ISSUE_POLL_MS } = await import("@/components/issues/useIssueRefresh");

let answer: { status: number; stamp?: string };
const fetchMock = vi.fn(async () => ({ ok: answer.status === 200, json: async () => ({ stamp: answer.stamp }) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  refresh.mockClear();
  fetchMock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = () => act(() => vi.advanceTimersByTimeAsync(ISSUE_POLL_MS));

describe("이슈 자동 새로고침", () => {
  it("표시가 같으면 묻기만 하고 다시 그리지 않는다", async () => {
    answer = { status: 200, stamp: "1.100" };
    renderHook(() => useIssueRefresh("p1", "1.100"));
    await tick();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/issues", { cache: "no-store" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("남이 바꿔 표시가 달라지면 한 번 다시 그리고, 같은 표시로는 또 그리지 않는다", async () => {
    answer = { status: 200, stamp: "1.200" };
    renderHook(() => useIssueRefresh("p1", "1.100"));
    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("내 동작 뒤 서버가 새 표시로 다시 그리면 그것을 기준으로 삼는다", async () => {
    answer = { status: 200, stamp: "2.300" };
    const { rerender } = renderHook(({ stamp }) => useIssueRefresh("p1", stamp), { initialProps: { stamp: "1.100" } });
    rerender({ stamp: "2.300" });
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("로그아웃·권한 없음 응답에는 조용히 쉰다", async () => {
    answer = { status: 401 };
    renderHook(() => useIssueRefresh("p1", "1.100"));
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("탭이 숨겨져 있으면 묻지 않는다", async () => {
    answer = { status: 200, stamp: "9.9" };
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useIssueRefresh("p1", "1.100"));
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    vis.mockRestore();
  });
});
