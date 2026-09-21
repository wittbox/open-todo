import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

/**
 * 세션 끊기 (DB).
 *
 * 쿠키 서명만 보면 한 번 준 세션은 7일 동안 살아 있다. 비밀번호를 바꾸거나 관리자가 막으면 그 자리에서
 * 끊겨야 한다 — 쿠키의 세션 번호(sv)를 요청마다 DB 와 비교한다.
 */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (opts?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

const session = await import("@/lib/session");

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
let userId: string;

beforeAll(async () => {
  process.env.SESSION_SECRET ??= "test-session-secret-0123456789abcdef0123456789";
  if (!hasDb) return;
  userId = (await prisma.user.create({ data: { email: `sess-${process.pid}@x.test`, name: "세션" } })).id;
});
afterAll(async () => {
  if (hasDb) await prisma.user.delete({ where: { id: userId } });
});
beforeEach(() => jar.clear());

d("세션", () => {
  it("심은 세션으로 들어온다", async () => {
    await session.createSession(userId);
    expect(await session.getSessionUserId()).toBe(userId);
  });

  it("세션 번호가 오르면 모든 세션이 끊긴다", async () => {
    await session.createSession(userId);
    const other = new Map(jar); // 다른 기기
    await session.revokeSessions(userId);
    expect(await session.readSession()).toEqual({ userId: null, problem: "revoked" });
    jar.clear();
    for (const [k, v] of other) jar.set(k, v);
    expect(await session.getSessionUserId()).toBeNull();
  });

  it("비밀번호를 바꾼 이 기기는 새 번호로 계속 쓴다", async () => {
    await session.createSession(userId);
    const other = new Map(jar);
    await session.revokeSessions(userId, { keepCurrent: true });
    expect(await session.getSessionUserId()).toBe(userId);
    jar.clear();
    for (const [k, v] of other) jar.set(k, v);
    expect(await session.getSessionUserId()).toBeNull();
  });

  it("사용 중지된 사람의 세션은 받지 않는다", async () => {
    await session.createSession(userId);
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    expect(await session.readSession()).toEqual({ userId: null, problem: "disabled" });
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: null } });
    expect(await session.getSessionUserId()).toBe(userId);
  });

  it("로그아웃하면 쿠키가 지워진다", async () => {
    await session.createSession(userId);
    await session.destroySession();
    expect(jar.size).toBe(0);
    expect(await session.readSession()).toEqual({ userId: null, problem: null });
  });

  it("쓰레기 쿠키는 invalid", async () => {
    jar.set("todo_session", "garbage");
    expect(await session.readSession()).toEqual({ userId: null, problem: "invalid" });
  });
});
