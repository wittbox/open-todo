import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AuthProvider } from "@/app/generated/prisma/enums";
import { isSecureInstall, sessionSecret } from "@/lib/session-token";

/**
 * 제공자에 다녀오는 동안 이 브라우저가 들고 있는 것 — 서명한 짧은 쿠키.
 *
 * - `oauth_tx`(10분): state·PKCE verifier·nonce·돌아갈 곳·의도(로그인/연결)·초대. 콜백에서 한 번 쓰고 지운다.
 *   남이 자기 code 를 내 브라우저에 밀어 넣어도(로그인 CSRF) state 가 이 쿠키와 맞지 않아 거절된다.
 * - `oauth_pending`(30분): 이메일을 확인해 주지 않는 제공자로 처음 온 사람 — 이메일을 적는 화면까지 들고 간다.
 *
 * 둘 다 Path=/auth 라 앱의 다른 요청에는 실리지 않는다. 세션 쿠키와 같은 열쇠로 서명하되 `aud` 로 구분한다
 * (서로 바꿔 끼워 쓸 수 없다).
 */

export const TX_COOKIE = "oauth_tx";
export const PENDING_COOKIE = "oauth_pending";
const TX_TTL_SEC = 10 * 60;
const PENDING_TTL_SEC = 30 * 60;

export const randomToken = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export type OAuthTx = {
  provider: AuthProvider;
  state: string;
  verifier: string;
  nonce: string;
  returnTo: string;
  /** 로그인·가입, 또는 로그인한 사람이 설정에서 시작한 연결 */
  intent: "login" | "link";
  /** intent=link 일 때 시작한 사람 — 콜백에서 지금 세션과 같은지 다시 본다 */
  linkUserId?: string;
  /** 가입 초대 토큰 */
  invite?: string;
};

export type OAuthPending = {
  provider: AuthProvider;
  providerAccountId: string;
  name: string | null;
  /** 제공자가 준 주소(확인 안 됨) — 칸에 미리 채울 뿐 */
  suggestedEmail: string | null;
  invite?: string;
};

export function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: isSecureInstall(), path: "/auth", maxAge };
}

async function sign(payload: Record<string, unknown>, aud: string, ttlSec: number): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setAudience(aud).setIssuedAt().setExpirationTime(`${ttlSec}s`).sign(sessionSecret());
}

async function read<T>(token: string | undefined, aud: string): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { audience: aud, algorithms: ["HS256"] });
    return payload as unknown as T;
  } catch {
    return null;
  }
}

export const signTx = (tx: OAuthTx) => sign(tx, TX_COOKIE, TX_TTL_SEC);
export const readTx = (token: string | undefined) => read<OAuthTx>(token, TX_COOKIE);
export const TX_MAX_AGE = TX_TTL_SEC;

export const signPending = (p: OAuthPending) => sign(p, PENDING_COOKIE, PENDING_TTL_SEC);
export const readPending = (token: string | undefined) => read<OAuthPending>(token, PENDING_COOKIE);
export const PENDING_MAX_AGE = PENDING_TTL_SEC;
