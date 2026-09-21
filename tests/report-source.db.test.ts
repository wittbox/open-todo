import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 보고서 후보 가져오기.
 *
 * 편집 화면은 후보를 전부 받아 두고 범위 필터를 화면에서 건다. 그 "전부"를
 * 어떻게 요청하느냐가 한 번 어긋나서, 그룹 하나만 체크를 풀어도 본문이 통째로
 * 비었다 — 체크 상태는 멀쩡했고 줄을 그릴 재료가 사라진 것이었다.
 */
const { getReportSource, ALL_GROUPS_SCOPE, EMPTY_SCOPE, parseScope } = await import("@/lib/queries/report");
const { prisma } = await import("@/lib/db");
const { dateOnly } = await import("@/lib/date");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const WEEK = dateOnly(2026, 8, 10);
let f: Fixture;

beforeAll(async () => {
  if (!hasDb) return;
  f = await createFixture("rsrc");
  // 이번 주에 걸리는 작업 하나 — 그룹에 속한 목록에 둔다.
  await prisma.task.update({
    where: { id: f.task.id },
    data: { dueDate: dateOnly(2026, 8, 12) },
  });
});
afterAll(async () => {
  if (hasDb && f) await destroyFixture(f);
});

const scopeOf = (over: Partial<typeof EMPTY_SCOPE>) => ({ ...EMPTY_SCOPE, ...over });

d("후보 가져오기", () => {
  it("전체면 다 가져온다", async () => {
    const { tasks } = await getReportSource(f.owner.id, WEEK, scopeOf({ allGroups: true }));
    expect(tasks.map((t) => t.id)).toContain(f.task.id);
  });

  it("고른 그룹만 가져온다", async () => {
    const { tasks } = await getReportSource(
      f.owner.id,
      WEEK,
      scopeOf({ allGroups: false, groupIds: [f.group.id] }),
    );
    expect(tasks.map((t) => t.id)).toContain(f.task.id);
  });

  it("아무것도 안 고르면 아무것도 안 준다", async () => {
    const { tasks } = await getReportSource(
      f.owner.id,
      WEEK,
      scopeOf({ allGroups: false, groupIds: [] }),
    );
    expect(tasks).toHaveLength(0);
  });

  it("ALL_GROUPS_SCOPE 를 덮어쓰면 저장된 범위와 무관하게 전부 온다", async () => {
    // 편집 화면이 하는 그대로: 저장된 범위 위에 "전부"를 덮어쓴다.
    const saved = parseScope({ allGroups: false, groupIds: [f.group.id] });
    const { tasks } = await getReportSource(f.owner.id, WEEK, { ...saved, ...ALL_GROUPS_SCOPE });

    expect(tasks.map((t) => t.id)).toContain(f.task.id);
  });

  it("범위를 좁혀 둔 보고서에서도 후보는 비지 않는다", async () => {
    // 그룹 하나만 체크를 푼 상태 — 남은 그룹이 없어도 후보는 전부여야 한다.
    const saved = parseScope({ allGroups: false, groupIds: [] });
    const { tasks, groups } = await getReportSource(f.owner.id, WEEK, { ...saved, ...ALL_GROUPS_SCOPE });

    expect(tasks.length).toBeGreaterThan(0);
    expect(groups.map((g) => g.id)).toContain(f.group.id);
  });
});
