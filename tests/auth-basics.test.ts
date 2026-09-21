import { afterEach, describe, expect, it } from "vitest";
import { argon2 } from "node:crypto";
import { normalizeEmail, normalizeDomain, emailDomain } from "@/lib/auth/email";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { hitRateLimit, hitRateLimits, resetRateLimits } from "@/lib/auth/rate-limit";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { clientIp, isCrossSiteRequest } from "@/lib/http";
import { isSecureInstall, sessionCookieName } from "@/lib/session-token";

/**
 * 로그인의 바탕 — 이메일 정리, 비밀번호 저장·규칙, 시도 횟수 제한, 요청한 쪽 IP, 다른 사이트 요청 막기.
 */

afterEach(() => {
  resetRateLimits();
  delete process.env.TRUST_PROXY;
  delete process.env.APP_BASE_URL;
});

describe("이메일", () => {
  it("공백을 떼고 소문자로 맞춘다", () => {
    expect(normalizeEmail("  Kim.Chulsoo@Example.COM ")).toBe("kim.chulsoo@example.com");
  });

  it("이메일 모양이 아니면 null", () => {
    for (const bad of ["", "no-at", "a@b", "a@@b.com", "a b@c.com", "a@b.", "@b.com", 42, null, "x".repeat(250) + "@a.com"]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull();
    }
  });

  it("도메인", () => {
    expect(emailDomain("kim@team.example.com")).toBe("team.example.com");
    expect(normalizeDomain(" @Example.com ")).toBe("example.com");
    expect(normalizeDomain("not a domain")).toBeNull();
  });
});

describe("비밀번호 저장", () => {
  it("argon2id PHC 문자열로 저장하고 확인한다", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(await verifyPassword(stored, "correct horse battery")).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword(stored, "correct horse batterY")).ok).toBe(false);
  });

  it("같은 비밀번호도 저장값은 매번 다르다(소금)", async () => {
    expect(await hashPassword("same password here")).not.toBe(await hashPassword("same password here"));
  });

  it("예전 매개변수로 저장된 것은 맞으면 다시 저장하라고 알린다", async () => {
    const salt = Buffer.alloc(16, 7);
    const tag = await new Promise<Buffer>((res, rej) =>
      argon2("argon2id", { message: Buffer.from("old but gold"), nonce: salt, parallelism: 1, tagLength: 32, memory: 8192, passes: 1 }, (e, k) =>
        e ? rej(e) : res(Buffer.from(k)),
      ),
    );
    const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
    const old = `$argon2id$v=19$m=8192,t=1,p=1$${b64(salt)}$${b64(tag)}`;
    expect(await verifyPassword(old, "old but gold")).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPassword(old, "wrong")).toEqual({ ok: false, needsRehash: false });
  });

  it("저장값이 없거나 깨졌으면 틀린 것으로 본다", async () => {
    for (const bad of [null, undefined, "", "plain-text", "$argon2id$v=19$m=99999999,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA"]) {
      expect((await verifyPassword(bad, "anything")).ok).toBe(false);
    }
  });

  it("같은 글자를 다르게 입력해도 같은 비밀번호다(NFKC)", async () => {
    const stored = await hashPassword("ﬁsh and chips");
    expect((await verifyPassword(stored, "fish and chips")).ok).toBe(true);
  });
});

describe("비밀번호 규칙 — 8자 이상, 흔한 것 차단, 조합 강요 없음", () => {
  it("짧거나 너무 길면 안 된다", async () => {
    expect(await passwordProblem("short")).toBe("tooShort");
    expect(await passwordProblem("x".repeat(257))).toBe("tooLong");
  });

  it("흔한 비밀번호는 안 된다 — 대소문자를 바꿔도", async () => {
    for (const common of ["password", "Password1", "qwerty123", "iloveyou", "11111111", "aaaaaaaaaa"]) {
      expect(await passwordProblem(common), common).toBe("common");
    }
  });

  it("이메일(또는 @ 앞)을 그대로 쓰면 안 된다", async () => {
    expect(await passwordProblem("chulsoo.kim", "chulsoo.kim@example.com")).toBe("common");
  });

  it("글자 종류를 섞지 않아도 길고 흔하지 않으면 된다", async () => {
    expect(await passwordProblem("correct horse battery staple")).toBeNull();
    expect(await passwordProblem("김철수의긴비밀번호")).toBeNull();
  });
});

describe("링크 토큰", () => {
  it("링크에는 무작위 값, 저장에는 그 해시", () => {
    const { token, tokenHash } = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toContain(token);
  });
});

describe("시도 횟수 제한", () => {
  it("창 안에서 한도까지만 된다", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(hitRateLimit("k", 3, 60_000, now).ok).toBe(true);
    const r = hitRateLimit("k", 3, 60_000, now + 10_000);
    expect(r).toEqual({ ok: false, retryAfterSec: 50 });
    expect(hitRateLimit("k", 3, 60_000, now + 60_000).ok).toBe(true); // 새 창
  });

  it("여러 열쇠 중 하나라도 넘으면 거절", () => {
    const now = 2_000_000;
    const rules = [
      { key: "ip", limit: 5, windowMs: 60_000 },
      { key: "email", limit: 1, windowMs: 60_000 },
    ];
    expect(hitRateLimits(rules, now).ok).toBe(true);
    expect(hitRateLimits(rules, now).ok).toBe(false);
  });
});

describe("요청한 쪽 IP", () => {
  const h = (xff: string) => new Headers({ "x-forwarded-for": xff });

  it("프록시 뒤라고 설정하지 않으면 헤더를 믿지 않는다", () => {
    expect(clientIp(h("1.2.3.4"))).toBeNull();
  });

  it("프록시가 붙인 오른쪽 값을 읽는다 — 왼쪽은 지어낸 것일 수 있다", () => {
    process.env.TRUST_PROXY = "1";
    expect(clientIp(h("6.6.6.6, 10.0.0.5"))).toBe("10.0.0.5");
    process.env.TRUST_PROXY = "2";
    expect(clientIp(h("6.6.6.6, 10.0.0.5, 172.16.0.1"))).toBe("10.0.0.5");
  });
});

describe("다른 사이트가 시킨 요청", () => {
  it("Sec-Fetch-Site 로 판단한다", () => {
    expect(isCrossSiteRequest(new Headers({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteRequest(new Headers({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteRequest(new Headers({ "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("없으면 Origin 을 설치 주소와 비교한다", () => {
    process.env.APP_BASE_URL = "https://todo.example.com";
    expect(isCrossSiteRequest(new Headers({ origin: "https://todo.example.com" }))).toBe(false);
    expect(isCrossSiteRequest(new Headers({ origin: "https://evil.example" }))).toBe(true);
    // 브라우저가 아닌 곳(스크립트)은 CSRF 가 아니다.
    expect(isCrossSiteRequest(new Headers())).toBe(false);
  });
});

describe("세션 쿠키 이름", () => {
  it("https 설치에서는 __Host- 를 붙이고 Secure 로 심는다", () => {
    process.env.APP_BASE_URL = "https://todo.example.com";
    expect(isSecureInstall()).toBe(true);
    expect(sessionCookieName()).toBe("__Host-todo_session");
  });

  it("내부망(LAN) http 설치에서는 Secure 없이 — 붙이면 브라우저가 쿠키를 버려 로그인이 안 된다", () => {
    process.env.APP_BASE_URL = "http://192.0.2.10:3000";
    expect(isSecureInstall()).toBe(false);
    expect(sessionCookieName()).toBe("todo_session");
  });
});
