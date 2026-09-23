import { describe, expect, it } from "vitest";
import { clusterState, ensureTrustLines, parseArgs, resolveSecret, versionProblem } from "../docker/entrypoint.mts";

/**
 * 컨테이너 감독자의 판단 부분. 도커 없이 여기서 본다 — 실제 기동은 CI 의 연기 시험이 본다.
 */

describe("클러스터 판정", () => {
  it("PG_VERSION 이 있으면 기존 클러스터", () => {
    expect(clusterState("16\n")).toEqual({ kind: "existing", major: "16" });
    expect(clusterState("17")).toEqual({ kind: "existing", major: "17" });
  });

  it("파일이 없거나 비어 있으면 새로 만든다", () => {
    expect(clusterState(null)).toEqual({ kind: "new" });
    expect(clusterState("  \n")).toEqual({ kind: "new" });
  });

  it("메이저가 다르면 뜨지 않는다 — 문구가 무엇을 하라고 말해 준다", () => {
    expect(versionProblem({ kind: "existing", major: "16" }, "16")).toBeNull();
    expect(versionProblem({ kind: "new" }, "16")).toBeNull();
    const problem = versionProblem({ kind: "existing", major: "15" }, "16");
    expect(problem).toContain("PostgreSQL 15");
    expect(problem).toContain("PostgreSQL 16");
    expect(problem).toMatch(/dump/i);
  });
});

describe("pg_hba", () => {
  const original = "# TYPE  DATABASE        USER            ADDRESS                 METHOD\nhost    all             all             127.0.0.1/32            scram-sha-256\n";

  it("우리 줄을 맨 앞에 넣는다 — 기존 줄은 그대로 남는다", () => {
    const next = ensureTrustLines(original);
    expect(next.startsWith("# added by open-todo entrypoint")).toBe(true);
    expect(next).toContain("local   all   all                     trust");
    expect(next).toContain("host    all   all   127.0.0.1/32      trust");
    expect(next).toContain("scram-sha-256");
  });

  it("여러 번 불러도 한 번만 들어간다", () => {
    const once = ensureTrustLines(original);
    expect(ensureTrustLines(once)).toBe(once);
    expect(once.match(/added by open-todo/g)).toHaveLength(1);
  });
});

describe("비밀값", () => {
  it("환경 변수 → 볼륨의 파일 → 새로 만들기 순서", () => {
    expect(resolveSecret("from-env", "from-file", () => "made")).toEqual({ value: "from-env", source: "env" });
    expect(resolveSecret(undefined, "from-file", () => "made")).toEqual({ value: "from-file", source: "file" });
    expect(resolveSecret(undefined, null, () => "made")).toEqual({ value: "made", source: "generated" });
  });

  it("공백뿐인 값은 없는 것으로 본다", () => {
    expect(resolveSecret("   ", "  \n", () => "made")).toEqual({ value: "made", source: "generated" });
  });
});

describe("실행 인자", () => {
  it("--db-only 는 앱 없이 DB 만", () => {
    expect(parseArgs([])).toEqual({ dbOnly: false });
    expect(parseArgs(["--db-only"])).toEqual({ dbOnly: true });
  });
});
