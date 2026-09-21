import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getShareState, searchUsers } from "@/lib/queries/share";
import { getListRole } from "@/lib/permissions";

/**
 * 공유 상태 조회와 권한 경계.
 * 서버 액션은 세션이 필요해 여기서 직접 부르지 못하므로, 액션이 근거로 삼는
 * getShareState / getListRole 이 올바른 값을 주는지 고정한다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const suffix = `share-${process.pid}`;
const ids: Record<string, string> = {};

d("공유 (DB)", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { email: `so-${suffix}@x.test`, name: "소유자" },
    });
    const editor = await prisma.user.create({
      data: { email: `se-${suffix}@x.test`, name: "편집자" },
    });
    const viewer = await prisma.user.create({
      data: { email: `sv-${suffix}@x.test`, name: "열람자" },
    });
    const stranger = await prisma.user.create({
      data: { email: `ss-${suffix}@x.test`, name: "외부인" },
    });

    const group = await prisma.group.create({
      data: { ownerId: owner.id, name: `G-${suffix}`, order: "a0" },
    });
    const list = await prisma.list.create({
      data: { ownerId: owner.id, groupId: group.id, name: `L-${suffix}`, order: "a0" },
    });

    await prisma.share.create({
      data: { subjectType: "GROUP", subjectId: group.id, granteeUserId: editor.id, role: "EDITOR" },
    });
    await prisma.share.create({
      data: { subjectType: "LIST", subjectId: list.id, granteeUserId: viewer.id, role: "VIEWER" },
    });

    Object.assign(ids, {
      owner: owner.id, editor: editor.id, viewer: viewer.id, stranger: stranger.id,
      group: group.id, list: list.id,
    });
  });

  afterAll(async () => {
    if (!hasDb || !ids.owner) return;
    await prisma.share.deleteMany({ where: { subjectId: { in: [ids.group, ids.list] } } });
    await prisma.shareInvite.deleteMany({ where: { subjectId: { in: [ids.group, ids.list] } } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.owner, ids.editor, ids.viewer, ids.stranger] } },
    });
  });

  it("소유자만 관리 권한을 갖는다", async () => {
    const asOwner = await getShareState(ids.owner, { type: "LIST", id: ids.list });
    const asEditor = await getShareState(ids.editor, { type: "LIST", id: ids.list });
    const asViewer = await getShareState(ids.viewer, { type: "LIST", id: ids.list });

    expect(asOwner?.canManage).toBe(true);
    expect(asEditor?.canManage).toBe(false); // 편집자는 공유 설정을 못 바꾼다
    expect(asViewer?.canManage).toBe(false);
  });

  it("권한이 없으면 공유 상태 자체를 못 본다", async () => {
    expect(await getShareState(ids.stranger, { type: "LIST", id: ids.list })).toBeNull();
    expect(await getShareState(ids.stranger, { type: "GROUP", id: ids.group })).toBeNull();
  });

  it("구성원 목록에 소유자가 먼저 오고 역할이 정확하다", async () => {
    const state = await getShareState(ids.owner, { type: "LIST", id: ids.list });
    expect(state?.members[0].role).toBe("OWNER");
    expect(state?.members.find((m) => m.userId === ids.viewer)?.role).toBe("VIEWER");
    // 그룹 공유로 들어온 편집자는 목록의 Share 행이 아니므로 여기 목록에는 없다
    expect(state?.members.find((m) => m.userId === ids.editor)).toBeUndefined();
    expect(state?.inheritedFromGroup?.id).toBe(ids.group);
  });

  it("그룹 공유는 하위 목록 권한으로 이어진다", async () => {
    expect(await getListRole(ids.editor, ids.list)).toBe("EDITOR");
    expect(await getListRole(ids.stranger, ids.list)).toBeNull();
  });

  it("공유 대상 검색에서 자기 자신과 이미 공유된 사람은 빠진다", async () => {
    const hits = await searchUsers(ids.owner, suffix, [ids.viewer]);
    const emails = hits.map((h) => h.email);
    expect(emails).not.toContain(`so-${suffix}@x.test`); // 자기 자신
    expect(emails).not.toContain(`sv-${suffix}@x.test`); // 이미 공유됨
    expect(emails).toContain(`ss-${suffix}@x.test`);
  });
});
