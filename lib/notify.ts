import { prisma } from "@/lib/db";
import { dateOnlyToString, todayDateOnly } from "@/lib/date";
import { getListRole, getProjectRole } from "@/lib/permissions";
import type { NotificationKind } from "@/app/generated/prisma/enums";
import { getUserPrefs } from "@/lib/prefs";

/**
 * 알림 만들기.
 *
 * 문구는 여기서 만들지 않는다. 무슨 일이 있었는지(kind)와 그 대상만 남기고
 * 화면이 말을 만든다 — 문구를 저장해 두면 나중에 말을 고칠 때 옛 알림만
 * 옛말로 남는다.
 *
 * 같은 일로 두 번 알리지 않도록 (받는 사람, 종류, 작업, 보고서, 메시지, 날짜) 가 유일하다.
 * 멘션은 메시지마다 한 번이다 — 부른 쪽이 dayKey 에 메시지 작성일을 넣으니 날짜가 아니라 메시지가 열쇠가 된다.
 */

export type NotifyInput = {
  userId: string;
  kind: NotificationKind;
  taskId?: string | null;
  listId?: string | null;
  /** 보고서에 관한 알림(예약 발송 실패)만 채운다 */
  reportId?: string | null;
  /** 프로젝트에 관한 알림(멘션·초대)만 채운다 */
  projectId?: string | null;
  messageId?: string | null;
  actorId?: string | null;
  /** 하루에 한 번만 알릴 때 쓰는 날짜 열쇠. 기본은 오늘. */
  dayKey?: string;
};

export async function notify(input: NotifyInput): Promise<void> {
  // 자기가 한 일을 자기에게 알리지 않는다.
  if (input.actorId && input.actorId === input.userId) return;

  const dayKey = input.dayKey ?? dateOnlyToString(todayDateOnly(new Date(), (await getUserPrefs(input.userId)).timeZone));

  // 볼 수 없는 것은 알리지 않는다. 공유가 끊긴 뒤에도 알림만 남으면
  // 열리지 않는 줄이 목록에 쌓인다.
  const listId = input.listId ?? (await listOf(input.taskId));
  if (listId && !(await getListRole(input.userId, listId))) return;
  if (input.projectId && !(await getProjectRole(input.userId, input.projectId))) return;

  // 이미 있으면 그대로 둔다 — 읽음 표시를 되돌리지 않는다.
  const existing = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      kind: input.kind,
      taskId: input.taskId ?? null,
      reportId: input.reportId ?? null,
      projectId: input.projectId ?? null,
      messageId: input.messageId ?? null,
      dayKey,
    },
    select: { id: true },
  });
  if (existing) return;

  await prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      taskId: input.taskId ?? null,
      listId,
      reportId: input.reportId ?? null,
      projectId: input.projectId ?? null,
      messageId: input.messageId ?? null,
      actorId: input.actorId ?? null,
      dayKey,
    },
  });
}

/** 프로젝트에서 나간(내보내진) 사람의 그 프로젝트 알림을 걷어낸다. */
export async function dropNotificationsForProject(userId: string, projectId: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { userId, projectId } });
}

async function listOf(taskId?: string | null): Promise<string | null> {
  if (!taskId) return null;
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { listId: true } });
  return t?.listId ?? null;
}

/**
 * 이 작업을 책임지는 사람. 알림은 그 한 사람에게만 간다.
 *
 * 목록을 볼 수 있는 모두에게 보내면, 공유 목록 하나로 온 팀이 같은 알림을
 * 받는다. 담당자가 있으면 담당자, 없으면 만든 사람이다.
 */
export async function ownerOfTask(taskId: string): Promise<string | null> {
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assigneeId: true, creatorId: true },
  });
  return t?.assigneeId ?? t?.creatorId ?? null;
}

/** 공유가 끊긴 목록에서 온 알림을 걷어낸다. */
export async function dropNotificationsForList(userId: string, listId: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { userId, listId } });
}
