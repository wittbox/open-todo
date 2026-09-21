import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCalendarView } from "@/lib/queries/tasks";
import { todayDateOnly, addDays } from "@/lib/date";

/**
 * "나의 하루"는 사람마다 다르다.
 * 공유 목록의 같은 작업을 두 사람이 각자 자기 하루에 올려도 서로에게 새면 안 된다.
 *
 * '오늘 할 일' 화면은 2026-09-16 에 달력으로 합쳐 없앴지만, 올려 둔 기록은 남아 주간보고서가
 * '진행 중' 을 가르는 데 쓴다(lib/report/aggregate.ts). 그래서 표식(inMyDay)이 사람마다 맞는지는 계속 본다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const suffix = `myday-${process.pid}`;
const ids: Record<string, string> = {};

d("나의 하루 (DB)", () => {
  const today = todayDateOnly();
  const view = (userId: string) => getCalendarView(userId, addDays(today, -1), addDays(today, 2), today);
  const flags = async (userId: string) =>
    Object.fromEntries((await view(userId)).tasks.map((t) => [t.title, t.inMyDay]));

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { email: `o-${suffix}@x.test`, name: "소유자" },
    });
    const mate = await prisma.user.create({
      data: { email: `m-${suffix}@x.test`, name: "동료" },
    });
    const list = await prisma.list.create({
      data: { ownerId: owner.id, name: `L-${suffix}`, order: "a0" },
    });
    const task = (title: string, order: string) =>
      prisma.task.create({ data: { listId: list.id, creatorId: owner.id, title, order, dueDate: today } });
    const shared = await task("둘 다 보는 작업", "a0");
    const ownerOnly = await task("소유자만 올린 작업", "a1");
    const stale = await task("어제 올린 작업", "a2");

    await prisma.share.create({
      data: { subjectType: "LIST", subjectId: list.id, granteeUserId: mate.id, role: "EDITOR" },
    });

    await prisma.myDayEntry.createMany({
      data: [
        { userId: owner.id, taskId: shared.id, date: today },
        { userId: owner.id, taskId: ownerOnly.id, date: today },
        { userId: mate.id, taskId: shared.id, date: today },
        // 어제 올린 것은 오늘의 하루가 아니다
        { userId: owner.id, taskId: stale.id, date: addDays(today, -1) },
      ],
    });

    Object.assign(ids, { owner: owner.id, mate: mate.id, list: list.id });
  });

  afterAll(async () => {
    if (!hasDb || !ids.owner) return;
    await prisma.share.deleteMany({ where: { subjectId: ids.list } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.owner, ids.mate] } } });
  });

  it("각자 자기가 올린 것만 표시된다", async () => {
    expect(await flags(ids.owner)).toMatchObject({ "둘 다 보는 작업": true, "소유자만 올린 작업": true });
    expect(await flags(ids.mate)).toMatchObject({ "둘 다 보는 작업": true, "소유자만 올린 작업": false });
  });

  it("어제 올린 작업은 오늘의 하루가 아니다", async () => {
    expect((await flags(ids.owner))["어제 올린 작업"]).toBe(false);
  });
});
