import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  clearedSessionCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/session-token";

// 쿠키 이름·유효기간·서명은 lib/session-token.ts 한 곳에만 있다.
// proxy 도 같은 파일을 쓴다 — 두 곳이 각자 만들면 언젠가 어긋난다.
export { COOKIE_NAME, MAX_AGE_SEC } from "@/lib/session-token";

/** 이 브라우저에 그 사람의 세션을 심는다. 토큰에는 지금의 세션 번호가 들어간다. */
export async function createSession(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } });
  (await cookies()).set(sessionCookieName(), await signSession(userId, user.sessionVersion), sessionCookieOptions());
}

export async function destroySession(): Promise<void> {
  (await cookies()).set(sessionCookieName(), "", clearedSessionCookieOptions());
}

/**
 * 쿠키가 있는데 쓸 수 없는 이유.
 * - `revoked`: 비밀번호 변경·"모든 기기에서 로그아웃"·권한 변경으로 세션 번호가 바뀌었다
 * - `disabled`: 관리자가 사용 중지했다
 * - `invalid`: 서명이 틀렸거나 만료됐거나 사람이 없다
 */
export type SessionProblem = "revoked" | "disabled" | "invalid";

type SessionState = { userId: string; problem: null } | { userId: null; problem: SessionProblem | null };

/**
 * 지금 요청의 세션. 요청마다 DB 를 한 번 본다(React cache) — 서명만 보면 끊은 세션도 7일 동안 살아 있다.
 */
export const readSession = cache(async (): Promise<SessionState> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return { userId: null, problem: null };
  const claims = await verifySession(token);
  if (!claims) return { userId: null, problem: "invalid" };
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { sessionVersion: true, disabledAt: true },
  });
  if (!user) return { userId: null, problem: "invalid" };
  if (user.disabledAt) return { userId: null, problem: "disabled" };
  if (user.sessionVersion !== claims.sv) return { userId: null, problem: "revoked" };
  return { userId: claims.sub, problem: null };
});

export async function getSessionUserId(): Promise<string | null> {
  return (await readSession()).userId;
}

/**
 * 그 사람의 모든 세션을 끊는다(세션 번호를 올린다). `keepCurrent` 면 이 브라우저에는 새 번호로 다시 심어 —
 * 비밀번호를 바꾼 기기에서는 계속 쓰고 다른 기기만 로그아웃되게 한다.
 */
export async function revokeSessions(userId: string, opts: { keepCurrent?: boolean } = {}): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  if (opts.keepCurrent) await createSession(userId);
}

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super("Not signed in.");
    this.name = "UnauthenticatedError";
  }
}

export async function requireUserId(): Promise<string> {
  const id = await getSessionUserId();
  if (!id) throw new UnauthenticatedError();
  return id;
}

export async function getCurrentUser() {
  const id = await getSessionUserId();
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, avatarColor: true, settings: true },
  });
}
