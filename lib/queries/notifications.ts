import { prisma } from "@/lib/db";
import type { NotificationKind } from "@/app/generated/prisma/enums";

/**
 * 알림 목록.
 *
 * 문구는 화면이 만든다(kind + 대상). 여기서는 그리는 데 필요한 값만 모은다.
 * 메시지 본문은 싣지 않는다 — 고치거나 지운 뒤에 어긋난다.
 */

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  taskId: string | null;
  taskTitle: string | null;
  taskSeq: number | null;
  listId: string | null;
  listName: string | null;
  /** 보고서에 관한 알림(예약 발송 실패)만 채워진다 */
  reportId: string | null;
  reportTitle: string | null;
  /** 프로젝트에 관한 알림(멘션·초대)만 채워진다 */
  projectId: string | null;
  projectName: string | null;
  messageId: string | null;
  actorName: string | null;
  isRead: boolean;
  createdAt: string;
};

/** 30일 지난 알림은 보여 주지 않는다. 청소는 매일 도는 작업이 맡는다. */
const KEEP_DAYS = 30;

export async function listNotifications(userId: string): Promise<NotificationItem[]> {
  const since = new Date(Date.now() - KEEP_DAYS * 86_400_000);

  const rows = await prisma.notification.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, kind: true, taskId: true, listId: true, reportId: true, projectId: true, messageId: true,
      readAt: true, createdAt: true,
      task: { select: { title: true, seq: true } },
      report: { select: { title: true } },
      project: { select: { name: true } },
      actor: { select: { name: true } },
    },
  });

  const listIds = [...new Set(rows.map((r) => r.listId).filter((v): v is string => v != null))];
  const lists = await prisma.list.findMany({
    where: { id: { in: listIds } },
    select: { id: true, name: true },
  });
  const listName = new Map(lists.map((l) => [l.id, l.name]));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    taskId: r.taskId,
    taskTitle: r.task?.title ?? null,
    taskSeq: r.task?.seq ?? null,
    listId: r.listId,
    listName: r.listId ? (listName.get(r.listId) ?? null) : null,
    reportId: r.reportId,
    reportTitle: r.report?.title ?? null,
    projectId: r.projectId,
    projectName: r.project?.name ?? null,
    messageId: r.messageId,
    actorName: r.actor?.name ?? null,
    isRead: r.readAt != null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
