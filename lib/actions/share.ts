"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { assertCan, PermissionError, ROLE_RANK, type Role } from "@/lib/permissions";
import { canBeAssigned } from "@/lib/queries/members";
import { dropNotificationsForList, notify } from "@/lib/notify";
import { run, type ActionResult } from "./_helpers";
import type { ShareRole, ShareSubjectType } from "@/app/generated/prisma/enums";
import { getRequestPrefs } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";

/** 거절 사유를 요청한 사람의 언어로. */
async function shareText(key: string): Promise<string> {
  return (translatorFor((await getRequestPrefs()).locale) as unknown as (k: string) => string)(key);
}

/**
 * 공유 변경은 전역 revalidate 를 하지 않는다.
 * 루트 레이아웃을 무효화하면 열려 있던 공유 다이얼로그가 리마운트되면서 닫혀 버린다.
 * 다이얼로그는 자기 상태를 다시 읽고, 닫을 때 router.refresh() 로 사이드바를 갱신한다.
 * 화면 이동이 뒤따르는 acceptInvite 만 예외로 전역 갱신한다.
 */
function refreshAll() {
  revalidatePath("/", "layout");
}

function target(type: ShareSubjectType, id: string) {
  return { kind: type === "GROUP" ? ("group" as const) : ("list" as const), id };
}

async function ownerOf(type: ShareSubjectType, id: string): Promise<string> {
  const row =
    type === "GROUP"
      ? await prisma.group.findUnique({ where: { id }, select: { ownerId: true } })
      : await prisma.list.findUnique({ where: { id }, select: { ownerId: true } });
  if (!row) throw new PermissionError();
  return row.ownerId;
}

export async function shareWithUser(
  type: ShareSubjectType,
  id: string,
  granteeUserId: string,
  role: ShareRole,
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", target(type, id));

    const owner = await ownerOf(type, id);
    if (granteeUserId === owner) throw new PermissionError(await shareText("share.errors.ownerRole"));

    await prisma.share.upsert({
      where: {
        subjectType_subjectId_granteeUserId: { subjectType: type, subjectId: id, granteeUserId },
      },
      create: { subjectType: type, subjectId: id, granteeUserId, role, invitedById: userId },
      update: { role, invitedById: userId },
    });

    // 공유받은 사람에게 알린다. 그룹이면 그 안의 목록 하나로 대표한다 —
    // 목록 수만큼 알림을 쌓으면 알림 목록이 그걸로 가득 찬다.
    const list = await prisma.list.findFirst({
      where: type === "GROUP" ? { groupId: id } : { id },
      select: { id: true },
    });
    if (list) {
      await notify({ userId: granteeUserId, kind: "SHARED", listId: list.id, actorId: userId });
    }
  });
}

export async function updateShareRole(shareId: string, role: ShareRole): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const share = await prisma.share.findUnique({
      where: { id: shareId },
      select: { subjectType: true, subjectId: true },
    });
    if (!share) throw new PermissionError();

    await assertCan(userId, "manage", target(share.subjectType, share.subjectId));
    await prisma.share.update({ where: { id: shareId }, data: { role } });
  });
}

export async function removeShare(shareId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const share = await prisma.share.findUnique({
      where: { id: shareId },
      select: { subjectType: true, subjectId: true, granteeUserId: true },
    });
    if (!share) throw new PermissionError();

    // 관리 권한이 있거나, 자기 자신의 공유를 스스로 빼는 것은 허용한다.
    if (share.granteeUserId !== userId) {
      await assertCan(userId, "manage", target(share.subjectType, share.subjectId));
    }
    await prisma.share.delete({ where: { id: shareId } });
    await dropAssignmentsLostWith(share.granteeUserId, share.subjectType, share.subjectId);
    await dropLostNotifications(share.granteeUserId, share.subjectType, share.subjectId);
  });
}

/** 더는 볼 수 없게 된 목록의 알림을 걷어낸다. */
async function dropLostNotifications(
  granteeUserId: string,
  subjectType: ShareSubjectType,
  subjectId: string,
): Promise<void> {
  const lists = await prisma.list.findMany({
    where: subjectType === "GROUP" ? { groupId: subjectId } : { id: subjectId },
    select: { id: true },
  });
  for (const l of lists) {
    if (!(await canBeAssigned(granteeUserId, l.id))) {
      await dropNotificationsForList(granteeUserId, l.id);
    }
  }
}

/**
 * 공유가 끊긴 사람에게 남아 있는 담당 지정을 푼다.
 *
 * 안 풀면 그 사람의 [나에게 할당됨]에 열 수 없는 작업이 남고, 주간보고서에는
 * 볼 수 없는 목록의 담당자로 이름이 계속 찍힌다. 다른 경로(그룹 공유 등)로
 * 여전히 볼 수 있는 작업은 건드리지 않는다.
 */
async function dropAssignmentsLostWith(
  granteeUserId: string,
  subjectType: ShareSubjectType,
  subjectId: string,
): Promise<void> {
  const assigned = await prisma.task.findMany({
    where: {
      assigneeId: granteeUserId,
      list: subjectType === "GROUP" ? { groupId: subjectId } : { id: subjectId },
    },
    select: { id: true, listId: true },
  });
  if (assigned.length === 0) return;

  const stillVisible = new Map<string, boolean>();
  const orphaned: string[] = [];

  for (const t of assigned) {
    if (!stillVisible.has(t.listId)) {
      stillVisible.set(t.listId, await canBeAssigned(granteeUserId, t.listId));
    }
    if (!stillVisible.get(t.listId)) orphaned.push(t.id);
  }

  if (orphaned.length > 0) {
    await prisma.task.updateMany({ where: { id: { in: orphaned } }, data: { assigneeId: null } });
  }
}

const INVITE_DAYS = 7;

export async function createInviteLink(
  type: ShareSubjectType,
  id: string,
  role: ShareRole,
): Promise<ActionResult<{ token: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", target(type, id));

    const token = randomBytes(24).toString("base64url");
    await prisma.shareInvite.create({
      data: {
        token,
        subjectType: type,
        subjectId: id,
        role,
        createdById: userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      },
    });
    return { token };
  });
}

export async function revokeInviteLink(token: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const invite = await prisma.shareInvite.findUnique({
      where: { token },
      select: { subjectType: true, subjectId: true },
    });
    if (!invite) throw new PermissionError();

    await assertCan(userId, "manage", target(invite.subjectType, invite.subjectId));
    await prisma.shareInvite.delete({ where: { token } });
  });
}

export type AcceptResult = { subjectType: ShareSubjectType; subjectId: string; listId: string | null };

/**
 * 초대 링크 수락. 링크를 아는 사람이면 누구나 쓸 수 있으므로
 *  - 만료된 링크는 거절하고
 *  - 이미 더 높은 권한이 있으면 낮추지 않는다.
 */
export async function acceptInvite(token: string): Promise<ActionResult<AcceptResult>> {
  return run(async () => {
    const userId = await requireUserId();

    const invite = await prisma.shareInvite.findUnique({
      where: { token },
      select: { subjectType: true, subjectId: true, role: true, expiresAt: true },
    });
    if (!invite || invite.expiresAt < new Date()) {
      throw new PermissionError(await shareText("share.errors.inviteInvalid"));
    }

    const owner = await ownerOf(invite.subjectType, invite.subjectId);
    const existing =
      owner === userId
        ? null
        : await prisma.share.findUnique({
            where: {
              subjectType_subjectId_granteeUserId: {
                subjectType: invite.subjectType,
                subjectId: invite.subjectId,
                granteeUserId: userId,
              },
            },
            select: { role: true },
          });

    const keepHigher = existing != null && ROLE_RANK[existing.role as Role] >= ROLE_RANK[invite.role as Role];

    if (owner !== userId && !keepHigher) {
      await prisma.share.upsert({
        where: {
          subjectType_subjectId_granteeUserId: {
            subjectType: invite.subjectType,
            subjectId: invite.subjectId,
            granteeUserId: userId,
          },
        },
        create: {
          subjectType: invite.subjectType,
          subjectId: invite.subjectId,
          granteeUserId: userId,
          role: invite.role,
        },
        update: { role: invite.role },
      });
    }

    await prisma.shareInvite.update({ where: { token }, data: { usedAt: new Date() } });

    // 그룹 초대면 그 그룹의 첫 목록으로 보낸다.
    const listId =
      invite.subjectType === "LIST"
        ? invite.subjectId
        : (
            await prisma.list.findFirst({
              where: { groupId: invite.subjectId },
              orderBy: { order: "asc" },
              select: { id: true },
            })
          )?.id ?? null;

    refreshAll();
    return { subjectType: invite.subjectType, subjectId: invite.subjectId, listId };
  });
}
