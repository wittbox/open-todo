import { describe, expect, it } from "vitest";
import { internalPath, redirectTo } from "@/lib/http";

/**
 * 리다이렉트가 절대 URL 이면 프록시 뒤에서 컨테이너 바인드 주소가 새어 나간다.
 * 실제로 테스트 로그인이 https://0.0.0.0:3000 으로 보내 브라우저가
 * ERR_ADDRESS_INVALID 로 멈췄다. 상태 코드만 확인하면 이 버그가 통과하므로
 * Location 값 자체를 못박는다.
 */

describe("redirectTo", () => {
  it("Location 이 상대 경로다 — 스킴도 호스트도 없다", () => {
    const res = redirectTo("/calendar");
    const loc = res.headers.get("Location")!;
    expect(loc).toBe("/calendar");
    expect(loc).not.toMatch(/^https?:\/\//);
    expect(loc).not.toContain("0.0.0.0");
    expect(loc).not.toContain("localhost");
  });

  it("쿼리 문자열을 그대로 지킨다", () => {
    expect(redirectTo("/list/abc?task=xyz").headers.get("Location")).toBe("/list/abc?task=xyz");
  });

  it("상태 코드는 기본 307, 로그아웃은 303", () => {
    expect(redirectTo("/calendar").status).toBe(307);
    expect(redirectTo("/login", 303).status).toBe(303);
  });

  it("본문이 없다", async () => {
    expect(await redirectTo("/calendar").text()).toBe("");
  });
});

describe("internalPath", () => {
  it("앱 내부 경로는 그대로 통과", () => {
    expect(internalPath("/calendar")).toBe("/calendar");
    expect(internalPath("/list/abc?task=1")).toBe("/list/abc?task=1");
    expect(internalPath("/t/1042")).toBe("/t/1042");
  });

  it("스킴 상대 URL 로 외부에 나가지 못한다", () => {
    expect(internalPath("//evil.example")).toBe("/calendar");
    expect(internalPath("//evil.example/path")).toBe("/calendar");
  });

  it("절대 URL 을 거절한다", () => {
    expect(internalPath("https://evil.example")).toBe("/calendar");
    expect(internalPath("http://evil.example")).toBe("/calendar");
  });

  it("역슬래시 우회를 거절한다", () => {
    expect(internalPath("/\\evil.example")).toBe("/calendar");
  });

  it("경로가 아니면 대체 경로로 보낸다", () => {
    expect(internalPath("")).toBe("/calendar");
    expect(internalPath("today")).toBe("/calendar");
    expect(internalPath("javascript:alert(1)")).toBe("/calendar");
  });

  it("대체 경로를 지정할 수 있다", () => {
    expect(internalPath("//evil.example", "/login")).toBe("/login");
  });
});
