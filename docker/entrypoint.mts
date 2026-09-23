/**
 * 컨테이너 하나 안에서 PostgreSQL 과 앱을 함께 돌리는 감독 프로세스.
 *
 *   tini(PID 1) → 이 파일(root) → postgres(uid 70) · 앱(uid 1001)
 *
 * 하는 일 순서: 볼륨 준비 → (처음이면) initdb → pg_hba 손보기 → postgres 시작 → 데이터베이스 확인
 * → 마이그레이션 → 비밀값 준비 → 앱 시작. 끝낼 때는 앱을 먼저 보내고 postgres 에 SIGINT(fast shutdown)를 준다.
 *
 * 순수 함수(아래 export)는 컨테이너 없이 시험한다 — tests/entrypoint.test.ts.
 * 이 기계에는 도커가 없어서, 실제 기동은 GitHub Actions 의 연기 시험이 본다.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const DATA_DIR = process.env.TODO_DATA_DIR ?? "/data";
export const PGDATA = join(DATA_DIR, "postgres");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");
export const SECRETS_DIR = join(DATA_DIR, "secrets");
export const SOCKET_DIR = "/var/run/postgresql";

/** 이미지가 담고 있는 PostgreSQL 메이저. Dockerfile 의 베이스와 같아야 한다. */
export const PG_MAJOR = process.env.TODO_PG_MAJOR ?? "16";
const DB_NAME = "todo";
const DB_USER = "todo";
export const DATABASE_URL = `postgres://${DB_USER}@127.0.0.1:5432/${DB_NAME}`;

/* ── 순수 함수 ─────────────────────────────────────────── */

export type ClusterState = { kind: "new" } | { kind: "existing"; major: string };

/** 데이터 폴더가 이미 클러스터인가. 빈 폴더 판정에 `readdir` 을 쓰면 lost+found 같은 것에 속는다. */
export function clusterState(pgVersionFile: string | null): ClusterState {
  const major = pgVersionFile?.trim().split(".")[0] ?? "";
  return major ? { kind: "existing", major } : { kind: "new" };
}

/** 볼륨의 메이저가 이미지와 다르면 뜨지 않는다 — 다른 메이저로 열면 데이터가 상한다. */
export function versionProblem(state: ClusterState, imageMajor: string): string | null {
  if (state.kind === "new" || state.major === imageMajor) return null;
  return (
    `This volume holds a PostgreSQL ${state.major} cluster, but this image ships PostgreSQL ${imageMajor}. ` +
    `Postgres cannot open an older cluster in place. Start the previous image, dump the database, then restore it here — ` +
    `see the "Upgrading PostgreSQL" section of the README.`
  );
}

/**
 * 컨테이너 안에서만 닿는 DB 라 인증은 trust 로 둔다. 예전 compose 로 만든 클러스터는
 * host 줄이 scram 이라 그대로면 접속이 막힌다. 우리 줄을 맨 앞에 한 번만 넣는다(여러 번 불러도 같다).
 */
export function ensureTrustLines(hba: string): string {
  const marker = "# added by open-todo entrypoint";
  if (hba.includes(marker)) return hba;
  const lines = [marker, "local   all   all                     trust", "host    all   all   127.0.0.1/32      trust", ""];
  return lines.join("\n") + "\n" + hba;
}

export type SecretSource = "env" | "file" | "generated";

/** 환경 변수 → 볼륨에 저장해 둔 값 → 새로 만들기. 만든 값은 부르는 쪽이 저장한다. */
export function resolveSecret(fromEnv: string | undefined, fromFile: string | null, make: () => string): { value: string; source: SecretSource } {
  const env = fromEnv?.trim();
  if (env) return { value: env, source: "env" };
  const file = fromFile?.trim();
  if (file) return { value: file, source: "file" };
  return { value: make(), source: "generated" };
}

export function parseArgs(argv: string[]): { dbOnly: boolean } {
  return { dbOnly: argv.includes("--db-only") };
}

/* ── 바깥과 이야기하는 부분 ───────────────────────────── */

const log = (msg: string) => console.log(`[init] ${msg}`);

function run(command: string, args: string[], opts: { env?: Record<string, string>; cwd?: string } = {}): void {
  const res = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, ...opts.env }, cwd: opts.cwd });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${res.status}`);
}

const asPostgres = (args: string[], opts: { env?: Record<string, string> } = {}) => run("su-exec", ["postgres", ...args], opts);

function psql(sql: string, database = "postgres"): string {
  const res = spawnSync("su-exec", ["postgres", "psql", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", DB_USER, "-d", database, "-tAc", sql], {
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`psql failed: ${res.stderr?.trim() || res.status}`);
  return res.stdout.trim();
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function prepareVolume(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });
  mkdirSync(SECRETS_DIR, { recursive: true });
  mkdirSync(SOCKET_DIR, { recursive: true });
  // 첨부는 앱(uid 1001)이 쓰고, 클러스터는 postgres(uid 70)가 쓴다. 폴더째 훑는 chown 은 처음 한 번만.
  const marker = join(DATA_DIR, ".initialized");
  const recursive = existsSync(marker) ? [] : ["-R"];
  run("chown", [...recursive, "nextjs:nodejs", UPLOAD_DIR]);
  run("chown", ["postgres:postgres", SOCKET_DIR]);
  chmodSync(SECRETS_DIR, 0o700);
  if (!existsSync(marker)) writeFileSync(marker, new Date().toISOString());
}

function secret(name: string, envValue: string | undefined, bytes = 32): string {
  const file = join(SECRETS_DIR, name);
  const { value, source } = resolveSecret(envValue, readIfExists(file), () => randomBytes(bytes).toString("hex"));
  if (source === "generated") {
    writeFileSync(file, value, { mode: 0o600 });
    log(`${name}: generated and stored in ${file}`);
  } else {
    log(`${name}: from ${source === "env" ? "the environment" : file}`);
  }
  return value;
}

function initCluster(): void {
  mkdirSync(PGDATA, { recursive: true, mode: 0o700 });
  run("chown", ["postgres:postgres", PGDATA]);
  chmodSync(PGDATA, 0o700);

  const state = clusterState(readIfExists(join(PGDATA, "PG_VERSION")));
  const problem = versionProblem(state, PG_MAJOR);
  if (problem) {
    console.error(`[init] ${problem}`);
    process.exit(1);
  }

  if (state.kind === "new") {
    log(`creating a new PostgreSQL ${PG_MAJOR} cluster in ${PGDATA}`);
    asPostgres(["initdb", "--username", DB_USER, "--encoding", "UTF8", "--auth-local", "trust", "--pgdata", PGDATA]);
  } else {
    log(`using the PostgreSQL ${state.major} cluster already in ${PGDATA}`);
  }

  const hbaPath = join(PGDATA, "pg_hba.conf");
  const hba = readFileSync(hbaPath, "utf8");
  const next = ensureTrustLines(hba);
  if (next !== hba) {
    writeFileSync(hbaPath, next);
    run("chown", ["postgres:postgres", hbaPath]);
    chmodSync(hbaPath, 0o600);
    log("pg_hba.conf: allowing local connections inside the container");
  }
}

function startPostgres(): ChildProcess {
  // 설정은 argv 로 준다 — 볼륨 안의 postgresql.auto.conf 에 박아 두면 오래된 볼륨에서 낡은 값이 살아남는다.
  const args = [
    "postgres",
    "postgres",
    "-D",
    PGDATA,
    "-c",
    "listen_addresses=127.0.0.1",
    "-c",
    `unix_socket_directories=${SOCKET_DIR}`,
    // 도커의 기본 /dev/shm 은 64MB 다. 병렬 워커를 끄면 "could not resize shared memory segment" 를 만나지 않는다.
    "-c",
    "max_parallel_workers_per_gather=0",
  ];
  const child = spawn("su-exec", args, { stdio: "inherit" });
  return child;
}

async function waitForPostgres(timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const res = spawnSync("su-exec", ["postgres", "pg_isready", "-h", "127.0.0.1", "-U", DB_USER, "-q"], { stdio: "ignore" });
    if (res.status === 0) return;
    if (Date.now() > until) throw new Error("PostgreSQL did not become ready in time");
    await new Promise((r) => setTimeout(r, 500));
  }
}

function ensureDatabase(): void {
  const exists = psql(`SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`);
  if (exists === "1") return;
  log(`creating the ${DB_NAME} database`);
  psql(`CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}`);
}

function migrate(): void {
  log("applying migrations");
  run("node", ["/opt/migrate/node_modules/prisma/build/index.js", "migrate", "deploy"], {
    cwd: "/opt/migrate",
    env: { DATABASE_URL, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}

function startApp(env: Record<string, string>): ChildProcess {
  return spawn("su-exec", ["nextjs", "node", "/app/server.js"], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

async function main(): Promise<void> {
  const { dbOnly } = parseArgs(process.argv.slice(2));

  prepareVolume();
  initCluster();

  const postgres = startPostgres();
  let shuttingDown = false;
  let app: ChildProcess | null = null;

  const stop = async (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (app?.pid && app.exitCode === null) {
      app.kill("SIGTERM");
      await waitForExit(app, 20_000);
    }
    if (postgres.pid && postgres.exitCode === null) {
      // SIGTERM 은 smart shutdown 이라 앱의 유휴 커넥션을 기다리다 끝나지 않는다. fast shutdown 으로 보낸다.
      postgres.kill("SIGINT");
      await waitForExit(postgres, 40_000);
    }
    process.exit(code);
  };

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log(`${signal} received, shutting down`);
      void stop(0);
    });
  }

  postgres.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[init] PostgreSQL exited unexpectedly (${code})`);
    void stop(1);
  });

  await waitForPostgres();
  ensureDatabase();
  migrate();

  if (dbOnly) {
    log("--db-only: PostgreSQL is up, the app is not started. Use `psql` or `pg_restore`, then restart without the flag.");
    return;
  }

  const env: Record<string, string> = {
    DATABASE_URL,
    UPLOAD_DIR,
    // 기본은 앱 안에서 돈다. 밖의 스케줄러를 쓰겠다는 설치는 RUN_JOBS=0 으로 끌 수 있다.
    RUN_JOBS: process.env.RUN_JOBS ?? "1",
    SESSION_SECRET: secret("session_secret", process.env.SESSION_SECRET),
  };
  app = startApp(env);
  app.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[init] the app exited unexpectedly (${code})`);
    void stop(code ?? 1);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// 시험에서 이 파일을 불러올 때는 아무것도 띄우지 않는다.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("[init]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
