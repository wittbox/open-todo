import { describe, expect, it } from "vitest";
import {
  COOKIE_NAME,
  MAX_AGE_SEC,
  RENEW_AFTER_SEC,
  sessionCookieOptions,
  shouldRenew,
} from "@/lib/session-token";

/**
 * 세션 자동 연장.
 *
 * 쿠키는 7일짜리다. 앱을 며칠씩 열어 두고 쓰면 작업 도중에 튕긴다.
 * 그래서 쓰는 동안에는 만료를 계속 뒤로 민다. 대신 하루에 한 번만 민다 —
 * proxy 는 프리페치와 RSC 요청에도 걸려서 요청마다 서명하면 그 비용이 다 붙는다.
 */

const now = 1_800_000_000; // 초 단위

describe("언제 다시 발급하는가", () => {
  it("발급한 지 하루가 지나면 연장한다", () => {
    expect(shouldRenew(now - RENEW_AFTER_SEC, now)).toBe(true);
    expect(shouldRenew(now - 3 * RENEW_AFTER_SEC, now)).toBe(true);
  });

  it("하루가 안 됐으면 그대로 둔다", () => {
    expect(shouldRenew(now - 60, now)).toBe(false);
    expect(shouldRenew(now - (RENEW_AFTER_SEC - 1), now)).toBe(false);
  });

  it("시계가 어긋나 미래에 발급된 것으로 보이면 건드리지 않는다", () => {
    // 여기서 연장해 버리면 시계가 틀어진 PC 가 접속할 때마다 새 쿠키를 받는다.
    expect(shouldRenew(now + 10_000, now)).toBe(false);
  });

  it("발급 시각이 없거나 이상하면 연장하지 않는다", () => {
    expect(shouldRenew(undefined, now)).toBe(false);
    expect(shouldRenew("어제", now)).toBe(false);
    expect(shouldRenew(Number.NaN, now)).toBe(false);
  });
});

describe("쿠키 규격", () => {
  it("연장해도 이름과 성질은 그대로다", () => {
    // 이름이 바뀌면 기존 로그인이 전부 끊긴다. 옵션이 느슨해지면 보호가 약해진다.
    expect(COOKIE_NAME).toBe("todo_session");
    const o = sessionCookieOptions();
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.path).toBe("/");
    expect(o.maxAge).toBe(MAX_AGE_SEC);
  });

  it("연장 주기는 유효기간보다 짧아야 한다", () => {
    // 이게 뒤집히면 '연장'이 영영 일어나지 않아 규칙이 죽은 코드가 된다.
    expect(RENEW_AFTER_SEC).toBeLessThan(MAX_AGE_SEC);
  });
});
