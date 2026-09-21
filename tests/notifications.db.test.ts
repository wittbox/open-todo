import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 알림.
 *
 * 세 가지를 못박는다.
 *  1. 같은 일로 두 번 알리지 않는다
 *  2. 볼 수 없는 것은 알리지 않고, 볼 수 없게 되면 걷어낸다
 *  3. 알림은 받는 사람 것이다 — 남의 것을 읽음 처리할 수 없다
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

const { notify, ownerOfTask } = await import("@/lib/notify");
const { setAssignee } = await import("@/lib/actions/task");
const { removeShare } = await import("@/lib/actions/share");
const { markNotificationRead, markAllNotificationsRead } = await import("@/lib/actions/notification");
const { listNotifications, unreadCount } = await import("@/lib/queries/notifications");
const { prisma } = await import("@/lib/db");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let f: Fixture;

beforeAll(async () => {
  if (!hasDb) return;
  f = await createFixture("notif");
});
afterAll(async () => {
  if (hasDb && f) await destroyFixture(f);
});

const clear = () => prisma.notification.deleteMany({ where: { taskId: f.task.id } });

d("만들기", () => {
  it("같은 일로 두 번 알리지 않는다", async () => {
    await clear();
    await notify({ userId: f.viewer.id, kind: "DUE_TODAY", taskId: f.task.id, dayKey: "2026-08-14" });
    await notify({ userId: f.viewer.id, kind: "DUE_TODAY", taskId: f.task.id, dayKey: "2026-08-14" });

    expect(await prisma.notification.count({ where: { taskId: f.task.id } })).toBe(1);
  });

  it("날짜가 다르면 다시 알린다", async () => {
    await notify({ userId: f.viewer.id, kind: "DUE_TODAY", taskId: f.task.id, dayKey: "2026-08-15" });
    expect(await prisma.notification.count({ where: { taskId: f.task.id } })).toBe(2);
  });

  it("볼 수 없는 사람에게는 알리지 않는다", async () => {
    await clear();
    await notify({ userId: f.stranger.id, kind: "DUE_TODAY", taskId: f.task.id });
    expect(await prisma.notification.count({ where: { taskId: f.task.id } })).toBe(0);
  });

  it("자기가 한 일은 자기에게 알리지 않는다", async () => {
    await clear();
    await notify({ userId: f.owner.id, kind: "ASSIGNED", taskId: f.task.id, actorId: f.owner.id });
    expect(await prisma.notification.count({ where: { taskId: f.task.id } })).toBe(0);
  });

  it("이미 읽은 알림을 다시 안 읽음으로 되돌리지 않는다", async () => {
    await clear();
    await notify({ userId: f.viewer.id, kind: "REMINDER", taskId: f.task.id, dayKey: "2026-08-20" });
    const n = await prisma.notification.findFirstOrThrow({ where: { taskId: f.task.id } });
    await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });

    await notify({ userId: f.viewer.id, kind: "REMINDER", taskId: f.task.id, dayKey: "2026-08-20" });
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.readAt).not.toBeNull();
  });
});

d("담당자 지정", () => {
  it("맡은 사람에게 알린다", async () => {
    await clear();
    currentUser = f.owner.id;
    await setAssignee(f.task.id, f.viewer.id);

    const rows = await prisma.notification.findMany({ where: { taskId: f.task.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(f.viewer.id);
    expect(rows[0].kind).toBe("ASSIGNED");
    expect(rows[0].actorId).toBe(f.owner.id);
  });

  it("자기 자신을 지정하면 알리지 않는다", async () => {
    await clear();
    currentUser = f.owner.id;
    await setAssignee(f.task.id, f.owner.id);
    expect(await prisma.notification.count({ where: { taskId: f.task.id } })).toBe(0);
  });
});

d("책임자 고르기", () => {
  it("담당자가 있으면 담당자", async () => {
    currentUser = f.owner.id;
    await setAssignee(f.task.id, f.viewer.id);
    expect(await ownerOfTask(f.task.id)).toBe(f.viewer.id);
  });

  it("없으면 만든 사람", async () => {
    currentUser = f.owner.id;
    await setAssignee(f.task.id, null);
    expect(await ownerOfTask(f.task.id)).toBe(f.owner.id);
  });
});

d("읽음 처리", () => {
  it("자기 알림만 읽을 수 있다", async () => {
    await clear();
    await notify({ userId: f.viewer.id, kind: "REMINDER", taskId: f.task.id, dayKey: "2026-09-01" });
    const n = await prisma.notification.findFirstOrThrow({ where: { taskId: f.task.id } });

    currentUser = f.editor.id; // 남의 알림
    await markNotificationRead(n.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).toBeNull();

    currentUser = f.viewer.id;
    await markNotificationRead(n.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).not.toBeNull();
  });

  it("모두 읽음은 내 것만 바꾼다", async () => {
    await clear();
    await notify({ userId: f.viewer.id, kind: "REMINDER", taskId: f.task.id, dayKey: "2026-09-02" });
    await notify({ userId: f.editor.id, kind: "REMINDER", taskId: f.task.id, dayKey: "2026-09-02" });

    currentUser = f.viewer.id;
    await markAllNotificationsRead();

    expect(await unreadCount(f.viewer.id)).toBe(0);
    expect(await unreadCount(f.editor.id)).toBeGreaterThan(0);
  });
});

d("공유가 끊기면", () => {
  it("그 목록에서 온 알림이 사라진다", async () => {
    await clear();
    await notify({ userId: f.viewer.id, kind: "DUE_TODAY", taskId: f.task.id, dayKey: "2026-09-03" });
    expect((await listNotifications(f.viewer.id)).length).toBeGreaterThan(0);

    const share = await prisma.share.findFirstOrThrow({
      where: { subjectType: "LIST", subjectId: f.list.id, granteeUserId: f.viewer.id },
      select: { id: true },
    });
    currentUser = f.owner.id;
    await removeShare(share.id);

    expect(await prisma.notification.count({ where: { userId: f.viewer.id, listId: f.list.id } })).toBe(0);

    await prisma.share.create({
      data: { subjectType: "LIST", subjectId: f.list.id, granteeUserId: f.viewer.id, role: "VIEWER" },
    });
  });
});
