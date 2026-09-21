import { prisma } from "@/lib/db";
import { normalizeRule, type RepeatRule } from "@/lib/repeat";
import { getListRole, ROLE_RANK, type Role } from "@/lib/permissions";
import type { ListSortBy } from "@/app/generated/prisma/enums";
import { requestToday } from "@/lib/prefs";

/** 목록 화면 한 번에 필요한 것 전부. 권한이 없으면 null 을 돌려준다. */

export type TaskItem = {
  id: string;
  seq: number;
  title: string;
  note: string | null;
  isImportant: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  /** "YYYY-MM-DD" — 날짜 전용 값이라 문자열로 넘겨 클라이언트 타임존 영향을 없앤다 */
  dueDate: string | null;
  /** 이 사용자가 오늘 나의 하루에 올려 둔 작업인지 */
  inMyDay: boolean;
  order: string;
  createdAt: string;
  listId: string;
  listName: string;
  /** 목록이 든 그룹 이름. 그룹 밖 목록이면 null. 공유받은 목록이면 소유자 쪽 그룹이다(사이드바와 같다). */
  groupName: string | null;
  stepCount: number;
  stepDoneCount: number;
  /** 담당자. 없거나 본인이면 목록 행에 표시하지 않는다. */
  assignee: TaskPerson | null;
  /** 반복 규칙. null 이면 반복하지 않는다. */
  repeat: RepeatRule | null;
  /** 붙은 파일 수. 목록 행에는 개수만 보여 준다. */
  attachmentCount: number;
  /** 미리 알림 시각(ISO). 없으면 null. */
  remindAt: string | null;
};

export type AttachmentItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploaderName: string | null;
  createdAt: string;
};

export type TaskPerson = { id: string; name: string; avatarColor: string };

/** DB 세 칸 → 규칙 하나. 화면은 규칙만 알면 된다. */
function toRule(t: { repeatUnit: string | null; repeatEvery: number; repeatDays: number[] }): RepeatRule | null {
  return normalizeRule(
    t.repeatUnit ? { unit: t.repeatUnit as RepeatRule["unit"], every: t.repeatEvery, days: t.repeatDays } : null,
  );
}

export type StepItem = { id: string; title: string; isCompleted: boolean; order: string };

export type TaskDetail = TaskItem & {
  steps: StepItem[];
  attachments: AttachmentItem[];
  /** 공유받은 목록이면 그 목록 주인의 이름. 내 목록이면 null. */
  listOwnerName: string | null;
};

export type ListView = {
  id: string;
  name: string;
  themeKey: string;
  groupName: string | null;
  sortBy: ListSortBy;
  showCompleted: boolean;
  showSeq: boolean;
  isInbox: boolean;
  shareCount: number;
  role: Role;
  canWrite: boolean;
  canManage: boolean;
  tasks: TaskItem[];
};

/** Date → "YYYY-MM-DD". @db.Date 값은 UTC 자정이므로 UTC 파트로 읽는다. */
export function toDateString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export async function getListView(userId: string, listId: string): Promise<ListView | null> {
  const role = await getListRole(userId, listId);
  if (!role) return null;

  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: {
      id: true, name: true, themeKey: true, groupId: true, sortBy: true,
      showCompleted: true, showSeq: true, isInbox: true,
      group: { select: { name: true } },
      tasks: {
        orderBy: { order: "asc" },
        select: {
          id: true, seq: true, title: true, note: true, isImportant: true, isCompleted: true,
          completedAt: true, dueDate: true, order: true, createdAt: true,
          assignee: { select: { id: true, name: true, avatarColor: true } },
          repeatUnit: true, repeatEvery: true, repeatDays: true, remindAt: true,
          _count: { select: { attachments: true } },
          steps: { select: { isCompleted: true } },
          myDayEntries: { where: { userId, date: await requestToday() }, select: { id: true } },
        },
      },
    },
  });
  if (!list) return null;

  const shareCount = await prisma.share.count({
    where: {
      OR: [
        { subjectType: "LIST", subjectId: listId },
        ...(list.groupId ? [{ subjectType: "GROUP" as const, subjectId: list.groupId }] : []),
      ],
    },
  });

  return {
    id: list.id,
    name: list.name,
    themeKey: list.themeKey,
    groupName: list.group?.name ?? null,
    sortBy: list.sortBy,
    showCompleted: list.showCompleted,
    showSeq: list.showSeq,
    isInbox: list.isInbox,
    shareCount,
    role,
    canWrite: ROLE_RANK[role] >= ROLE_RANK.EDITOR,
    canManage: ROLE_RANK[role] >= ROLE_RANK.ADMIN,
    tasks: list.tasks.map((t) => ({
      id: t.id,
      seq: t.seq,
      title: t.title,
      note: t.note,
      isImportant: t.isImportant,
      isCompleted: t.isCompleted,
      completedAt: t.completedAt?.toISOString() ?? null,
      dueDate: toDateString(t.dueDate),
      inMyDay: t.myDayEntries.length > 0,
      order: t.order,
      createdAt: t.createdAt.toISOString(),
      listId: list.id,
      listName: list.name,
      groupName: list.group?.name ?? null,
      stepCount: t.steps.length,
      stepDoneCount: t.steps.filter((s) => s.isCompleted).length,
      assignee: t.assignee,
      repeat: toRule(t),
      attachmentCount: t._count.attachments,
      remindAt: t.remindAt?.toISOString() ?? null,
    })),
  };
}

/** 상세 패널용. 권한이 없으면 null. */
export async function getTaskDetail(userId: string, taskId: string): Promise<TaskDetail | null> {
  const role = await getListRole(
    userId,
    (await prisma.task.findUnique({ where: { id: taskId }, select: { listId: true } }))?.listId ?? "",
  );
  if (!role) return null;

  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, seq: true, title: true, note: true, isImportant: true, isCompleted: true,
      completedAt: true, dueDate: true, order: true, createdAt: true, listId: true,
      list: {
        select: { name: true, ownerId: true, owner: { select: { name: true } }, group: { select: { name: true } } },
      },
      assignee: { select: { id: true, name: true, avatarColor: true } },
      repeatUnit: true, repeatEvery: true, repeatDays: true, remindAt: true,
      _count: { select: { attachments: true } },
      attachments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, name: true, size: true, mimeType: true, createdAt: true,
          uploader: { select: { name: true } },
        },
      },
      steps: { orderBy: { order: "asc" }, select: { id: true, title: true, isCompleted: true, order: true } },
      myDayEntries: { where: { userId, date: await requestToday() }, select: { id: true } },
    },
  });
  if (!t) return null;

  return {
    id: t.id,
    seq: t.seq,
    title: t.title,
    note: t.note,
    isImportant: t.isImportant,
    isCompleted: t.isCompleted,
    completedAt: t.completedAt?.toISOString() ?? null,
    dueDate: toDateString(t.dueDate),
    inMyDay: t.myDayEntries.length > 0,
    order: t.order,
    createdAt: t.createdAt.toISOString(),
    listId: t.listId,
    listName: t.list.name,
    groupName: t.list.group?.name ?? null,
    listOwnerName: t.list.ownerId === userId ? null : t.list.owner.name,
    stepCount: t.steps.length,
    stepDoneCount: t.steps.filter((s) => s.isCompleted).length,
    assignee: t.assignee,
    repeat: toRule(t),
    attachmentCount: t._count.attachments,
    remindAt: t.remindAt?.toISOString() ?? null,
    attachments: t.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      mimeType: a.mimeType,
      uploaderName: a.uploader?.name ?? null,
      createdAt: a.createdAt.toISOString(),
    })),
    steps: t.steps,
  };
}
