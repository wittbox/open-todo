import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { dateOnly, todayDateOnly, addDays } from "@/lib/date";

/**
 * 그룹 숨기기 — 끝난 프로젝트를 치워 두기. 지우지 않는다.
 * 숨기면 그 작업은 나에게 할당됨·달력·주간보고서·기한 알림·반복에서 빠지고, 검색과 목록을 직접 여는 것은 그대로.
 * 주인(관리할 수 있는 사람)이 숨기면 공유받은 사람에게도 숨겨진다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let currentUser: string | null = null;
vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return {
    ...actual,
    getSessionUserId: async () => currentUser,
    requireUserId: async () => {
      if (!currentUser) throw new actual.UnauthenticatedError();
      return currentUser;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { setGroupHidden } = await import("@/lib/actions/group");
const { updateTask } = await import("@/lib/actions/task");
const { getAccessibleLists, getAssignedView, getCalendarView, searchTasks } = await import("@/lib/queries/tasks");
const { getReportSource, EMPTY_SCOPE } = await import("@/lib/queries/report");
const { getSidebarData } = await import("@/lib/queries/sidebar");
const { getListView } = await import("@/lib/queries/list");
const { runTick } = await import("@/lib/notify-tick");

const p = `hide-${process.pid}-${Date.now()}`;
const ids: Record<string, string> = {};
const today = todayDateOnly();

d("그룹 숨기기 (DB)", () => {
  beforeAll(async () => {
    const mk = (k: string, name: string) => prisma.user.create({ data: { email: `${k}-${p}@x.test`, name } });
    const owner = await mk("o", "주인");
    const mate = await mk("m", "공유받은이");
    const viewer = await mk("v", "읽기만");

    const done = await prisma.group.create({ data: { ownerId: owner.id, name: `2025 심사 ${p}`, order: "a0" } });
    const live = await prisma.group.create({ data: { ownerId: owner.id, name: `진행 중 ${p}`, order: "a1" } });
    const oldList = await prisma.list.create({ data: { ownerId: owner.id, groupId: done.id, name: `준비 서류 ${p}`, order: "a0" } });
    const liveList = await prisma.list.create({ data: { ownerId: owner.id, groupId: live.id, name: `할 일 ${p}`, order: "a0" } });
    await prisma.share.create({ data: { subjectType: "GROUP", subjectId: done.id, granteeUserId: mate.id, role: "EDITOR" } });
    await prisma.share.create({ data: { subjectType: "GROUP", subjectId: done.id, granteeUserId: viewer.id, role: "VIEWER" } });
    await prisma.share.create({ data: { subjectType: "GROUP", subjectId: live.id, granteeUserId: mate.id, role: "EDITOR" } });

    const t = (listId: string, title: string, extra: object = {}) =>
      prisma.task.create({ data: { listId, creatorId: owner.id, assigneeId: mate.id, title, order: "a0", ...extra } });
    const oldDue = await t(oldList.id, `숨김작업 ${p}`, { dueDate: today });
    const oldRepeat = await t(oldList.id, `숨김반복 ${p}`, { dueDate: today, repeatUnit: "WEEK", repeatEvery: 1 });
    const oldRemind = await t(oldList.id, `숨김알림 ${p}`, { remindAt: new Date(`${today.toISOString().slice(0, 10)}T02:00:00.000Z`) /* 서울 11시 — 아래 runTick(정오) 전 */ });
    const liveDue = await t(liveList.id, `보이는작업 ${p}`, { dueDate: today });

    Object.assign(ids, {
      owner: owner.id, mate: mate.id, viewer: viewer.id, done: done.id, live: live.id, oldList: oldList.id, liveList: liveList.id,
      oldDue: oldDue.id, oldRepeat: oldRepeat.id, oldRemind: oldRemind.id, liveDue: liveDue.id,
    });
  });

  afterAll(async () => {
    if (!hasDb || !ids.owner) return;
    await prisma.share.deleteMany({ where: { subjectId: { in: [ids.done, ids.live] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [ids.owner, ids.mate, ids.viewer] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.owner, ids.mate, ids.viewer] } } });
  });

  it("관리할 수 있는 사람만 숨긴다 — 읽기만 공유받은 사람은 못 한다", async () => {
    currentUser = ids.viewer;
    expect((await setGroupHidden(ids.done, true)).ok).toBe(false);
    currentUser = ids.owner;
    expect((await setGroupHidden(ids.done, true)).ok).toBe(true);
    expect((await prisma.group.findUniqueOrThrow({ where: { id: ids.done } })).hiddenAt).not.toBeNull();
  });

  it("나에게 할당됨·달력·주간보고서에서 빠지고 보이는 그룹은 그대로", async () => {
    const accessible = await getAccessibleLists(ids.mate);
    expect(accessible.map((l) => l.id)).not.toContain(ids.oldList);
    const all = await getAccessibleLists(ids.mate, { includeHidden: true });
    expect(all.find((l) => l.id === ids.oldList)?.hidden).toBe(true);

    const assigned = await getAssignedView(ids.mate);
    const assignedIds = assigned.open.map((t) => t.id);
    expect(assignedIds).toContain(ids.liveDue);
    expect(assignedIds).not.toContain(ids.oldDue);

    const cal = await getCalendarView(ids.owner, addDays(today, -3), addDays(today, 3), today);
    const calIds = cal.tasks.map((t) => t.id);
    expect(calIds).toContain(ids.liveDue);
    expect(calIds).not.toContain(ids.oldDue);
    expect(cal.lists.map((l) => l.id)).not.toContain(ids.oldList);

    const week = dateOnly(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate());
    const src = await getReportSource(ids.owner, addDays(week, -((week.getUTCDay() + 6) % 7)), { ...EMPTY_SCOPE, allGroups: true });
    expect(src.tasks.map((t) => t.id)).not.toContain(ids.oldDue);
    expect(src.groups.map((g) => g.id)).not.toContain(ids.done);
  });

  it("검색에는 나온다 — 숨긴 그룹 표시와 함께", async () => {
    const r = await searchTasks(ids.mate, `숨김작업 ${p}`);
    expect(r.hits.find((h) => h.id === ids.oldDue)).toMatchObject({ hidden: true });
    const live = await searchTasks(ids.mate, `보이는작업 ${p}`);
    expect(live.hits.find((h) => h.id === ids.liveDue)).toMatchObject({ hidden: false });
  });

  it("사이드바: 주인은 ‘숨긴 그룹’ 으로, 공유받은 사람도 숨긴 쪽으로 — 할당 숫자에서도 빠진다", async () => {
    const own = (await getSidebarData(ids.owner))!;
    expect(own.groups.map((g) => g.id)).toEqual(expect.not.arrayContaining([ids.done]));
    expect(own.hiddenGroups.map((g) => g.id)).toContain(ids.done);
    expect(own.hiddenGroups.find((g) => g.id === ids.done)!.lists.map((l) => l.id)).toContain(ids.oldList);

    const mate = (await getSidebarData(ids.mate))!;
    expect(mate.shared.map((l) => l.id)).not.toContain(ids.oldList);
    expect(mate.hiddenShared.groups.flatMap((g) => g.lists.map((l) => l.id))).toContain(ids.oldList);
    // 맡은 작업 4개 중 숨긴 그룹의 3개는 숫자에서 빠진다.
    expect(mate.assignedCount).toBe(1);
  });

  it("목록을 직접 열면 띠 — 관리할 수 있는 사람에게만 ‘보이기’", async () => {
    expect((await getListView(ids.owner, ids.oldList))!.hiddenGroup).toMatchObject({ id: ids.done, canUnhide: true });
    expect((await getListView(ids.viewer, ids.oldList))!.hiddenGroup).toMatchObject({ id: ids.done, canUnhide: false });
    expect((await getListView(ids.owner, ids.liveList))!.hiddenGroup).toBeNull();
  });

  it("기한 알림·미리 알림이 울리지 않는다 — 미리 알림은 울린 것으로 표시해 둔다", async () => {
    const noon = new Date(`${today.toISOString().slice(0, 10)}T03:00:00.000Z`); // 서울 정오
    await runTick(noon);
    const notes = await prisma.notification.findMany({ where: { taskId: { in: [ids.oldDue, ids.oldRemind, ids.oldRepeat, ids.liveDue] } }, select: { taskId: true, kind: true } });
    expect(notes.map((n) => n.taskId)).not.toContain(ids.oldDue);
    expect(notes.map((n) => n.taskId)).not.toContain(ids.oldRemind);
    expect(notes.some((n) => n.taskId === ids.liveDue && n.kind === "DUE_TODAY")).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ids.oldRemind } })).remindedAt).not.toBeNull();
  });

  it("숨긴 그룹에서는 반복 작업의 다음 회차를 만들지 않는다", async () => {
    currentUser = ids.owner;
    expect((await updateTask(ids.oldRepeat, { isCompleted: true })).ok).toBe(true);
    expect(await prisma.task.count({ where: { repeatFromId: ids.oldRepeat } })).toBe(0);
  });

  it("다시 보이면 원래 자리로, 화면들에 돌아온다", async () => {
    currentUser = ids.owner;
    const before = (await prisma.group.findUniqueOrThrow({ where: { id: ids.done } })).order;
    expect((await setGroupHidden(ids.done, false)).ok).toBe(true);
    const own = (await getSidebarData(ids.owner))!;
    expect(own.groups.find((g) => g.id === ids.done)?.order).toBe(before);
    expect(own.hiddenGroups).toEqual([]);
    expect((await getAssignedView(ids.mate)).open.map((t) => t.id)).toContain(ids.oldDue);
  });
});
