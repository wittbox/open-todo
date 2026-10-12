import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 여러 날 작업(2026-10-13) — 시작일 규칙, 반복의 길이, 달력 조회, ‘오늘 시작’ 알림.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

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

const { createTask, updateTask } = await import("@/lib/actions/task");
const { getCalendarView } = await import("@/lib/queries/tasks");
const { runTick } = await import("@/lib/notify-tick");
const { prisma } = await import("@/lib/db");
const { dateOnly, todayDateOnly } = await import("@/lib/date");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
let f: Fixture;

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const keyOf = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
const read = (id: string) => prisma.task.findUniqueOrThrow({ where: { id }, select: { startDate: true, dueDate: true } });

beforeAll(async () => {
  if (!hasDb) return;
  f = await createFixture("multiday");
});
afterAll(async () => {
  if (f) await destroyFixture(f);
});

d("여러 날 작업 (DB)", () => {
  it("시작일은 기한과 함께, 기한보다 늦을 수 없고, 같으면 하루짜리", async () => {
    currentUser = f.owner.id;
    const t = await createTask(f.list.id, "교육", { startDate: "2026-10-05", dueDate: "2026-10-07" });
    if (!t.ok) throw new Error(t.error);
    expect(await read(t.data.id)).toEqual({ startDate: day("2026-10-05"), dueDate: day("2026-10-07") });

    expect((await updateTask(t.data.id, { startDate: "2026-10-09" })).ok).toBe(false);
    expect((await createTask(f.list.id, "기한 없음", { startDate: "2026-10-05" })).ok).toBe(false);

    expect((await updateTask(t.data.id, { startDate: "2026-10-07" })).ok).toBe(true);
    expect((await read(t.data.id)).startDate).toBeNull();
  });

  it("기한을 지우면 시작일도, 기한만 시작일 앞으로 옮기면 하루짜리로", async () => {
    currentUser = f.owner.id;
    const t = await createTask(f.list.id, "출장", { startDate: "2026-10-08", dueDate: "2026-10-14" });
    if (!t.ok) throw new Error(t.error);
    expect((await updateTask(t.data.id, { dueDate: "2026-10-06" })).ok).toBe(true);
    expect(await read(t.data.id)).toEqual({ startDate: null, dueDate: day("2026-10-06") });

    await updateTask(t.data.id, { startDate: "2026-10-01" });
    expect((await updateTask(t.data.id, { dueDate: null })).ok).toBe(true);
    expect(await read(t.data.id)).toEqual({ startDate: null, dueDate: null });
  });

  it("기간째 옮기기 — 시작일과 기한을 함께 보낸다", async () => {
    currentUser = f.owner.id;
    const t = await createTask(f.list.id, "심사", { startDate: "2026-10-05", dueDate: "2026-10-07" });
    if (!t.ok) throw new Error(t.error);
    expect((await updateTask(t.data.id, { startDate: "2026-10-15", dueDate: "2026-10-17" })).ok).toBe(true);
    expect(await read(t.data.id)).toEqual({ startDate: day("2026-10-15"), dueDate: day("2026-10-17") });
  });

  it("반복하는 여러 날 작업은 다음 회차도 같은 길이", async () => {
    currentUser = f.owner.id;
    const t = await createTask(f.list.id, "주간 교육", { startDate: "2026-10-05", dueDate: "2026-10-07" });
    if (!t.ok) throw new Error(t.error);
    await prisma.task.update({ where: { id: t.data.id }, data: { repeatUnit: "WEEK", repeatEvery: 1, repeatDays: [] } });
    expect((await updateTask(t.data.id, { isCompleted: true })).ok).toBe(true);
    const next = await prisma.task.findFirstOrThrow({ where: { repeatFromId: t.data.id }, select: { startDate: true, dueDate: true } });
    const len = (next.dueDate!.getTime() - next.startDate!.getTime()) / 86_400_000;
    expect(len).toBe(2);
  });

  it("달력: 보는 기간 뒤에서 끝나도 앞쪽이 걸치면 가져온다", async () => {
    currentUser = f.owner.id;
    const t = await createTask(f.list.id, "긴 출장", { startDate: "2026-11-05", dueDate: "2026-11-20" });
    if (!t.ok) throw new Error(t.error);
    const cal = await getCalendarView(f.owner.id, dateOnly(2026, 10, 4), dateOnly(2026, 11, 8), dateOnly(2026, 10, 13));
    const got = cal.tasks.find((x) => x.id === t.data.id);
    expect(got).toMatchObject({ startDate: "2026-11-05", dueDate: "2026-11-20" });
  });

  it("시작하는 날 아침 ‘오늘 시작’ 알림", async () => {
    currentUser = f.owner.id;
    const today = todayDateOnly();
    const end = new Date(today.getTime() + 3 * 86_400_000);
    const t = await createTask(f.list.id, "오늘 시작", { startDate: keyOf(today)!, dueDate: keyOf(end)! });
    if (!t.ok) throw new Error(t.error);
    await runTick(new Date(`${keyOf(today)}T03:00:00.000Z`)); // 서울 정오
    const notes = await prisma.notification.findMany({ where: { taskId: t.data.id }, select: { kind: true, userId: true } });
    expect(notes).toEqual([{ kind: "START_TODAY", userId: f.owner.id }]);
  });
});
