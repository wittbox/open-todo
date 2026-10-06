import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 목록은 늘 그룹 안에 있다(기본 목록만 예외).
 *
 * 화면에서 길을 닫는 것만으로는 부족하다 — 서버 액션이 그대로면 옛 화면이나 직접 호출로 그룹 밖 목록이 다시 생긴다.
 * 그래서 만들기·옮기기·순서 바꾸기·복제·그룹 삭제를 서버에서 못박고, 그 전에 밖에 있던 목록을 '기타' 로 모으는
 * 마이그레이션도 여기서 돌려 본다.
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

const { createList, moveListToGroup, reorderList, duplicateList } = await import("@/lib/actions/list");
const { createGroup, deleteGroup } = await import("@/lib/actions/group");
const { prisma } = await import("@/lib/db");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let f: Fixture;
beforeAll(async () => {
  if (!hasDb) return;
  f = await createFixture("ingroup");
});
afterAll(async () => {
  if (hasDb && f) await destroyFixture(f);
});

const groupsOf = (ownerId: string) =>
  prisma.group.findMany({ where: { ownerId }, select: { id: true, name: true, order: true } });
const byteOrder = <T extends { order: string }>(xs: T[]) => [...xs].sort((a, b) => (a.order < b.order ? -1 : 1));

d("만들기", () => {
  it("고른 그룹에 만든다", async () => {
    currentUser = f.owner.id;
    const res = await createList("심사 준비", { groupId: f.group.id });
    expect(res.ok && res.data.groupId).toBe(f.group.id);
    const list = await prisma.list.findUniqueOrThrow({ where: { id: res.ok ? res.data.id : "" } });
    expect(list.groupId).toBe(f.group.id);
  });

  it("새 그룹 이름을 주면 내 그룹들 맨 아래에 그룹을 만들고 그 안에 넣는다", async () => {
    currentUser = f.owner.id;
    const res = await createList("할 일", { newGroupName: "  개인 " });
    expect(res.ok).toBe(true);
    const groups = byteOrder(await groupsOf(f.owner.id));
    expect(groups.at(-1)!.name).toBe("개인");
    expect(res.ok && res.data.groupId).toBe(groups.at(-1)!.id);
  });

  it("그룹 없이는 만들 수 없다 — 빈 그룹 id, 빈 새 그룹 이름 모두", async () => {
    currentUser = f.owner.id;
    const before = await prisma.list.count({ where: { ownerId: f.owner.id } });
    const a = await createList("밖", { groupId: "" });
    const b = await createList("밖", { newGroupName: "   " });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(await prisma.list.count({ where: { ownerId: f.owner.id } })).toBe(before);
  });

  it("남의 그룹에는 만들 수 없다", async () => {
    currentUser = f.stranger.id;
    const res = await createList("끼어들기", { groupId: f.group.id });
    expect(res.ok).toBe(false);
  });

  it("새 그룹은 내 그룹들 맨 아래", async () => {
    currentUser = f.owner.id;
    const res = await createGroup("인허가");
    const groups = byteOrder(await groupsOf(f.owner.id));
    expect(res.ok && res.data.id).toBe(groups.at(-1)!.id);
  });
});

d("그룹 밖으로 나가는 길은 닫혀 있다", () => {
  it("옮기기·순서 바꾸기에 그룹 없음(null)을 주면 거절", async () => {
    currentUser = f.owner.id;
    const move = await moveListToGroup(f.list.id, null as unknown as string);
    const reorder = await reorderList(f.list.id, null as unknown as string, null, null);
    expect(move.ok).toBe(false);
    expect(reorder.ok).toBe(false);
    expect((await prisma.list.findUniqueOrThrow({ where: { id: f.list.id } })).groupId).toBe(f.group.id);
  });

  it("그룹 삭제는 빈 그룹만 — 목록이 있으면 몇 개인지 말하고 거절", async () => {
    currentUser = f.owner.id;
    const full = await deleteGroup(f.group.id);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error).toMatch(/목록이 \d+개/);
    expect(await prisma.group.count({ where: { id: f.group.id } })).toBe(1);

    const empty = await createGroup("빈 그룹");
    const gone = await deleteGroup(empty.ok ? empty.data.id : "");
    expect(gone.ok).toBe(true);
    expect(await prisma.group.count({ where: { id: empty.ok ? empty.data.id : "" } })).toBe(0);
  });

  it("공유받은 목록을 복제하면 내 그룹에 들어간다 — 내 그룹이 없으면 '기타' 를 만든다", async () => {
    currentUser = f.viewer.id;
    expect(await prisma.group.count({ where: { ownerId: f.viewer.id } })).toBe(0);
    const res = await duplicateList(f.list.id);
    expect(res.ok).toBe(true);
    const copy = await prisma.list.findUniqueOrThrow({
      where: { id: res.ok ? res.data.id : "" },
      select: { ownerId: true, group: { select: { ownerId: true, name: true } } },
    });
    expect(copy.ownerId).toBe(f.viewer.id);
    expect(copy.group).toEqual({ ownerId: f.viewer.id, name: "기타" });
  });
});

d("마이그레이션 — 그룹 밖 목록을 '기타' 로", () => {
  it("주인마다 '기타' 를 그룹들 맨 아래에 만들어 모은다. 기본 목록과 순서값은 그대로", async () => {
    // 픽스처의 secretList 는 그룹 밖에 있다(예전 데이터 모양). 하나 더 두고 기본 목록도 둔다.
    const loose2 = await prisma.list.create({
      data: { ownerId: f.owner.id, name: "밖-2", order: "a3" },
      select: { id: true },
    });
    const inbox = await prisma.list.create({
      data: { ownerId: f.owner.id, name: "작업", order: "a0", isInbox: true },
      select: { id: true },
    });
    const beforeGroups = byteOrder(await groupsOf(f.owner.id));

    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261006000000_lists_always_in_group/migration.sql"),
      "utf8",
    );
    await prisma.$executeRawUnsafe(sql);

    const groups = byteOrder(await groupsOf(f.owner.id));
    expect(groups).toHaveLength(beforeGroups.length + 1);
    const etc = groups.at(-1)!;
    expect(etc.name).toBe("기타");
    expect(etc.order > beforeGroups.at(-1)!.order).toBe(true);

    const moved = await prisma.list.findMany({
      where: { id: { in: [f.secretList.id, loose2.id] } },
      select: { groupId: true, order: true },
      orderBy: { name: "asc" },
    });
    expect(moved.every((l) => l.groupId === etc.id)).toBe(true);
    expect(moved.map((l) => l.order).sort()).toEqual(["a1", "a3"]);
    expect((await prisma.list.findUniqueOrThrow({ where: { id: inbox.id } })).groupId).toBeNull();

    // 다시 돌려도 새로 만들 것이 없다
    await prisma.$executeRawUnsafe(sql);
    expect(await prisma.group.count({ where: { ownerId: f.owner.id } })).toBe(groups.length);
  });

  it("영어를 고른 사람의 그룹은 'Other'", async () => {
    await prisma.user.update({ where: { id: f.editor.id }, data: { settings: { locale: "en" } } });
    await prisma.list.create({ data: { ownerId: f.editor.id, name: "loose", order: "a0" } });
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261006000000_lists_always_in_group/migration.sql"),
      "utf8",
    );
    await prisma.$executeRawUnsafe(sql);
    const groups = await groupsOf(f.editor.id);
    expect(groups.map((g) => g.name)).toEqual(["Other"]);
  });
});
