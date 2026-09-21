import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getListRole, getGroupRole, getTaskRole } from "@/lib/permissions";

/**
 * 권한 상속을 실제 DB에서 확인한다.
 * DATABASE_URL 이 없으면(예: DB 없는 CI) 통째로 건너뛴다.
 *
 * 시드 데이터를 건드리지 않도록 자체 픽스처를 만들고 끝나면 지운다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const suffix = `test-${process.pid}`;
const ids: Record<string, string> = {};

d("권한 상속 (DB)", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { email: `owner-${suffix}@x.test`, name: "소유자" },
    });
    const mate = await prisma.user.create({
      data: { email: `mate-${suffix}@x.test`, name: "동료" },
    });
    const stranger = await prisma.user.create({
      data: { email: `str-${suffix}@x.test`, name: "외부인" },
    });

    const group = await prisma.group.create({
      data: { ownerId: owner.id, name: `G-${suffix}`, order: "a0" },
    });
    const inGroup = await prisma.list.create({
      data: { ownerId: owner.id, groupId: group.id, name: "그룹 안 목록", order: "a0" },
    });
    const outside = await prisma.list.create({
      data: { ownerId: owner.id, name: "그룹 밖 목록", order: "a1" },
    });
    const task = await prisma.task.create({
      data: { listId: inGroup.id, creatorId: owner.id, title: "작업", order: "a0" },
    });

    await prisma.share.create({
      data: { subjectType: "GROUP", subjectId: group.id, granteeUserId: mate.id, role: "EDITOR" },
    });

    Object.assign(ids, {
      owner: owner.id, mate: mate.id, stranger: stranger.id,
      group: group.id, inGroup: inGroup.id, outside: outside.id, task: task.id,
    });
  });

  afterAll(async () => {
    if (!hasDb || !ids.owner) return;
    await prisma.share.deleteMany({ where: { subjectId: { in: [ids.group, ids.inGroup] } } });
    // $disconnect() 하지 않는다. prisma 는 테스트 파일 사이에 공유되는 싱글턴이라
    // 여기서 커넥션 풀을 닫으면 아직 도는 다른 파일이 끊긴다.
    await prisma.user.deleteMany({ where: { id: { in: [ids.owner, ids.mate, ids.stranger] } } });
  });

  it("소유자는 자기 그룹·목록에서 ADMIN", async () => {
    expect(await getGroupRole(ids.owner, ids.group)).toBe("ADMIN");
    expect(await getListRole(ids.owner, ids.inGroup)).toBe("ADMIN");
  });

  it("그룹 공유가 하위 목록으로 상속된다", async () => {
    expect(await getListRole(ids.mate, ids.inGroup)).toBe("EDITOR");
  });

  it("작업은 소속 목록의 권한을 따른다", async () => {
    expect(await getTaskRole(ids.mate, ids.task)).toBe("EDITOR");
  });

  it("같은 그룹이 아니면 상속되지 않는다", async () => {
    expect(await getListRole(ids.mate, ids.outside)).toBeNull();
  });

  it("공유받지 않은 사용자는 권한이 없다", async () => {
    expect(await getListRole(ids.stranger, ids.inGroup)).toBeNull();
    expect(await getTaskRole(ids.stranger, ids.task)).toBeNull();
  });

  it("목록에 직접 준 권한이 더 높으면 그쪽이 이긴다", async () => {
    await prisma.share.create({
      data: { subjectType: "LIST", subjectId: ids.inGroup, granteeUserId: ids.mate, role: "ADMIN" },
    });
    expect(await getListRole(ids.mate, ids.inGroup)).toBe("ADMIN");
  });

  it("없는 항목은 권한 없음과 똑같이 null", async () => {
    expect(await getListRole(ids.mate, "does-not-exist")).toBeNull();
    expect(await getTaskRole(ids.mate, "does-not-exist")).toBeNull();
  });
});
