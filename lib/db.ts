import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

// Prisma 7은 접속 URL을 스키마가 아니라 드라이버 어댑터로 받는다.
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Check your .env file.");
  }
  return withReadRetry(
    new PrismaClient({
      // 풀 크기를 못박는다. Postgres 기본 max_connections 는 100 이고 앱은 한 대뿐이라
      // 이 정도면 넉넉하면서도, 무언가 새더라도 DB 전체를 마비시키지는 않는다.
      adapter: new PrismaPg({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10) }),
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    }),
  );
}

// 클라이언트는 딱 하나만 산다. 개발 중 HMR 로 늘어나지 않게 전역에 둔다.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let testClient: PrismaClient | undefined;

function client(): PrismaClient {
  // 테스트에서는 전역 캐시를 쓰지 않는다. 파일마다 새로 만들고 끝나면 닫아야
  // 로컬 DB의 커넥션이 쌓이지 않는다 (tests/setup.ts).
  if (process.env.VITEST) {
    testClient ??= createClient();
    return testClient;
  }
  // 운영에서도 반드시 캐시한다.
  //
  // 예전에는 여기서 production 일 때 캐시하지 않고 새 클라이언트를 돌려줬다.
  // 아래 Proxy 가 속성에 닿을 때마다 이 함수를 부르므로, 쿼리 한 줄마다 커넥션
  // 풀이 하나씩 새로 생겼다. 사람이 몇만 붙어도 곧 "sorry, too many clients
  // already" 가 나고 화면이 통째로 죽는다 — 실제로 그렇게 됐다.
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

/**
 * 끊긴 커넥션 때문에 실패한 **읽기**는 한 번 다시 시도한다.
 *
 * 풀에 있던 커넥션은 서버 재시작·유휴 정리·노트북 절전으로 조용히 죽는다. 그 커넥션을 집어 든 쿼리는
 * "Connection terminated unexpectedly" 로 실패하는데, 한 화면이 쿼리를 여러 개 한꺼번에 보내면
 * 그중 하나만 죽어도 화면 전체가 오류가 된다.
 *
 * 쓰기는 다시 보내지 않는다 — 응답을 못 받았을 뿐 서버에는 이미 반영됐을 수 있어 두 번 적용될 위험이 있다.
 */
const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const LOST_CONNECTION = /connection terminated|server has closed the connection|connection closed|econnreset|socket hang up/i;

export function shouldRetryRead(operation: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return READ_OPERATIONS.has(operation) && LOST_CONNECTION.test(message);
}

function withReadRetry(base: PrismaClient): PrismaClient {
  return base.$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        try {
          return await query(args);
        } catch (e) {
          if (!shouldRetryRead(operation, e)) throw e;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return query(args);
        }
      },
    },
  }) as unknown as PrismaClient;
}

/**
 * 실제로 쿼리를 부르는 시점에 커넥션을 만든다.
 * 이렇게 두면 DB가 필요 없는 모듈(권한 계산 등)을 임포트하는 테스트가
 * DATABASE_URL 없이도 돌아간다.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const c = client();
    const value = Reflect.get(c, prop, receiver);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
