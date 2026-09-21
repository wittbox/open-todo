import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { HOME_PATH, RETIRED_VIEWS } from "@/lib/home";
import { internalPath } from "@/lib/http";
import { loginUrl } from "@/lib/actions/session-guard";

/**
 * 첫 화면은 달력이다(2026-09-16 에 '오늘 할 일 · 중요 · 계획된 일정' 을 합쳤다).
 *
 * 옛 주소는 즐겨찾기·메일·데스크톱 앱에 남아 있다. 404 가 아니라 달력으로 가야 하고,
 * 영구(308)로 보내면 브라우저가 기억해 버려 나중에 화면을 되살려도 못 돌아온다.
 */
describe("첫 화면", () => {
  it("달력이다 — 돌아갈 곳이 이상하거나 없을 때도", () => {
    expect(HOME_PATH).toBe("/calendar");
    expect(internalPath("//evil.example")).toBe("/calendar");
    expect(loginUrl("https://evil.example")).toBe("/login?returnTo=%2Fcalendar");
  });

  it("없앤 화면의 옛 주소는 달력으로 — 임시(307), 쿼리는 Next 가 그대로 넘긴다", async () => {
    const redirects = await nextConfig.redirects!();
    expect(RETIRED_VIEWS).toEqual(["/today", "/important", "/planned"]);
    expect(redirects).toEqual(
      RETIRED_VIEWS.map((source) => ({ source, destination: "/calendar", permanent: false })),
    );
  });
});
