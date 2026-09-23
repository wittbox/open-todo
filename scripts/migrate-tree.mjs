// 도커 이미지에 넣을 "마이그레이션만 하는" 최소 트리를 모은다.
//
//   node scripts/migrate-tree.mjs /opt/migrate
//
// 앱 이미지는 컨테이너 안에서 `prisma migrate deploy` 를 돌려야 하는데, Prisma CLI 전체 의존성에는
// Studio(그래프·리액트)와 prisma dev(pglite)가 딸려 와 수백 MB 가 된다. 그 가지들을 끊고 걸어서
// 실제로 필요한 것만 복사한다. 빠뜨린 것이 있으면 CI 의 컨테이너 연기 시험이 잡는다.
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** migrate deploy 로는 닿지 않는 가지. 여기서 끊으면 그 아래 의존성도 따라오지 않는다. */
const SKIP = new Set([
  "@prisma/studio-core",
  "@prisma/dev",
  "@prisma/query-plan-executor",
  "@prisma/streams-local",
  "mysql2",
  "postgres",
  "@electric-sql/pglite",
  "@electric-sql/pglite-socket",
  "@electric-sql/pglite-tools",
]);

const ROOTS = ["prisma", "@prisma/config", "dotenv"];

function closure(modulesDir) {
  const found = new Set();
  const walk = (name) => {
    if (found.has(name) || SKIP.has(name)) return;
    const manifest = join(modulesDir, name, "package.json");
    if (!existsSync(manifest)) return;
    found.add(name);
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep);
  };
  ROOTS.forEach(walk);
  return [...found].sort();
}

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/migrate-tree.mjs <target-dir>");
  process.exit(1);
}

const modulesDir = join(process.cwd(), "node_modules");
const packages = closure(modulesDir);

for (const name of packages) {
  const to = join(target, "node_modules", name);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(modulesDir, name), to, { recursive: true });
}

// 스키마와 마이그레이션, 그리고 접속 주소를 주는 설정 파일. 스키마에 url 이 없어 설정 파일이 반드시 있어야 한다.
for (const path of ["prisma/schema.prisma", "prisma/migrations", "prisma.config.ts"]) {
  cpSync(join(process.cwd(), path), join(target, path), { recursive: true });
}

console.log(`migrate tree: ${packages.length} packages → ${target}`);
