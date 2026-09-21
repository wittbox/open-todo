import { SignJWT, jwtVerify } from "jose";

/**
 * 세션 쿠키의 이름·옵션·서명.
 *
 * lib/session.ts 는 next/headers 와 Prisma 를 끌어온다. proxy 는 쿠키 서명만 보면 되므로
 * 가벼운 이 파일만 쓴다. 두 곳이 쿠키를 각자 만들면 이름이나 유효기간이 어긋나는 날이 온다 —
 * 그래서 쿠키에 관한 사실은 전부 여기 한 곳에 둔다.
 *
 * 토큰에는 사용자 id(sub)와 **세션 번호(sv)** 가 들어간다. 비밀번호를 바꾸거나 "모든 기기에서 로그아웃" 하면
 * DB 의 User.sessionVersion 이 올라가고, 번호가 다른 토큰은 lib/session.ts 가 받지 않는다.
 */

export const COOKIE_NAME = "todo_session";
export const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7일

/**
 * 발급 후 하루가 지났으면 새로 발급한다.
 *
 * 쓰는 동안에는 로그아웃되지 않게 7일 만료를 뒤로 민다. 그렇다고 요청마다 새로 서명하면
 * 프리페치·RSC 요청까지 전부 서명 비용을 물게 된다 — 하루에 한 번이면 충분하다.
 */
export const RENEW_AFTER_SEC = 60 * 60 * 24;

export function shouldRenew(issuedAtSec: unknown, nowSec: number): boolean {
  if (typeof issuedAtSec !== "number" || !Number.isFinite(issuedAtSec)) return false;
  // 시계가 어긋나 미래에 발급된 것으로 보이면 건드리지 않는다.
  if (issuedAtSec > nowSec) return false;
  return nowSec - issuedAtSec >= RENEW_AFTER_SEC;
}

/**
 * https 로 여는 설치인가. `APP_BASE_URL` 로 판단한다 — 내부망(LAN)에서 http 로 여는 설치에서
 * Secure 쿠키를 심으면 브라우저가 버려서 조용히 로그인이 안 된다.
 */
export function isSecureInstall(): boolean {
  const base = process.env.APP_BASE_URL;
  if (base) return base.startsWith("https://");
  return process.env.NODE_ENV === "production";
}

/**
 * https 설치에서는 `__Host-` 를 붙인다 — 브라우저가 Secure·Path=/·도메인 없음을 강제해,
 * 하위 도메인이나 http 페이지가 이 쿠키를 덮어쓸 수 없다.
 */
export function sessionCookieName(): string {
  return isSecureInstall() ? `__Host-${COOKIE_NAME}` : COOKIE_NAME;
}

export function sessionSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET is missing or shorter than 32 characters. Generate one with: openssl rand -hex 32");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(userId: string, sessionVersion: number): Promise<string> {
  return new SignJWT({ sub: userId, sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(sessionSecret());
}

export type SessionClaims = { sub: string; sv: number; iat: number | null };

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    // 세션 번호가 없는 토큰은 받지 않는다 — 끊을 수 없는 세션이 된다.
    if (typeof payload.sv !== "number" || !Number.isInteger(payload.sv) || payload.sv < 0) return null;
    return { sub: payload.sub, sv: payload.sv, iat: typeof payload.iat === "number" ? payload.iat : null };
  } catch {
    return null;
  }
}

/** 쿠키를 심는 모든 자리가 같은 옵션을 쓰도록. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureInstall(),
    path: "/",
    maxAge: MAX_AGE_SEC,
  };
}

/** 지우는 쿠키도 같은 성질이어야 한다 — `__Host-` 쿠키는 Secure 없이 지우라고 하면 브라우저가 무시한다. */
export function clearedSessionCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0 };
}
