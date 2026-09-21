"use server";

import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { assertCan, PermissionError } from "@/lib/permissions";
import { removeFile } from "@/lib/files/storage";
import { MAX_PINS, type MessageItem } from "@/lib/queries/project";
import {
  assertCanDelete,
  createMessage,
  requireOpen,
  softDeleteMessage,
  updateMessageBody,
} from "@/lib/projects/messages";
import { ActionError, run, type ActionResult } from "@/lib/actions/_helpers";

/**
 * 메시지에 관한 동작. 레이아웃을 다시 그리지 않는다 — 화면이 폴링으로 받아 간다.
 * 다시 그리면 입력창과 폴러가 리마운트되어 쓰던 글이 날아간다.
 */

export async function postMessage(
  projectId: string,
  body: string,
  parentId?: string | null,
): Promise<ActionResult<MessageItem>> {
  return run(async () => {
    const userId = await requireUserId();
    return createMessage(userId, { projectId, body, parentId: parentId ?? null });
  });
}

/** 수정은 작성자만. 관리자도 남의 글은 못 고친다(지울 수만 있다). */
export async function editMessage(messageId: string, body: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await updateMessageBody(userId, messageId, body);
  });
}

/** 삭제는 작성자 또는 프로젝트 관리자. */
export async function deleteMessage(messageId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCanDelete(userId, messageId);
    const keys = await softDeleteMessage(messageId);
    for (const k of keys) await removeFile(k);
  });
}

/** 고정은 멤버 누구나, 원글만, 프로젝트당 MAX_PINS 개까지. */
export async function pinMessage(messageId: string, pinned: boolean): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const m = await prisma.message.findUnique({
      where: { id: messageId },
      select: { projectId: true, parentId: true, deletedAt: true, pinnedAt: true },
    });
    if (!m || m.deletedAt) throw new PermissionError();
    await assertCan(userId, "write", { kind: "project", id: m.projectId });
    await requireOpen(m.projectId);
    if (m.parentId) throw ActionError.key("projects.errors.pinReply");

    if (pinned && !m.pinnedAt) {
      const n = await prisma.message.count({ where: { projectId: m.projectId, pinnedAt: { not: null }, deletedAt: null } });
      if (n >= MAX_PINS) throw ActionError.key("projects.errors.pinLimit", { max: MAX_PINS });
    }
    await prisma.message.update({
      where: { id: messageId },
      data: pinned ? { pinnedAt: new Date(), pinnedById: userId } : { pinnedAt: null, pinnedById: null },
    });
  });
}
