import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  // tsconfig 는 Next 를 위해 jsx: "preserve" 라서 esbuild 가 JSX 를 그대로 흘린다.
  // 컴포넌트 테스트에서만 자동 런타임으로 변환한다.
  esbuild: { jsx: "automatic" },
  test: {
    // 기본은 node. DOM 이 필요한 파일은 맨 위에 `// @vitest-environment jsdom`.
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // DB 통합 테스트가 .env 의 DATABASE_URL 을 읽을 수 있게 한다.
    // 값이 없으면 해당 스위트는 건너뛴다.
    setupFiles: ["./tests/setup.ts"],
    // PrismaClient 는 globalThis 에 캐시되어 워커 안에서 파일 간에 공유된다.
    // 두 파일이 동시에 같은 커넥션을 쓰면 Postgres 확장 프로토콜이 깨진다(08P01).
    fileParallelism: false,
  },
});
