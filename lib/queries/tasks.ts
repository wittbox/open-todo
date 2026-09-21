import { prisma } from "@/lib/db";
import { normalizeRule, type RepeatUnit } from "@/lib/repeat";
import { ROLE_RANK, maxRole, type Role } from "@/lib/permissions";
import { dateOnlyToString, todayDateOnly } from "@/lib/date";
import { sortTasks } from "@/lib/task-sort";
import { getTheme } from "@/lib/theme";
import type { CalendarList } from "@/lib/calendar";
import { listPath } from "@/lib/list-path";
import { toDateString, type TaskItem } from "@/lib/queries/list";
import { requestToday } from "@/lib/prefs";

/**
 * 스마트 뷰와 검색. 어느 쪽이든 "내가 접근할 수 있는 목록"이 출발점이라
 * 그 계산을 한 곳에 모아 둔다.
 */

export type AccessibleList = { id: string; name: string; role: Role };

export async function getAccessibleLists(userId: string): Promise<AccessibleList[]> {
  const shares = await prisma.share.findMany({
    where: { granteeUserId: userId },
    select: { subjectType: true, subjectId: true, role: true },
  });
  const groupRole = new Map<string, Role>();
  const listRole = new Map<string, Role>();
  for (const s of shares) {
    (s.subjectType === "GROUP" ? groupRole : listRole).set(s.subjectId, s.role);
  }

  const lists = await prisma.list.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { id: { in: [...listRole.keys()] } },
        { groupId: { in: [...groupRole.keys()] } },
      ],
    },
    select: { id: true, name: true, ownerId: true, groupId: true },
  });

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    role:
      l.ownerId === userId
        ? ("ADMIN" as Role)
        : (maxRole(l.groupId ? groupRole.get(l.groupId) : null, listRole.get(l.id)) ?? "VIEWER"),
  }));
}

const TASK_SELECT = {
  id: true, seq: true, title: true, note: true, isImportant: true, isCompleted: true,
  completedAt: true, dueDate: true, order: true, createdAt: true, listId: true,
  list: { select: { name: true, group: { select: { name: true } } } },
  assignee: { select: { id: true, name: true, avatarColor: true } },
  repeatUnit: true, repeatEvery: true, repeatDays: true, remindAt: true,
  _count: { select: { attachments: true } },
  steps: { select: { isCompleted: true } },
} as const;

type RawTask = {
  id: string; seq: number; title: string; note: string | null;
  isImportant: boolean; isCompleted: boolean; completedAt: Date | null;
  dueDate: Date | null; order: string; createdAt: Date; listId: string;
  list: { name: string; group: { name: string } | null };
  assignee: { id: string; name: string; avatarColor: string } | null;
  repeatUnit: string | null;
  repeatEvery: number;
  repeatDays: number[];
  remindAt: Date | null;
  _count: { attachments: number };
  steps: { isCompleted: boolean }[];
};

function toTaskItem(t: RawTask, inMyDay: boolean): TaskItem {
  return {
    id: t.id,
    seq: t.seq,
    title: t.title,
    note: t.note,
    isImportant: t.isImportant,
    isCompleted: t.isCompleted,
    completedAt: t.completedAt?.toISOString() ?? null,
    dueDate: toDateString(t.dueDate),
    inMyDay,
    order: t.order,
    createdAt: t.createdAt.toISOString(),
    listId: t.listId,
    listName: t.list.name,
    groupName: t.list.group?.name ?? null,
    stepCount: t.steps.length,
    stepDoneCount: t.steps.filter((s) => s.isCompleted).length,
    assignee: t.assignee,
    attachmentCount: t._count.attachments,
    remindAt: t.remindAt?.toISOString() ?? null,
    repeat: normalizeRule(
      t.repeatUnit ? { unit: t.repeatUnit as RepeatUnit, every: t.repeatEvery, days: t.repeatDays } : null,
    ),
  };
}

async function myDayTaskIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.myDayEntry.findMany({
    where: { userId, date: await requestToday() },
    select: { taskId: true },
  });
  return new Set(rows.map((r) => r.taskId));
}

export type SmartViewData = {
  /** 편집 가능한 목록이 하나라도 있어야 작업을 추가할 수 있다 */
  writableListIds: Set<string>;
  roleByList: Map<string, Role>;
  open: TaskItem[];
  done: TaskItem[];
};

async function loadSmart(
  userId: string,
  where: (listIds: string[]) => Record<string, unknown>,
): Promise<SmartViewData> {
  const lists = await getAccessibleLists(userId);
  const listIds = lists.map((l) => l.id);
  const roleByList = new Map(lists.map((l) => [l.id, l.role]));

  const [tasks, myDay] = await Promise.all([
    prisma.task.findMany({ where: where(listIds), select: TASK_SELECT, orderBy: { order: "asc" } }),
    myDayTaskIds(userId),
  ]);

  const items = tasks.map((t) => toTaskItem(t, myDay.has(t.id)));
  return {
    writableListIds: new Set(lists.filter((l) => ROLE_RANK[l.role] >= ROLE_RANK.EDITOR).map((l) => l.id)),
    roleByList,
    open: sortTasks(items.filter((t) => !t.isCompleted), "MANUAL"),
    done: items.filter((t) => t.isCompleted),
  };
}

/** 나에게 할당됨 — 남이 나를 담당자로 지정한 작업. 내가 나에게 지정한 것도 포함한다. */
export async function getAssignedView(userId: string): Promise<SmartViewData> {
  return loadSmart(userId, (listIds) => ({ listId: { in: listIds }, assigneeId: userId }));
}

/** 달력 위 '지난 기한' 줄에 싣는 최대 수. 넘으면 overdueMore 로 알린다. */
export const OVERDUE_LIMIT = 300;

/**
 * 달력 — 보이는 칸 [from, end) 안에 기한이 있는 작업. 완료한 것도 함께 읽는다.
 *
 * 기한이 칸보다 앞인 미완료 반복 작업도 읽는다. 그 작업의 다음 회차가 칸 안에 올 수
 * 있어서다(lib/calendar.ts projectRepeats). 이런 작업은 칸에 직접 놓지 않고 따로 준다.
 *
 * `overdue` 는 보는 달과 상관없이 기한이 오늘 전인 미완료 작업 전부(오래된 순)다.
 * 한 달씩만 그리는 달력은 이전 달에 밀린 작업을 보여 주지 못한다 — 2026-09-16 에
 * '계획된 일정' 을 없애면서 그 '이전' 칸을 여기로 옮겼다.
 */
export async function getCalendarView(
  userId: string,
  from: Date,
  end: Date,
  today: Date = todayDateOnly(),
): Promise<{
  tasks: TaskItem[];
  repeatSources: TaskItem[];
  overdue: TaskItem[];
  overdueMore: boolean;
  lists: CalendarList[];
}> {
  const lists = await getAccessibleLists(userId);
  const listIds = lists.map((l) => l.id);

  const [rows, overdueRows, myDay, meta] = await Promise.all([
    prisma.task.findMany({
      where: {
        listId: { in: listIds },
        OR: [
          { dueDate: { gte: from, lt: end } },
          { isCompleted: false, repeatUnit: { not: null }, dueDate: { lt: from } },
        ],
      },
      select: TASK_SELECT,
      orderBy: { order: "asc" },
    }),
    prisma.task.findMany({
      where: { listId: { in: listIds }, isCompleted: false, dueDate: { lt: today } },
      select: TASK_SELECT,
      orderBy: [{ dueDate: "asc" }, { seq: "asc" }],
      take: OVERDUE_LIMIT + 1,
    }),
    myDayTaskIds(userId),
    prisma.list.findMany({
      where: { id: { in: listIds } },
      select: { id: true, themeKey: true, isInbox: true, ownerId: true, group: { select: { name: true } } },
    }),
  ]);

  const metaById = new Map(meta.map((m) => [m.id, m]));
  const items = rows.map((t) => toTaskItem(t, myDay.has(t.id)));
  const fromKey = dateOnlyToString(from);

  return {
    tasks: items.filter((t) => t.dueDate != null && t.dueDate >= fromKey),
    repeatSources: items.filter((t) => t.dueDate != null && t.dueDate < fromKey),
    overdue: overdueRows.slice(0, OVERDUE_LIMIT).map((t) => toTaskItem(t, myDay.has(t.id))),
    overdueMore: overdueRows.length > OVERDUE_LIMIT,
    lists: lists
      .map((l) => {
        const m = metaById.get(l.id);
        return {
          id: l.id,
          name: l.name,
          groupName: m?.group?.name ?? null,
          color: getTheme(m?.themeKey).accent,
          // 남의 받은편지함이 공유돼 보이더라도 그건 내 '작업' 이 아니다.
          isInbox: Boolean(m?.isInbox && m.ownerId === userId),
          writable: ROLE_RANK[l.role] >= ROLE_RANK.EDITOR,
        };
      })
      .sort(
        (a, b) =>
          Number(b.isInbox) - Number(a.isInbox) ||
          listPath(a.groupName, a.name).localeCompare(listPath(b.groupName, b.name), "ko"),
      ),
  };
}

/* ── 검색 ──────────────────────────────────────────────────────── */

export type SearchHit = {
  id: string;
  seq: number;
  title: string;
  listId: string;
  listName: string;
  isCompleted: boolean;
};

export type SearchResult = {
  /** "#1042" 처럼 번호를 입력했을 때 바로 이동할 대상 */
  jump: SearchHit | null;
  hits: SearchHit[];
};

export async function searchTasks(userId: string, raw: string): Promise<SearchResult> {
  const q = raw.trim();
  if (q.length === 0) return { jump: null, hits: [] };

  const lists = await getAccessibleLists(userId);
  const listIds = lists.map((l) => l.id);
  if (listIds.length === 0) return { jump: null, hits: [] };

  // "1042", "#1042", 딥링크 URL 전체 모두 번호로 인식한다.
  const seqMatch = q.match(/^#?(\d{1,9})$/) ?? q.match(/\/t\/(\d{1,9})\/?$/);
  const seq = seqMatch ? Number(seqMatch[1]) : null;

  const [jumpRow, rows] = await Promise.all([
    seq == null
      ? Promise.resolve(null)
      : prisma.task.findFirst({
          where: { seq, listId: { in: listIds } },
          select: { id: true, seq: true, title: true, listId: true, isCompleted: true, list: { select: { name: true } } },
        }),
    prisma.task.findMany({
      where: {
        listId: { in: listIds },
        OR: [{ title: { contains: q, mode: "insensitive" } }, { note: { contains: q, mode: "insensitive" } }],
      },
      select: { id: true, seq: true, title: true, listId: true, isCompleted: true, list: { select: { name: true } } },
      orderBy: [{ isCompleted: "asc" }, { updatedAt: "desc" }],
      take: 20,
    }),
  ]);

  const toHit = (r: NonNullable<typeof jumpRow>): SearchHit => ({
    id: r.id,
    seq: r.seq,
    title: r.title,
    listId: r.listId,
    listName: r.list.name,
    isCompleted: r.isCompleted,
  });

  return {
    jump: jumpRow ? toHit(jumpRow) : null,
    hits: rows.filter((r) => r.id !== jumpRow?.id).map(toHit),
  };
}
