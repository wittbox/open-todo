import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getSidebarData } from "@/lib/queries/sidebar";

/**
 * 사이드바의 공유된 목록 트리 (DB).
 *
 * 목록 하나만 받았든 그룹을 통째로 받았든 주인의 그룹 아래로 모이고, 순서는 주인이 정한
 * 그대로다. 같은 그룹에 있어도 공유받지 않은 목록은 나오지 않는다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const suffix = `shtree-${process.pid}-${Date.now()}`;
const ids: Record<string, string> = {};

d("공유된 목록 트리 (DB)", () => {
  beforeAll(async () => {
    const me = await prisma.user.create({
      data: { email: `me-${suffix}@x.test`, name: "나" },
    });
    const owner = await prisma.user.create({
      data: { email: `ow-${suffix}@x.test`, name: "김철수" },
    });
    // 주인 사이드바의 그룹 순서: 제품 출하 → 교육훈련 → 교육 자료 (가나다순과 다르다)
    const edu = await prisma.group.create({ data: { ownerId: owner.id, name: "교육훈련", order: "a1" } });
    const ship = await prisma.group.create({ data: { ownerId: owner.id, name: "제품 출하", order: "a0" } });
    const docs = await prisma.group.create({ data: { ownerId: owner.id, name: "교육 자료", order: "a2" } });

    const list = (name: string, order: string, groupId: string | null = null) =>
      prisma.list.create({ data: { ownerId: owner.id, name, order, groupId } });

    const eduB = await list("제품 교육", "a1", edu.id);
    const eduA = await list("신입 교육", "a0", edu.id);
    await list("공유 안 한 교육", "a2", edu.id);
    const out = await list("출하검사", "a0", ship.id);
    const loose = await list("장비 관리", "a0");
    await list("자료 1", "a0", docs.id);
    await list("자료 2", "a1", docs.id);

    await prisma.share.createMany({
      data: [
        ...[eduA, eduB, out, loose].map((l) => ({
          subjectType: "LIST" as const,
          subjectId: l.id,
          granteeUserId: me.id,
          role: "VIEWER" as const,
        })),
        { subjectType: "GROUP" as const, subjectId: docs.id, granteeUserId: me.id, role: "EDITOR" as const },
      ],
    });

    Object.assign(ids, { me: me.id, owner: owner.id });
  });

  afterAll(async () => {
    if (!hasDb || !ids.me) return;
    await prisma.share.deleteMany({ where: { granteeUserId: ids.me } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.me, ids.owner] } } });
  });

  const all = async () => {
    const data = await getSidebarData(ids.me);
    const tree = data!.sharedTree;
    return { tree, lists: [...tree.groups.flatMap((g) => g.lists), ...tree.lists] };
  };

  it("주인의 그룹 아래로 모이고, 그룹 순서·목록 순서는 주인이 정한 그대로", async () => {
    const { tree } = await all();
    expect(tree.groups.map((g) => [g.name, g.ownerName, g.lists.map((l) => l.name)])).toEqual([
      ["제품 출하", "김철수", ["출하검사"]],
      ["교육훈련", "김철수", ["신입 교육", "제품 교육"]],
      ["교육 자료", "김철수", ["자료 1", "자료 2"]],
    ]);
    expect(tree.lists.map((l) => l.name)).toEqual(["장비 관리"]);
  });

  it("같은 그룹이라도 공유받지 않은 목록은 나오지 않는다", async () => {
    const { lists } = await all();
    expect(lists.map((l) => l.name)).not.toContain("공유 안 한 교육");
  });

  it("권한은 그대로 — 목록만 받은 것은 읽기 전용, 그룹째 받은 것은 편집", async () => {
    const { lists } = await all();
    const byName = new Map(lists.map((l) => [l.name, l]));
    expect(byName.get("출하검사")!.role).toBe("VIEWER");
    expect(byName.get("자료 1")!.role).toBe("EDITOR");
  });
});
