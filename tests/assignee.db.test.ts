import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 담당자.
 *
 * 두 방향을 다 막아야 한다.
 *  - 지정하는 쪽: 그 작업을 고칠 수 있어야 한다
 *  - 지정받는 쪽: 그 목록을 볼 수 있어야 한다
 * 두 번째를 빼먹으면 열 수 없는 작업이 남의 [나에게 할당됨]에 쌓이고,
 * 주간보고서에는 볼 수 없는 목록의 담당자로 이름이 계속 찍힌다.
 */
// 서버 액션은 끝나면서 화면 캐시를 무효화한다. 요청 밖에서는 그럴 대상이 없다.
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

const { setAssignee } = await import("@/lib/actions/task");
const { removeShare } = await import("@/lib/actions/share");
const { getListMembers } = await import("@/lib/queries/members");
const { getAssignedView } = await import("@/lib/queries/tasks");
const { prisma } = await import("@/lib/db");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let f: Fixture;

beforeAll(async () => {
  if (!hasDb) return;
  f = await createFixture("assign");
});
afterAll(async () => {
  if (hasDb && f) await destroyFixture(f);
});

const assigneeOf = async (taskId: string) =>
  (await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { assigneeId: true } })).assigneeId;

d("담당자 후보", () => {
  it("목록을 볼 수 있는 사람만 나온다 — 읽기 권한자도 포함", async () => {
    const ids = (await getListMembers(f.list.id)).map((m) => m.id);
    expect(ids).toContain(f.owner.id); // 소유자
    expect(ids).toContain(f.editor.id); // 그룹 공유
    expect(ids).toContain(f.viewer.id); // 목록 공유(읽기)
    expect(ids).not.toContain(f.stranger.id);
  });

  it("소유자가 맨 앞에 온다", async () => {
    const members = await getListMembers(f.list.id);
    expect(members[0].id).toBe(f.owner.id);
    expect(members[0].isOwner).toBe(true);
  });

  it("공유받지 않은 목록에는 소유자만 있다", async () => {
    expect((await getListMembers(f.secretList.id)).map((m) => m.id)).toEqual([f.owner.id]);
  });
});

d("담당자 지정", () => {
  it("편집 권한이 있으면 지정할 수 있다", async () => {
    currentUser = f.editor.id;
    expect(await setAssignee(f.task.id, f.viewer.id)).toEqual({ ok: true });
    expect(await assigneeOf(f.task.id)).toBe(f.viewer.id);
  });

  it("읽기 권한만으로는 지정하지 못한다", async () => {
    currentUser = f.viewer.id;
    const res = await setAssignee(f.task.id, f.viewer.id);
    expect(res.ok).toBe(false);
  });

  it("목록을 볼 수 없는 사람은 담당자가 될 수 없다", async () => {
    currentUser = f.owner.id;
    const res = await setAssignee(f.task.id, f.stranger.id);
    expect(res.ok).toBe(false);
    expect(await assigneeOf(f.task.id)).toBe(f.viewer.id); // 그대로
  });

  it("없는 사람으로도 지정되지 않는다", async () => {
    currentUser = f.owner.id;
    expect((await setAssignee(f.task.id, "does-not-exist")).ok).toBe(false);
  });

  it("해제할 수 있다", async () => {
    currentUser = f.owner.id;
    expect(await setAssignee(f.task.id, null)).toEqual({ ok: true });
    expect(await assigneeOf(f.task.id)).toBeNull();
  });

  it("권한 밖 작업은 있는지조차 알려주지 않는다", async () => {
    currentUser = f.stranger.id;
    expect((await setAssignee(f.task.id, f.stranger.id)).ok).toBe(false);
  });
});

d("나에게 할당됨", () => {
  it("나를 담당자로 지정한 미완료 작업만 모은다", async () => {
    currentUser = f.owner.id;
    await setAssignee(f.task.id, f.viewer.id);

    const mine = await getAssignedView(f.viewer.id);
    expect(mine.open.map((t) => t.id)).toEqual([f.task.id]);

    const others = await getAssignedView(f.editor.id);
    expect(others.open.map((t) => t.id)).not.toContain(f.task.id);
  });
});

d("공유가 끊기면", () => {
  it("담당 지정도 함께 풀린다", async () => {
    currentUser = f.owner.id;
    await setAssignee(f.task.id, f.viewer.id);

    const share = await prisma.share.findFirstOrThrow({
      where: { subjectType: "LIST", subjectId: f.list.id, granteeUserId: f.viewer.id },
      select: { id: true },
    });
    expect(await removeShare(share.id)).toEqual({ ok: true });

    expect(await assigneeOf(f.task.id)).toBeNull();
    expect((await getAssignedView(f.viewer.id)).open.map((t) => t.id)).not.toContain(f.task.id);

    // 되돌려 둔다 — 뒤 테스트가 이 공유에 기댄다
    await prisma.share.create({
      data: { subjectType: "LIST", subjectId: f.list.id, granteeUserId: f.viewer.id, role: "VIEWER" },
    });
  });

  it("다른 경로로 여전히 볼 수 있으면 유지된다", async () => {
    currentUser = f.owner.id;
    // editor 는 그룹 공유로 이 목록을 본다. 목록 공유를 따로 걸었다가 빼도 그대로여야 한다.
    const extra = await prisma.share.create({
      data: { subjectType: "LIST", subjectId: f.list.id, granteeUserId: f.editor.id, role: "EDITOR" },
    });
    await setAssignee(f.task.id, f.editor.id);

    expect(await removeShare(extra.id)).toEqual({ ok: true });
    expect(await assigneeOf(f.task.id)).toBe(f.editor.id);

    await setAssignee(f.task.id, null);
  });
});
