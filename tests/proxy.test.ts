import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { proxy } from "@/proxy";
import { COOKIE_NAME, RENEW_AFTER_SEC } from "@/lib/session-token";

/**
 * 인증 관문. 어떤 경로가 로그인 없이 열리는지가 여기 한 줄에 달려 있어,
 * 실수로 목록이 늘어나면 곧바로 데이터가 새는 자리다.
 *
 * 리다이렉트는 도착지 문자열까지 못박는다 — 상태 코드만 보면 엉뚱한 호스트로
 * 보내도 통과한다(실제로 그 버그가 있었다).
 */

const SECRET = "test-session-secret-0123456789abcdef0123456789";

async function signed(sub: string, opts: { expired?: boolean; issuedAgoSec?: number; sv?: number | null } = {}) {
  const iat = Math.floor(Date.now() / 1000) - (opts.issuedAgoSec ?? 0);
  return new SignJWT(opts.sv === null ? { sub } : { sub, sv: opts.sv ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(opts.expired ? "-1h" : "1h")
    .sign(new TextEncoder().encode(SECRET));
}

function request(path: string, cookie?: string) {
  return new NextRequest(`https://todo.example.com${path}`, {
    headers: cookie ? { cookie: `todo_session=${cookie}` } : {},
  });
}

beforeAll(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("로그인 없이 열리는 경로", () => {
  it.each([
    "/login",
    "/login?returnTo=%2Ftoday",
    "/signup",
    "/forgot-password",
    "/reset-password?token=abc",
    "/join/abc",
    "/auth/google/start",
    "/auth/signout",
    "/api/health",
    // 서버의 cron 이 세션 없이 부른다. 문은 그 라우트의 열쇠가 지킨다.
    "/api/cron/tick",
  ])(
    "%s 는 그대로 통과",
    async (path) => {
      const res = await proxy(request(path));
      expect(res.headers.get("Location")).toBeNull();
      expect(res.status).toBe(200);
    },
  );

  it("공개 경로는 경로 경계까지 맞아야 한다 — 이름만 비슷한 경로는 열리지 않는다", async () => {
    for (const path of ["/authx", "/auth-other", "/loginx", "/signupx", "/joinx", "/api/healthz", "/api/cronjob"]) {
      const res = await proxy(request(path));
      expect(res.headers.get("Location"), path).toContain("/login");
    }
  });

  it("예전 개발용 로그인(/api/auth/...)은 더 이상 열려 있지 않다", async () => {
    for (const path of ["/api/auth/mock", "/api/auth/logout"]) {
      expect((await proxy(request(path))).headers.get("Location"), path).toContain("/login");
    }
  });

  it("공개 보고서 경로(/r/)는 더 이상 예외가 아니다", async () => {
    const res = await proxy(request("/r/sometoken"));
    expect(res.headers.get("Location")).toContain("/login");
  });
});

describe("로그인이 필요한 경로", () => {
  it.each(["/today", "/important", "/planned", "/calendar", "/projects", "/projects/abc", "/api/projects/abc/messages", "/tasks", "/reports", "/list/abc", "/t/1042", "/api/search"])(
    "%s 는 쿠키가 없으면 로그인으로 보낸다",
    async (path) => {
      const res = await proxy(request(path));
      expect(res.status).toBe(307);
      expect(res.headers.get("Location")).toContain("/login?returnTo=");
    },
  );

  it("원래 가려던 경로를 returnTo 로 넘긴다", async () => {
    const res = await proxy(request("/list/abc?task=xyz"));
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("returnTo")).toBe("/list/abc?task=xyz");
  });

  it("사용자가 요청한 호스트를 유지한다 — 내부 주소로 보내지 않는다", async () => {
    const res = await proxy(request("/today"));
    const loc = res.headers.get("Location")!;
    expect(loc).toContain("todo.example.com");
    expect(loc).not.toContain("0.0.0.0");
    expect(loc).not.toContain("localhost");
  });
});

describe("세션 쿠키 검증", () => {
  it("정상 쿠키면 통과", async () => {
    const res = await proxy(request("/today", await signed("user-1")));
    expect(res.headers.get("Location")).toBeNull();
  });

  it("만료된 쿠키는 막는다", async () => {
    const res = await proxy(request("/today", await signed("user-1", { expired: true })));
    expect(res.headers.get("Location")).toContain("/login");
  });

  it("서명이 다른 쿠키는 막는다", async () => {
    const forged = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("완전히-다른-비밀키-0123456789abcdef"));
    const res = await proxy(request("/today", forged));
    expect(res.headers.get("Location")).toContain("/login");
  });

  it("세션 번호(sv)가 없는 토큰은 막는다 — 끊을 수 없는 세션이 된다", async () => {
    const res = await proxy(request("/today", await signed("user-1", { sv: null })));
    expect(res.headers.get("Location")).toContain("/login");
  });

  it("쓰레기 값은 막는다", async () => {
    const res = await proxy(request("/today", "not-a-jwt"));
    expect(res.headers.get("Location")).toContain("/login");
  });
});

/**
 * 세션 자동 연장.
 * 데스크톱 앱은 창을 몇 주씩 열어 둔다. 쓰는 동안에는 만료가 뒤로 밀려야 한다.
 */
describe("세션 자동 연장", () => {
  it("발급한 지 하루가 지난 쿠키는 새로 심어 준다", async () => {
    const res = await proxy(request("/today", await signed("user-1", { issuedAgoSec: RENEW_AFTER_SEC + 60 })));
    const fresh = res.cookies.get(COOKIE_NAME);
    expect(fresh?.value).toBeTruthy();
    // 이름·성질이 달라지면 기존 로그인이 끊기거나 보호가 약해진다.
    expect(fresh?.httpOnly).toBe(true);
    expect(fresh?.sameSite).toBe("lax");
    expect(fresh?.path).toBe("/");
    expect(res.headers.get("Location")).toBeNull();
  });

  it("갓 발급한 쿠키는 건드리지 않는다", async () => {
    const res = await proxy(request("/today", await signed("user-1")));
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("연장한 쿠키도 같은 사용자여야 한다", async () => {
    const res = await proxy(request("/today", await signed("user-9", { issuedAgoSec: RENEW_AFTER_SEC + 60 })));
    const { payload } = await jwtVerify(res.cookies.get(COOKIE_NAME)!.value, new TextEncoder().encode(SECRET));
    expect(payload.sub).toBe("user-9");
  });

  it("연장해도 세션 번호는 그대로다 — 빠뜨리면 하루 뒤 모두 로그아웃된다", async () => {
    const res = await proxy(request("/today", await signed("user-9", { issuedAgoSec: RENEW_AFTER_SEC + 60, sv: 7 })));
    const { payload } = await jwtVerify(res.cookies.get(COOKIE_NAME)!.value, new TextEncoder().encode(SECRET));
    expect(payload.sv).toBe(7);
  });

  it("만료된 쿠키는 연장하지 않고 로그인으로 보낸다", async () => {
    const res = await proxy(request("/today", await signed("user-1", { expired: true })));
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
    expect(res.headers.get("Location")).toContain("/login");
  });
});
