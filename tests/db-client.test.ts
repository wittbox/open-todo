import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * PrismaClient 는 하나만 살아야 한다.
 *
 * lib/db.ts 의 `prisma` 는 Proxy 라서 속성에 닿을 때마다 클라이언트를 꺼낸다.
 * 그 자리에서 매번 새로 만들면 쿼리 한 줄마다 커넥션 풀이 하나씩 생기고,
 * 곧 "sorry, too many clients already" 로 앱이 통째로 죽는다.
 * 운영에서 실제로 그렇게 됐고, 그때 캐시를 건너뛰던 분기가 원인이었다.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as { prisma?: unknown }).prisma;
});

async function loadDb(nodeEnv: string) {
  vi.resetModules();
  delete (globalThis as { prisma?: unknown }).prisma;
  // VITEST 분기를 타면 이 검사를 못 하므로 잠시 벗겨 둔다.
  vi.stubEnv("VITEST", "");
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL || "postgres://u:p@127.0.0.1:5432/none");
  return import("@/lib/db");
}

describe("클라이언트 재사용", () => {
  it.each(["production", "development"])("%s 에서 한 번만 만든다", async (env) => {
    const { prisma } = await loadDb(env);

    // 속성에 두 번 닿아 본다 — 쿼리 한 줄이 여러 번 닿는 것과 같은 모양이다.
    void prisma.user;
    const first = (globalThis as { prisma?: unknown }).prisma;
    void prisma.list;
    void prisma.task;
    const second = (globalThis as { prisma?: unknown }).prisma;

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("DATABASE_URL 이 없으면 만들지 않고 알려 준다", async () => {
    vi.resetModules();
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    delete (globalThis as { prisma?: unknown }).prisma;

    const { prisma } = await import("@/lib/db");
    expect(() => void prisma.user).toThrow(/DATABASE_URL/);
  });
});

/**
 * 끊긴 커넥션으로 실패한 읽기만 다시 시도한다.
 *
 * 풀에 있던 커넥션은 DB 서버 재시작·유휴 정리·절전으로 조용히 죽는다. 그 커넥션을 집어 든 쿼리 하나 때문에
 * 화면 전체가 오류가 되면 안 된다. 쓰기는 다시 보내지 않는다 — 서버에 이미 반영됐을 수 있다.
 */
describe("끊긴 커넥션 재시도", () => {
  const lost = new Error("Connection terminated unexpectedly");

  it("읽기 + 커넥션이 끊긴 오류면 다시 시도한다", async () => {
    const { shouldRetryRead } = await import("@/lib/db");
    for (const op of ["findMany", "findUnique", "count", "groupBy", "aggregate"]) {
      expect(shouldRetryRead(op, lost), op).toBe(true);
    }
    expect(shouldRetryRead("findFirst", new Error("Server has closed the connection."))).toBe(true);
  });

  it("쓰기는 다시 보내지 않는다", async () => {
    const { shouldRetryRead } = await import("@/lib/db");
    for (const op of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "executeRaw"]) {
      expect(shouldRetryRead(op, lost), op).toBe(false);
    }
  });

  it("다른 오류는 그대로 올린다 — 유일 제약 위반 같은 것", async () => {
    const { shouldRetryRead } = await import("@/lib/db");
    expect(shouldRetryRead("findMany", new Error("Unique constraint failed on the fields: (`email`)"))).toBe(false);
    expect(shouldRetryRead("findMany", new Error("relation does not exist"))).toBe(false);
  });
});
