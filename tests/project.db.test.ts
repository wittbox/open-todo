import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { assertCan, getProjectRole, PermissionError } from "@/lib/permissions";
import { getProjectView, listProjectsDirectory } from "@/lib/queries/project";
import { createProjectFixture, destroyProjectFixture, type ProjectFixture } from "./helpers/project-fixtures";

/**
 * 프로젝트의 권한과 멤버 동작 (DB).
 *
 * 비공개 프로젝트는 멤버가 아니면 존재도 몰라야 하고, 공개 프로젝트라도 참여하기 전에는
 * 대화를 볼 수 없어야 한다. 소유자는 못 나가고, 관리자는 소유자·다른 관리자를 못 뺀다.
 * 프로젝트를 지우면 딸린 것이 모두 사라진다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

let currentUser = "";
vi.mock("@/lib/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...orig,
    requireUserId: async () => {
      if (!currentUser) throw new orig.UnauthenticatedError();
      return currentUser;
    },
    getSessionUserId: async () => currentUser || null,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const actions = await import("@/lib/actions/project");
const as = (id: string) => {
  currentUser = id;
};

let f: ProjectFixture;

d("프로젝트 권한 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("proj");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  it("역할: 소유자·관리자 → ADMIN, 멤버 → EDITOR, 외부인 → null (공개·비공개 모두)", async () => {
    expect(await getProjectRole(f.owner.id, f.priv.id)).toBe("ADMIN");
    expect(await getProjectRole(f.admin.id, f.priv.id)).toBe("ADMIN");
    expect(await getProjectRole(f.member.id, f.priv.id)).toBe("EDITOR");
    expect(await getProjectRole(f.stranger.id, f.priv.id)).toBeNull();
    expect(await getProjectRole(f.stranger.id, f.pub.id)).toBeNull();
    expect(await getProjectRole(f.owner.id, "없는-id")).toBeNull();
  });

  it("멤버 행이 없어도 소유자면 ADMIN — 그룹과 같은 방어", async () => {
    await prisma.projectMember.deleteMany({ where: { projectId: f.pub.id, userId: f.owner.id } });
    expect(await getProjectRole(f.owner.id, f.pub.id)).toBe("ADMIN");
    await prisma.projectMember.create({ data: { projectId: f.pub.id, userId: f.owner.id, role: "ADMIN" } });
  });

  it("assertCan: 멤버는 manage 에서 막힌다", async () => {
    await expect(assertCan(f.member.id, "write", { kind: "project", id: f.priv.id })).resolves.toBe("EDITOR");
    await expect(assertCan(f.member.id, "manage", { kind: "project", id: f.priv.id })).rejects.toBeInstanceOf(PermissionError);
  });

  it("화면: 비공개 비멤버는 null, 공개 비멤버는 참여 안내, 보관된 공개는 null", async () => {
    expect(await getProjectView(f.stranger.id, f.priv.id)).toBeNull();
    const v = await getProjectView(f.stranger.id, f.pub.id);
    expect(v?.kind).toBe("joinable");
    expect(await getProjectView(f.stranger.id, f.archived.id)).toBeNull();
    const mine = await getProjectView(f.member.id, f.priv.id);
    expect(mine?.kind).toBe("member");
  });

  it("디렉터리: 외부인에게 비공개는 없고 공개는 '참여 가능'에, 멤버에게 보관은 따로", async () => {
    const s = await listProjectsDirectory(f.stranger.id);
    expect(s.open.map((p) => p.id)).toContain(f.pub.id);
    expect([...s.mine, ...s.open, ...s.archived].map((p) => p.id)).not.toContain(f.priv.id);
    const m = await listProjectsDirectory(f.member.id);
    expect(m.mine.map((p) => p.id).sort()).toEqual([f.pub.id, f.priv.id].sort());
    expect(m.archived.map((p) => p.id)).toEqual([f.archived.id]);
  });
});

d("프로젝트 멤버 동작 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("pact");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  it("비공개 참여는 없는 프로젝트 참여와 같은 답", async () => {
    as(f.stranger.id);
    const a = await actions.joinProject(f.priv.id);
    const b = await actions.joinProject("없는-id");
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
  });

  it("공개 참여: 참여 시점의 마지막 글까지 읽은 것으로 시작한다", async () => {
    await prisma.message.create({ data: { projectId: f.pub.id, authorId: f.owner.id, body: "지난 글" } });
    as(f.stranger.id);
    expect((await actions.joinProject(f.pub.id)).ok).toBe(true);
    const pm = await prisma.projectMember.findUniqueOrThrow({
      where: { projectId_userId: { projectId: f.pub.id, userId: f.stranger.id } },
    });
    const last = await prisma.message.aggregate({ where: { projectId: f.pub.id }, _max: { seq: true } });
    expect(pm.lastReadSeq).toBe(last._max.seq);
    expect((await actions.leaveProject(f.pub.id)).ok).toBe(true);
  });

  it("보관된 프로젝트는 참여할 수 없다", async () => {
    as(f.stranger.id);
    expect((await actions.joinProject(f.archived.id)).ok).toBe(false);
  });

  it("소유자는 못 나간다", async () => {
    as(f.owner.id);
    const r = await actions.leaveProject(f.priv.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("소유권");
  });

  it("관리자는 소유자와 다른 관리자를 못 빼고, 멤버는 뺄 수 있다", async () => {
    as(f.admin.id);
    expect((await actions.removeProjectMember(f.priv.id, f.owner.id)).ok).toBe(false);
    const extraAdmin = await prisma.user.create({
      data: { email: `xa-${f.p}@x.test`, name: "관리자2" },
    });
    await prisma.projectMember.create({ data: { projectId: f.priv.id, userId: extraAdmin.id, role: "ADMIN" } });
    expect((await actions.removeProjectMember(f.priv.id, extraAdmin.id)).ok).toBe(false);
    as(f.owner.id);
    expect((await actions.removeProjectMember(f.priv.id, extraAdmin.id)).ok).toBe(true);
    await prisma.user.delete({ where: { id: extraAdmin.id } });

    as(f.admin.id);
    expect((await actions.removeProjectMember(f.priv.id, f.member.id)).ok).toBe(true);
    expect(await getProjectRole(f.member.id, f.priv.id)).toBeNull();
    await prisma.projectMember.create({ data: { projectId: f.priv.id, userId: f.member.id, role: "MEMBER" } });
  });

  it("멤버 추가는 관리자만, 초대받은 사람에게만 알림", async () => {
    as(f.member.id);
    expect((await actions.addProjectMember(f.priv.id, f.stranger.id)).ok).toBe(false);
    as(f.admin.id);
    expect((await actions.addProjectMember(f.priv.id, f.stranger.id)).ok).toBe(true);
    const n = await prisma.notification.findMany({ where: { projectId: f.priv.id, kind: "PROJECT_INVITED" } });
    expect(n.map((x) => x.userId)).toEqual([f.stranger.id]);
    expect(n[0].actorId).toBe(f.admin.id);
    // 나가면 그 알림도 사라진다
    as(f.stranger.id);
    expect((await actions.leaveProject(f.priv.id)).ok).toBe(true);
    expect(await prisma.notification.count({ where: { userId: f.stranger.id, projectId: f.priv.id } })).toBe(0);
  });

  it("비공개로 바꾸면 디렉터리에서 사라진다", async () => {
    as(f.owner.id);
    expect((await actions.updateProject(f.pub.id, { isPublic: false })).ok).toBe(true);
    const s = await listProjectsDirectory(f.stranger.id);
    expect(s.open.map((p) => p.id)).not.toContain(f.pub.id);
    await actions.updateProject(f.pub.id, { isPublic: true });
  });

  it("소유권 넘기기: 멤버에게만, 새 소유자는 ADMIN, 전 소유자도 ADMIN 으로 남는다", async () => {
    as(f.owner.id);
    expect((await actions.transferOwnership(f.pub.id, f.stranger.id)).ok).toBe(false);
    expect((await actions.transferOwnership(f.pub.id, f.member.id)).ok).toBe(true);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: f.pub.id } });
    expect(p.ownerId).toBe(f.member.id);
    const rows = await prisma.projectMember.findMany({ where: { projectId: f.pub.id, userId: { in: [f.member.id, f.owner.id] } } });
    expect(rows.every((r) => r.role === "ADMIN")).toBe(true);
    as(f.member.id);
    await actions.transferOwnership(f.pub.id, f.owner.id);
  });

  it("삭제는 소유자만이고, 멤버·메시지·알림이 함께 사라진다", async () => {
    const extra = await prisma.project.create({
      data: {
        name: `지울-${f.p}`, ownerId: f.owner.id,
        members: { create: [{ userId: f.owner.id, role: "ADMIN" }, { userId: f.member.id, role: "MEMBER" }] },
      },
    });
    const m = await prisma.message.create({ data: { projectId: extra.id, authorId: f.owner.id, body: "글" } });
    await prisma.notification.create({
      data: { userId: f.member.id, kind: "MENTION", projectId: extra.id, messageId: m.id, actorId: f.owner.id, dayKey: "2026-09-16" },
    });
    as(f.admin.id);
    expect((await actions.deleteProject(extra.id)).ok).toBe(false);
    as(f.owner.id);
    expect((await actions.deleteProject(extra.id)).ok).toBe(true);
    expect(await prisma.project.findUnique({ where: { id: extra.id } })).toBeNull();
    expect(await prisma.projectMember.count({ where: { projectId: extra.id } })).toBe(0);
    expect(await prisma.message.count({ where: { projectId: extra.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { projectId: extra.id } })).toBe(0);
  });
});
