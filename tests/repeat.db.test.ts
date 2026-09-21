import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 반복 작업의 완료 왕복.
 *
 * 날짜 계산은 tests/repeat.test.ts 가 잡는다. 여기서 확인하는 것은
 * "완료를 누르면 다음 하나가 정확히 하나 생기는가", 그리고
 * "되돌리면 그것이 사라지되 손댄 것은 남는가" 두 가지다.
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

const { updateTask, setRepeat, createStep, updateStep, setAssignee } = await import("@/lib/actions/task");
const { prisma } = await import("@/lib/db");
const { dateOnlyToString } = await import("@/lib/date");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let f: Fixture;

/**
 * 시계를 고정한다.
 *
 * 다음 회차는 "완료한 날과 기준일 중 나중" 뒤에서 잡힌다. 그래서 오늘이 언제인지에
 * 따라 답이 달라지고, 실제로 이 파일은 한 달 뒤에 저절로 깨졌다(8/19 를 기대했는데
 * 9/16 이 나왔다). 날짜를 다루는 테스트는 '오늘'을 가정하면 안 된다.
 */
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-12T09:00:00+09:00"));
  if (!hasDb) return;
  f = await createFixture("repeat");
});
afterAll(async () => {
  vi.useRealTimers();
  if (hasDb && f) await destroyFixture(f);
});

/** 매번 새 작업으로 시작한다 — 앞 테스트가 남긴 후속 작업에 얽히지 않게. */
async function makeTask(opts: { due?: string; title?: string } = {}) {
  currentUser = f.owner.id;
  return prisma.task.create({
    data: {
      listId: f.list.id,
      creatorId: f.owner.id,
      title: opts.title ?? "반복 작업",
      order: "m0",
      dueDate: opts.due ? new Date(`${opts.due}T00:00:00.000Z`) : null,
    },
    select: { id: true, seq: true },
  });
}

const followUps = (id: string) =>
  prisma.task.findMany({
    where: { repeatFromId: id },
    select: { id: true, seq: true, title: true, dueDate: true, assigneeId: true, isImportant: true,
              repeatUnit: true, steps: { select: { title: true, isCompleted: true } } },
  });

d("완료하면 다음 하나가 생긴다", () => {
  it("반복이 없으면 아무것도 생기지 않는다", async () => {
    const t = await makeTask({ due: "2026-08-12" });
    await updateTask(t.id, { isCompleted: true });
    expect(await followUps(t.id)).toHaveLength(0);
  });

  it("반복이 있으면 정확히 하나, 다음 기한으로", async () => {
    const t = await makeTask({ due: "2026-08-12" });
    await setRepeat(t.id, { unit: "WEEK", every: 1, days: [3] });
    await updateTask(t.id, { isCompleted: true });

    const next = await followUps(t.id);
    expect(next).toHaveLength(1);
    expect(dateOnlyToString(next[0].dueDate!)).toBe("2026-08-19");
    expect(next[0].repeatUnit).toBe("WEEK");
  });

  it("새 작업은 새 일련번호를 받는다", async () => {
    const t = await makeTask({ due: "2026-08-12" });
    await setRepeat(t.id, { unit: "DAY", every: 1, days: [] });
    await updateTask(t.id, { isCompleted: true });

    const [next] = await followUps(t.id);
    expect(next.seq).not.toBe(t.seq);
  });

  it("제목·중요·담당자·세부 단계가 따라가되 체크는 풀린다", async () => {
    const t = await makeTask({ due: "2026-08-12", title: "주간 회의 준비" });
    await updateTask(t.id, { isImportant: true });
    await setAssignee(t.id, f.editor.id);
    await setRepeat(t.id, { unit: "WEEK", every: 1, days: [3] });

    const step = await createStep(t.id, "자료 취합");
    expect(step.ok).toBe(true);
    if (step.ok) await updateStep(step.data!.id, { isCompleted: true });

    await updateTask(t.id, { isCompleted: true });

    const [next] = await followUps(t.id);
    expect(next.title).toBe("주간 회의 준비");
    expect(next.isImportant).toBe(true);
    expect(next.assigneeId).toBe(f.editor.id);
    expect(next.steps).toEqual([{ title: "자료 취합", isCompleted: false }]);
  });

  it("기한이 없으면 완료한 날을 기준으로 잡는다", async () => {
    const t = await makeTask();
    await setRepeat(t.id, { unit: "DAY", every: 1, days: [] });
    await updateTask(t.id, { isCompleted: true });

    const [next] = await followUps(t.id);
    expect(next.dueDate).not.toBeNull();
  });

  it("두 번 완료해도 하나만 생긴다", async () => {
    const t = await makeTask({ due: "2026-08-12" });
    await setRepeat(t.id, { unit: "WEEK", every: 1, days: [3] });
    await updateTask(t.id, { isCompleted: true });
    await updateTask(t.id, { isImportant: true }); // 완료 상태에서 다른 수정
    expect(await followUps(t.id)).toHaveLength(1);
  });
});

d("완료를 되돌리면", () => {
  it("손대지 않은 다음 작업은 사라진다", async () => {
    const t = await makeTask({ due: "2026-08-12" });
    await setRepeat(t.id, { unit: "WEEK", every: 1, days: [3] });
    await updateTask(t.id, { isCompleted: true });
    expect(await followUps(t.id)).toHaveLength(1);

    await updateTask(t.id, { isCompleted: false });
    expect(await followUps(t.id)).toHaveLength(0);
  });

  it("이미 손댄 것은 남는다", async () => {
    const t = await makeTask({ due: "2026-08-12" });
    await setRepeat(t.id, { unit: "WEEK", every: 1, days: [3] });
    await createStep(t.id, "자료 취합");
    await updateTask(t.id, { isCompleted: true });

    const [next] = await followUps(t.id);
    const s = await prisma.step.findFirstOrThrow({ where: { taskId: next.id } });
    await updateStep(s.id, { isCompleted: true }); // 다음 작업을 건드렸다

    await updateTask(t.id, { isCompleted: false });
    expect(await followUps(t.id)).toHaveLength(1);
  });
});

d("반복 해제", () => {
  it("이미 생긴 작업은 남기고 앞으로만 멈춘다", async () => {
    const t = await makeTask({ due: "2026-08-12" });
    await setRepeat(t.id, { unit: "WEEK", every: 1, days: [3] });
    await updateTask(t.id, { isCompleted: true });
    const [next] = await followUps(t.id);

    await setRepeat(next.id, null);
    await updateTask(next.id, { isCompleted: true });

    expect(await followUps(next.id)).toHaveLength(0);
    expect(await prisma.task.count({ where: { id: next.id } })).toBe(1);
  });

  it("편집 권한이 없으면 규칙을 바꾸지 못한다", async () => {
    const t = await makeTask({ due: "2026-08-12" });
    currentUser = f.viewer.id;
    expect((await setRepeat(t.id, { unit: "DAY", every: 1, days: [] })).ok).toBe(false);
    currentUser = f.owner.id;
  });
});
