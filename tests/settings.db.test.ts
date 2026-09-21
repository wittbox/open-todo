import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

/**
 * 내 설정 (DB) — 언어·시간대·소속·아침 요약, 비밀번호 바꾸기, 연결된 계정 풀기.
 * 비밀번호를 바꾸거나 연결을 풀면 다른 기기의 세션이 끊긴다.
 */
let currentUser: string | null = null;
const cookieJar = new Map<string, string>();
vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return {
    ...actual,
    getSessionUserId: async () => currentUser,
    requireUserId: async () => {
      if (!currentUser) throw new actual.UnauthenticatedError();
      return currentUser;
    },
    revokeSessions: async (userId: string) => {
      await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieJar.has(n) ? { name: n, value: cookieJar.get(n)! } : undefined), set: (n: string, v: string) => cookieJar.set(n, v) }),
  headers: async () => new Headers(),
}));

const settings = await import("@/lib/actions/settings");
const { hashPassword, verifyPassword } = await import("@/lib/auth/password");

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
const tag = `set-${process.pid}`;
const PW = "correct horse battery";
let userId = "";

const user = () => prisma.user.findUniqueOrThrow({ where: { id: userId } });

beforeAll(async () => {
  if (!hasDb) return;
  userId = (
    await prisma.user.create({
      data: { email: `me-${tag}@example.com`, name: "나", emailVerifiedAt: new Date(), passwordHash: await hashPassword(PW) },
    })
  ).id;
  currentUser = userId;
});
afterAll(async () => {
  if (hasDb) await prisma.user.deleteMany({ where: { email: { contains: tag } } });
});

d("내 정보", () => {
  it("언어·시간대·소속·아침 요약을 저장한다", async () => {
    const res = await settings.saveProfile({ name: "  이 름  ", department: "영업팀", locale: "en", timeZone: "America/New_York", dailyMail: false });
    expect(res.ok).toBe(true);
    const u = await user();
    expect(u.name).toBe("이 름");
    expect(u.department).toBe("영업팀");
    expect(u.dailyMail).toBe(false);
    expect(u.settings).toMatchObject({ locale: "en", timeZone: "America/New_York" });
    // 로그인 전 화면도 같은 언어로 보이게 쿠키를 맞춘다.
    expect(cookieJar.get("NEXT_LOCALE")).toBe("en");
  });

  it("고를 수 없는 값은 거절한다", async () => {
    expect(await settings.saveProfile({ name: "나", department: "", locale: "xx", timeZone: "Asia/Seoul", dailyMail: true })).toMatchObject({ ok: false });
    expect(await settings.saveProfile({ name: "나", department: "", locale: "ko", timeZone: "Mars/Base", dailyMail: true })).toMatchObject({ ok: false });
    expect(await settings.saveProfile({ name: "   ", department: "", locale: "ko", timeZone: "Asia/Seoul", dailyMail: true })).toMatchObject({ ok: false });
  });
});

d("비밀번호", () => {
  it("지금 비밀번호가 맞아야 바꾼다", async () => {
    expect(await settings.changePassword("wrong password", "new long password", "new long password")).toMatchObject({ ok: false });
    expect(await settings.changePassword(PW, "new long password", "different")).toMatchObject({ ok: false });
    expect(await settings.changePassword(PW, "password1", "password1")).toMatchObject({ ok: false });
  });

  it("바꾸면 다른 기기의 세션이 끊긴다", async () => {
    const before = (await user()).sessionVersion;
    const NEW = "a much longer secret here";
    expect((await settings.changePassword(PW, NEW, NEW)).ok).toBe(true);
    const u = await user();
    expect(u.sessionVersion).toBe(before + 1);
    expect((await verifyPassword(u.passwordHash, NEW)).ok).toBe(true);
    expect((await verifyPassword(u.passwordHash, PW)).ok).toBe(false);
  });
});

d("연결된 계정", () => {
  it("마지막 로그인 방법은 풀 수 없다", async () => {
    await prisma.account.create({ data: { userId, provider: "GOOGLE", providerAccountId: `g-${tag}` } });
    // 비밀번호가 있으니 지금은 풀 수 있다.
    expect((await settings.unlinkProvider("GOOGLE")).ok).toBe(true);
    expect(await prisma.account.count({ where: { userId } })).toBe(0);

    // 비밀번호가 없는 사람은 하나뿐인 제공자를 풀 수 없다.
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await prisma.account.create({ data: { userId, provider: "GOOGLE", providerAccountId: `g2-${tag}` } });
    expect(await settings.unlinkProvider("GOOGLE")).toMatchObject({ ok: false });
    expect(await prisma.account.count({ where: { userId } })).toBe(1);
  });

  it("연결되지 않은 제공자는 풀 것도 없다", async () => {
    expect(await settings.unlinkProvider("NAVER")).toMatchObject({ ok: false });
  });
});

d("모든 기기에서 로그아웃", () => {
  it("세션 번호가 올라간다", async () => {
    const before = (await user()).sessionVersion;
    expect((await settings.signOutEverywhere()).ok).toBe(true);
    expect((await user()).sessionVersion).toBe(before + 1);
  });
});
