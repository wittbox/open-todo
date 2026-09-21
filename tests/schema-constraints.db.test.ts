import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

/**
 * 마이그레이션에 손으로 넣은 제약(Prisma 스키마에는 적을 수 없다).
 * 코드가 실수해도 DB 가 마지막으로 막는다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
const suffix = `constraints-${process.pid}`;

d("DB 제약", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
  });

  it("이메일은 소문자로만 저장된다 — 대소문자만 다른 두 계정이 생기지 않게", async () => {
    await expect(prisma.user.create({ data: { email: `Mixed-${suffix}@X.test`, name: "대문자" } })).rejects.toThrow();
    const ok = await prisma.user.create({ data: { email: `lower-${suffix}@x.test`, name: "소문자" } });
    expect(ok.email).toBe(`lower-${suffix}@x.test`);
  });

  it("설치 설정은 한 행뿐이다", async () => {
    await expect(prisma.instanceSettings.create({ data: { id: `second-${suffix}` } })).rejects.toThrow();
  });

  it("제공자 계정 하나는 한 사람에게만, 한 사람은 제공자마다 하나만 붙는다", async () => {
    const [a, b] = await Promise.all(
      ["a", "b"].map((k) => prisma.user.create({ data: { email: `acct-${k}-${suffix}@x.test`, name: k } })),
    );
    await prisma.account.create({ data: { userId: a.id, provider: "GOOGLE", providerAccountId: `g-${suffix}` } });
    await expect(
      prisma.account.create({ data: { userId: b.id, provider: "GOOGLE", providerAccountId: `g-${suffix}` } }),
    ).rejects.toThrow();
    await expect(
      prisma.account.create({ data: { userId: a.id, provider: "GOOGLE", providerAccountId: `g2-${suffix}` } }),
    ).rejects.toThrow();
    // 다른 제공자는 붙는다.
    await prisma.account.create({ data: { userId: a.id, provider: "KAKAO", providerAccountId: `k-${suffix}` } });
    expect(await prisma.account.count({ where: { userId: a.id } })).toBe(2);
  });
});
