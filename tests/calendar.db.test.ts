import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCalendarView } from "@/lib/queries/tasks";
import { getTaskDetail } from "@/lib/queries/list";
import { getTheme } from "@/lib/theme";

/**
 * 달력 조회.
 *
 * 볼 수 있는 목록만, 보이는 칸 안의 기한만 가져와야 한다. 칸보다 앞의 반복 작업은
 * 다음 회차를 계산하려고 따로 받는다 — 그게 칸에 섞여 들어가면 지난 날짜에 작업이 보인다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const suffix = `cal-${process.pid}-${Date.now()}`;
const ids: Record<string, string> = {};
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

// 2026년 9월 달력의 칸
const FROM = D("2026-08-30");
const END = D("2026-10-04");

d("달력 조회 (DB)", () => {
  beforeAll(async () => {
    const me = await prisma.user.create({
      data: { email: `me-${suffix}@x.test`, name: "나" },
    });
    const other = await prisma.user.create({
      data: { email: `ot-${suffix}@x.test`, name: "남" },
    });
    const myGroup = await prisma.group.create({ data: { ownerId: me.id, name: `내그룹-${suffix}`, order: "a0" } });
    const otherGroup = await prisma.group.create({ data: { ownerId: other.id, name: `남의그룹-${suffix}`, order: "a0" } });
    const mine = await prisma.list.create({
      data: { ownerId: me.id, groupId: myGroup.id, name: `내목록-${suffix}`, order: "a0", themeKey: "green" },
    });
    const inbox = await prisma.list.create({
      data: { ownerId: me.id, name: "작업", order: "a1", isInbox: true },
    });
    // 목록만 공유했으니 그룹은 공유되지 않았지만, 사이드바처럼 소유자 쪽 그룹 이름은 보인다.
    const shared = await prisma.list.create({
      data: { ownerId: other.id, groupId: otherGroup.id, name: `공유-${suffix}`, order: "a0" },
    });
    const secret = await prisma.list.create({ data: { ownerId: other.id, name: `비밀-${suffix}`, order: "a1" } });
    await prisma.share.create({
      data: { subjectType: "LIST", subjectId: shared.id, granteeUserId: me.id, role: "VIEWER" },
    });

    const add = (listId: string, creatorId: string, title: string, extra: Record<string, unknown> = {}) =>
      prisma.task.create({ data: { listId, creatorId, title, order: "a0", ...extra } });

    const inside = await add(mine.id, me.id, "칸 안", { dueDate: D("2026-09-15") });
    await add(mine.id, me.id, "칸 안 완료", { dueDate: D("2026-09-10"), isCompleted: true, completedAt: new Date() });
    await add(mine.id, me.id, "칸 첫날", { dueDate: D("2026-08-30") });
    await add(mine.id, me.id, "칸 끝 다음 날", { dueDate: D("2026-10-04") });
    await add(mine.id, me.id, "기한 없음");
    await add(mine.id, me.id, "지난 반복", { dueDate: D("2026-08-14"), repeatUnit: "WEEK", repeatDays: [5] });
    await add(mine.id, me.id, "지난 반복 완료", {
      dueDate: D("2026-08-07"), repeatUnit: "WEEK", repeatDays: [5], isCompleted: true, completedAt: new Date(),
    });
    await add(mine.id, me.id, "지난 보통", { dueDate: D("2026-08-14") });
    const sharedTask = await add(shared.id, other.id, "공유 칸 안", { dueDate: D("2026-09-16") });
    await add(secret.id, other.id, "비밀 칸 안", { dueDate: D("2026-09-16") });

    Object.assign(ids, {
      me: me.id, other: other.id, mine: mine.id, inbox: inbox.id, shared: shared.id,
      inside: inside.id, sharedTask: sharedTask.id,
    });
  });

  afterAll(async () => {
    if (!hasDb || !ids.me) return;
    await prisma.share.deleteMany({ where: { subjectId: ids.shared } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.me, ids.other] } } });
  });

  it("칸 안의 기한만 — 첫날은 넣고 끝 다음 날은 뺀다. 완료한 것도 함께", async () => {
    const v = await getCalendarView(ids.me, FROM, END);
    expect(v.tasks.map((t) => t.title).sort()).toEqual(["공유 칸 안", "칸 안", "칸 안 완료", "칸 첫날"].sort());
  });

  it("남의 목록은 공유받은 것만 — 공유 안 된 목록의 작업과 목록 이름은 나오지 않는다", async () => {
    const v = await getCalendarView(ids.me, FROM, END);
    expect(v.tasks.some((t) => t.title === "비밀 칸 안")).toBe(false);
    expect(v.lists.some((l) => l.name.startsWith("비밀-"))).toBe(false);
  });

  it("칸보다 앞의 미완료 반복만 회차 계산용으로 따로 준다", async () => {
    const v = await getCalendarView(ids.me, FROM, END);
    expect(v.repeatSources.map((t) => t.title)).toEqual(["지난 반복"]);
  });

  // '계획된 일정' 을 없애며 그 '이전' 칸을 달력 위 줄로 옮겼다(2026-09-16).
  it("지난 기한 — 오늘 전·미완료만, 오래된 순. 반복도 보통도, 칸 안 것도", async () => {
    const v = await getCalendarView(ids.me, FROM, END, D("2026-09-16"));
    expect(v.overdue.map((t) => t.title)).toEqual(["지난 반복", "지난 보통", "칸 첫날", "칸 안"]);
    expect(v.overdueMore).toBe(false);
  });

  it("지난 기한은 보는 달과 상관없다 — 다음 달을 봐도 같다. 공유 안 된 목록 것은 없다", async () => {
    const oct = await getCalendarView(ids.me, D("2026-09-27"), D("2026-11-01"), D("2026-09-16"));
    expect(oct.overdue.map((t) => t.title)).toEqual(["지난 반복", "지난 보통", "칸 첫날", "칸 안"]);
    const later = await getCalendarView(ids.me, FROM, END, D("2026-09-17"));
    expect(later.overdue.map((t) => t.title)).toContain("공유 칸 안");
    expect(later.overdue.some((t) => t.title === "비밀 칸 안")).toBe(false);
  });

  it("목록마다 색과 편집 권한 — 내 '작업' 이 맨 앞", async () => {
    const v = await getCalendarView(ids.me, FROM, END);
    expect(v.lists[0]).toMatchObject({ id: ids.inbox, isInbox: true, writable: true });
    expect(v.lists.find((l) => l.id === ids.mine)).toMatchObject({ color: getTheme("green").accent, writable: true });
    expect(v.lists.find((l) => l.id === ids.shared)).toMatchObject({ writable: false, isInbox: false });
  });

  // 목록 경로 — 여러 목록이 섞이는 화면에서 어느 그룹의 어느 목록 작업인지 보이게(2026-09-12 요청)
  it("작업마다 그룹 이름 — 공유받은 목록은 소유자 쪽 그룹(사이드바와 같다)", async () => {
    const v = await getCalendarView(ids.me, FROM, END);
    const by = (title: string) => v.tasks.find((t) => t.title === title)!;
    expect(by("칸 안").groupName).toBe(`내그룹-${suffix}`);
    expect(by("공유 칸 안").groupName).toBe(`남의그룹-${suffix}`);
    expect(v.lists.find((l) => l.id === ids.inbox)!.groupName).toBeNull();
  });

  it("상세 창 — 내 목록이면 주인 이름이 없고, 공유받은 목록이면 주인 이름", async () => {
    expect(await getTaskDetail(ids.me, ids.inside)).toMatchObject({
      groupName: `내그룹-${suffix}`,
      listOwnerName: null,
    });
    expect(await getTaskDetail(ids.me, ids.sharedTask)).toMatchObject({
      groupName: `남의그룹-${suffix}`,
      listOwnerName: "남",
    });
  });
});
