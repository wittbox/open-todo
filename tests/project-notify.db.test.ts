import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createProjectFixture, destroyProjectFixture, type ProjectFixture } from "./helpers/project-fixtures";

/**
 * 멘션 알림 (DB).
 *
 * 멤버에게만, 자기 자신에겐 안 가고, @전체는 작성자 빼고 모두. 비멤버 토큰은 평문이 되어 알림이 없다.
 * 고치면 새로 부른 사람에게만. 나가면 그 프로젝트 알림이 사라진다. 메시지가 지워지면 알림도 사라진다.
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

const msg = await import("@/lib/actions/message");
const proj = await import("@/lib/actions/project");
const as = (id: string) => {
  currentUser = id;
};

let f: ProjectFixture;
const mentionsOf = (userId: string, projectId: string) =>
  prisma.notification.findMany({ where: { userId, projectId, kind: "MENTION" }, select: { messageId: true } });

d("멘션 알림 (DB)", () => {
  beforeAll(async () => {
    f = await createProjectFixture("mention");
  });
  afterAll(async () => {
    if (f) await destroyProjectFixture(f);
  });

  it("멤버 토큰은 알림, 비멤버 토큰은 평문으로 바뀌고 알림 없음, 자기 자신도 없음", async () => {
    as(f.owner.id);
    const r = await msg.postMessage(f.priv.id, `<@${f.member.id}> <@${f.stranger.id}> <@${f.owner.id}> 확인`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.body).toBe(`<@${f.member.id}> @외부인 <@${f.owner.id}> 확인`);
    expect(r.data.mentions.map((m) => m.userId)).toEqual([f.member.id]);
    expect(await mentionsOf(f.member.id, f.priv.id)).toHaveLength(1);
    expect(await mentionsOf(f.stranger.id, f.priv.id)).toHaveLength(0);
    expect(await mentionsOf(f.owner.id, f.priv.id)).toHaveLength(0);
    const n = await prisma.notification.findFirst({ where: { userId: f.member.id, messageId: r.data.id } });
    expect(n?.actorId).toBe(f.owner.id);
  });

  it("@전체는 작성자 빼고 모두, 같은 사람을 따로 불러도 한 건", async () => {
    as(f.member.id);
    const r = await msg.postMessage(f.pub.id, `<@all> <@${f.admin.id}> 회의`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.mentionsAll).toBe(true);
    const rows = await prisma.notification.findMany({ where: { messageId: r.data.id }, select: { userId: true } });
    expect(rows.map((x) => x.userId).sort()).toEqual([f.owner.id, f.admin.id].sort());
  });

  it("고치면 새로 부른 사람에게만 알리고, 뺀 사람의 멘션 행은 지운다", async () => {
    as(f.owner.id);
    const r = await msg.postMessage(f.priv.id, `<@${f.member.id}> 처음`);
    if (!r.ok) throw new Error(r.error);
    expect((await msg.editMessage(r.data.id, `<@${f.admin.id}> 고침`)).ok).toBe(true);
    const rows = await prisma.messageMention.findMany({ where: { messageId: r.data.id }, select: { userId: true } });
    expect(rows.map((x) => x.userId)).toEqual([f.admin.id]);
    expect(await prisma.notification.count({ where: { messageId: r.data.id, userId: f.admin.id } })).toBe(1);
    // 같은 사람을 다시 넣어도 알림은 그대로 한 건
    expect((await msg.editMessage(r.data.id, `<@${f.admin.id}> <@${f.member.id}> 또 고침`)).ok).toBe(true);
    expect(await prisma.notification.count({ where: { messageId: r.data.id, userId: f.admin.id } })).toBe(1);
  });

  it("메시지를 지우면 알림도, 프로젝트에서 나가면 그 사람의 알림도 사라진다", async () => {
    as(f.owner.id);
    const r = await msg.postMessage(f.pub.id, `<@${f.member.id}> 지울 글`);
    if (!r.ok) throw new Error(r.error);
    expect(await prisma.notification.count({ where: { messageId: r.data.id } })).toBe(1);
    expect((await msg.deleteMessage(r.data.id)).ok).toBe(true);
    expect(await prisma.notification.count({ where: { messageId: r.data.id } })).toBe(0);

    const r2 = await msg.postMessage(f.pub.id, `<@${f.member.id}> 남을 글`);
    if (!r2.ok) throw new Error(r2.error);
    as(f.member.id);
    expect((await proj.leaveProject(f.pub.id)).ok).toBe(true);
    expect(await prisma.notification.count({ where: { userId: f.member.id, projectId: f.pub.id } })).toBe(0);
  });

  it("21명 넘게 부르면 거부", async () => {
    const many = await Promise.all(
      Array.from({ length: 21 }, (_, i) =>
        prisma.user.create({ data: { email: `mm${i}-${f.p}@x.test`, name: `사람${i}` } }),
      ),
    );
    await prisma.projectMember.createMany({ data: many.map((u) => ({ projectId: f.priv.id, userId: u.id, role: "MEMBER" })) });
    as(f.owner.id);
    const r = await msg.postMessage(f.priv.id, many.map((u) => `<@${u.id}>`).join(" "));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("20명");
    await prisma.user.deleteMany({ where: { id: { in: many.map((u) => u.id) } } });
  });
});
