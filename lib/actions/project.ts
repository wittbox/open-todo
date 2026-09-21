"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { assertCan, PermissionError, ROLE_RANK } from "@/lib/permissions";
import { removeFile } from "@/lib/files/storage";
import { dropNotificationsForProject } from "@/lib/notify";
import { archivedError, notifyInvited, requireOpen, requireOwner } from "@/lib/projects/messages";
import { ActionError, cleanName, run, type ActionResult } from "@/lib/actions/_helpers";
import { translatorFor } from "@/i18n/server";
import { getRequestPrefs } from "@/lib/prefs";
import type { ProjectRole } from "@/app/generated/prisma/enums";

/**
 * 프로젝트(대화 공간) 자체와 멤버에 관한 동작.
 *
 * 프로젝트를 만들고·지우고·보관하고·참여하고·나가는 것은 사이드바를 바꾸므로 레이아웃을
 * 다시 그린다. 멤버 창 안의 동작은 그러지 않는다 — 다시 그리면 열린 창이 닫힌다(share.ts 와 같은 이유).
 */

function refresh() {
  revalidatePath("/", "layout");
}

const PURPOSE_MAX = 500;

function cleanPurpose(raw: string | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, PURPOSE_MAX);
}

/** 이름을 비워 보냈을 때 붙는 이름 — 저장되는 값이라 요청한 사람의 말로 만든다. */
async function untitledName(): Promise<string> {
  const t = translatorFor((await getRequestPrefs()).locale);
  return t("projects.defaults.untitled");
}

export async function createProject(input: {
  name: string;
  purpose?: string;
  isPublic: boolean;
}): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const project = await prisma.project.create({
      data: {
        name: cleanName(input.name, await untitledName()),
        purpose: cleanPurpose(input.purpose),
        isPublic: Boolean(input.isPublic),
        ownerId: userId,
        // 소유자도 멤버 행을 가진다 — 멤버 목록·안 읽음이 소유자를 특별 취급하지 않게.
        members: { create: { userId, role: "ADMIN" } },
      },
      select: { id: true },
    });
    refresh();
    return { id: project.id };
  });
}

export async function updateProject(
  id: string,
  patch: { name?: string; purpose?: string; isPublic?: boolean },
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "project", id });
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = cleanName(patch.name, await untitledName());
    if (patch.purpose !== undefined) data.purpose = cleanPurpose(patch.purpose);
    if (patch.isPublic !== undefined) data.isPublic = Boolean(patch.isPublic);
    if (Object.keys(data).length > 0) await prisma.project.update({ where: { id }, data });
    refresh();
  });
}

export async function setProjectArchived(id: string, archived: boolean): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await requireOwner(userId, id);
    await prisma.project.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    refresh();
  });
}

/** 소유권을 기존 멤버에게 넘긴다. 새 소유자는 ADMIN 이 되고, 전 소유자는 ADMIN 으로 남는다. */
export async function transferOwnership(id: string, toUserId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await requireOwner(userId, id);
    const target = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: toUserId } },
      select: { id: true },
    });
    if (!target) throw ActionError.key("projects.errors.transferToMemberOnly");
    await prisma.$transaction([
      prisma.project.update({ where: { id }, data: { ownerId: toUserId } }),
      prisma.projectMember.update({ where: { id: target.id }, data: { role: "ADMIN" } }),
      prisma.projectMember.updateMany({ where: { projectId: id, userId }, data: { role: "ADMIN" } }),
    ]);
    refresh();
  });
}

export async function deleteProject(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await requireOwner(userId, id);
    // 행은 cascade 로 사라지지만 디스크 파일은 우리가 지운다 — 먼저 열쇠를 모아 둔다.
    const files = await prisma.attachment.findMany({
      where: { message: { projectId: id } },
      select: { storageKey: true },
    });
    await prisma.project.delete({ where: { id } });
    for (const f of files) await removeFile(f.storageKey);
    refresh();
  });
}

/* ── 멤버 ─────────────────────────────────────────────────────── */

export async function joinProject(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const p = await prisma.project.findUnique({
      where: { id },
      select: { isPublic: true, archivedAt: true },
    });
    // 비공개 프로젝트에 참여하려는 것은 없는 프로젝트에 참여하려는 것과 같은 답을 받는다.
    if (!p || !p.isPublic) throw new PermissionError();
    if (p.archivedAt) throw await archivedError();

    // 참여 시점부터 센다 — 지난 글 전부가 안 읽음으로 잡히지 않게.
    const last = await prisma.message.aggregate({ where: { projectId: id }, _max: { seq: true } });
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId } },
      create: { projectId: id, userId, role: "MEMBER", lastReadSeq: last._max.seq ?? 0 },
      update: {},
    });
    refresh();
  });
}

export async function leaveProject(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const p = await prisma.project.findUnique({ where: { id }, select: { ownerId: true } });
    if (!p) throw new PermissionError();
    if (p.ownerId === userId) throw ActionError.key("projects.errors.ownerMustTransfer");
    await prisma.projectMember.deleteMany({ where: { projectId: id, userId } });
    await dropNotificationsForProject(userId, id);
    refresh();
  });
}

export async function addProjectMember(id: string, targetUserId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "project", id });
    await requireOpen(id);
    const last = await prisma.message.aggregate({ where: { projectId: id }, _max: { seq: true } });
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: targetUserId } },
      create: { projectId: id, userId: targetUserId, role: "MEMBER", invitedById: userId, lastReadSeq: last._max.seq ?? 0 },
      update: {},
    });
    await notifyInvited(id, targetUserId, userId);
  });
}

/**
 * 멤버 내보내기. ADMIN 은 MEMBER 만, 다른 ADMIN 은 소유자만 뺄 수 있다. 소유자는 아무도 못 뺀다.
 */
export async function removeProjectMember(id: string, targetUserId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "project", id });
    const p = await prisma.project.findUnique({ where: { id }, select: { ownerId: true } });
    if (!p) throw new PermissionError();
    if (targetUserId === p.ownerId) throw ActionError.key("projects.errors.ownerCannotBeRemoved");
    const target = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: targetUserId } },
      select: { role: true },
    });
    if (!target) return;
    if (target.role === "ADMIN" && userId !== p.ownerId) throw ActionError.key("projects.errors.removeAdminOwnerOnly");
    await prisma.projectMember.deleteMany({ where: { projectId: id, userId: targetUserId } });
    await dropNotificationsForProject(targetUserId, id);
  });
}

/** 역할 바꾸기. 승격은 ADMIN 이, 강등은 소유자만. 소유자의 역할은 못 바꾼다. */
export async function setProjectMemberRole(id: string, targetUserId: string, role: ProjectRole): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const myRole = await assertCan(userId, "manage", { kind: "project", id });
    const p = await prisma.project.findUnique({ where: { id }, select: { ownerId: true } });
    if (!p) throw new PermissionError();
    if (targetUserId === p.ownerId) throw ActionError.key("projects.errors.ownerRoleFixed");
    if (role === "MEMBER" && userId !== p.ownerId) throw ActionError.key("projects.errors.demoteOwnerOnly");
    if (ROLE_RANK[myRole] < ROLE_RANK.ADMIN) throw new PermissionError();
    await prisma.projectMember.updateMany({ where: { projectId: id, userId: targetUserId }, data: { role } });
  });
}

/**
 * 읽은 위치. 단조롭다 — 뒤로 가지 않는다. where 에 userId 가 있어 비멤버의 호출은 아무 일도 안 한다.
 * 화면이 자주 부르므로 레이아웃을 다시 그리지 않는다.
 */
export async function markProjectRead(id: string, seq: number): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const upTo = Math.max(0, Math.floor(Number(seq) || 0));
    await prisma.projectMember.updateMany({
      where: { projectId: id, userId, lastReadSeq: { lt: upTo } },
      data: { lastReadSeq: upTo },
    });
  });
}
