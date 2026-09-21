import { prisma } from "@/lib/db";
import { getAccessibleLists } from "@/lib/queries/tasks";
import { dateOnlyFromString, dateOnlyToString, dayRange } from "@/lib/date";
import { toDateString } from "@/lib/queries/list";
import { UNGROUPED_SCOPE_ID, type SourceTask } from "@/lib/report/aggregate";
import { getRequestPrefs } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";
import { getRequestTimeZone } from "@/lib/prefs";

/** 보고서 편집 화면이 저장해 두는 값 */
export type ReportScope = {
  /**
   * 전체 선택 여부.
   *
   * 예전에는 groupIds 가 비어 있으면 "전체"라고 봤는데, 그러면 "아무것도 고르지
   * 않음"을 적을 자리가 없어서 전체를 해제할 수가 없었다. 두 상태를 갈라 둔다.
   */
  allGroups: boolean;
  /** allGroups 가 false 일 때 집계할 그룹. 비어 있으면 아무것도 안 담는다. */
  groupIds: string[];
  excludedTaskIds: string[];
  comments: Record<string, string>;
  /** 사람이 직접 옮긴 구간. 자동 분류가 틀렸을 때 그 보고서에서만 바로잡는다. */
  sections: Record<string, "inProgress" | "upcoming">;
};

/**
 * "접근 가능한 전부". 편집 화면은 후보를 다 받아 두고 범위 필터를 화면에서 건다.
 *
 * 예전에는 groupIds: [] 가 그 뜻이었는데 allGroups 가 생기면서 그 자리를 넘겼다.
 * 이 이름을 쓰면 다시 헷갈릴 일이 없다 — 실제로 한 번 헷갈려서, 그룹 하나만
 * 체크를 풀어도 보고서 본문이 통째로 비었다.
 */
export const ALL_GROUPS_SCOPE: Pick<ReportScope, "allGroups" | "groupIds"> = {
  allGroups: true,
  groupIds: [],
};

export const EMPTY_SCOPE: ReportScope = {
  allGroups: true,
  groupIds: [],
  excludedTaskIds: [],
  comments: {},
  sections: {},
};

export function parseScope(raw: unknown): ReportScope {
  const v = (raw ?? {}) as Partial<ReportScope>;
  const groupIds = Array.isArray(v.groupIds) ? v.groupIds.filter((x) => typeof x === "string") : [];
  return {
    // 예전에 저장된 값에는 이 칸이 없다. 그때 규칙(빈 배열 = 전체)으로 읽어 준다.
    allGroups: typeof v.allGroups === "boolean" ? v.allGroups : groupIds.length === 0,
    groupIds,
    excludedTaskIds: Array.isArray(v.excludedTaskIds)
      ? v.excludedTaskIds.filter((x) => typeof x === "string")
      : [],
    comments:
      v.comments && typeof v.comments === "object"
        ? Object.fromEntries(
            Object.entries(v.comments).filter(([, val]) => typeof val === "string"),
          )
        : {},
    sections:
      v.sections && typeof v.sections === "object"
        ? Object.fromEntries(
            Object.entries(v.sections).filter(
              ([, val]) => val === "inProgress" || val === "upcoming",
            ),
          )
        : {},
  };
}

export type GroupOption = { id: string; name: string };

/** 보고서에 이름을 적을 사람. 작성자 본인이면 적지 않는다 — 머리글에 이미 있다. */
function responsible(person: { id: string; name: string } | null, authorId: string): string | null {
  return !person || person.id === authorId ? null : person.name;
}

/**
 * 보고서 후보 작업.
 * 한 주에 걸친 작업만 읽으면 되지만 "이번 주에 고친 미완료" 조건 때문에
 * 완료·기한·수정 시각 중 하나라도 걸리는 것을 모두 가져와 분류는 순수 함수에 맡긴다.
 */
export async function getReportSource(
  userId: string,
  weekStart: Date,
  scope: ReportScope,
): Promise<{ tasks: SourceTask[]; groups: GroupOption[] }> {
  const lists = await getAccessibleLists(userId);
  const listIds = lists.map((l) => l.id);
  if (listIds.length === 0) return { tasks: [], groups: [] };

  const thisWeek = dayRange(weekStart, 7, await getRequestTimeZone());
  const weekStartStr = dateOnlyToString(weekStart);

  const rows = await prisma.task.findMany({
    where: {
      listId: { in: listIds },
      OR: [
        { completedAt: { gte: thisWeek.from, lt: thisWeek.to } },
        // 기한이 이번 주 이후인 것은 위쪽 끝을 두지 않는다 — '예정' 이 다음 주만
        // 담던 시절의 흔적이었고, 그 너머 기한은 후보에도 오르지 못했다.
        { dueDate: { gte: dateOnlyFromString(weekStartStr) } },
        { createdAt: { gte: thisWeek.from, lt: thisWeek.to } },
        { updatedAt: { gte: thisWeek.from, lt: thisWeek.to } },
      ],
    },
    select: {
      id: true, seq: true, title: true, listId: true, isCompleted: true,
      completedAt: true, createdAt: true, updatedAt: true, dueDate: true,
      // 공유받은 목록의 작업은 "누구 목록의, 누가 만든 것"인지 보고서에 남아야 한다.
      // 그게 없으면 남의 일과 내 일이 같은 줄로 보인다.
      creator: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      list: {
        select: {
          name: true, groupId: true,
          owner: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
        },
      },
      steps: { orderBy: { order: "asc" }, select: { title: true, isCompleted: true } },
      // 착수 흔적. 나의 하루는 사람마다 다르므로 보고서 작성자 것만 본다.
      myDayEntries: { where: { userId }, select: { id: true }, take: 1 },
    },
  });

  const groupMap = new Map<string, string>();
  let hasUngrouped = false;
  for (const r of rows) {
    if (r.list.group) groupMap.set(r.list.group.id, r.list.group.name);
    else hasUngrouped = true;
  }

  // 그룹 없는 목록도 고를 수 있어야 한다. 예전에는 그룹 필터를 켜는 순간
  // 그룹에 속하지 않은 목록(= 목록만 공유받은 것들)이 통째로 사라졌다.
  const inScope = (groupId: string | null) =>
    scope.allGroups ||
    (groupId == null
      ? scope.groupIds.includes(UNGROUPED_SCOPE_ID)
      : scope.groupIds.includes(groupId));

  const tasks: SourceTask[] = rows
    .filter((r) => inScope(r.list.groupId))
    .map((r) => ({
      id: r.id,
      seq: r.seq,
      title: r.title,
      listId: r.listId,
      listName: r.list.name,
      groupName: r.list.group?.name ?? null,
      groupId: r.list.groupId,
      isCompleted: r.isCompleted,
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      dueDate: toDateString(r.dueDate),
      steps: r.steps,
      hasStepProgress: r.steps.some((s) => s.isCompleted),
      inMyDay: r.myDayEntries.length > 0,
      // 본인이면 null. 자기 이름은 보고서 머리글에 이미 있다.
      // 담당자가 지정돼 있으면 그 사람, 없으면 만든 사람. 만든 사람이 탈퇴하면
      // creator 가 null 이 된다(onDelete: SetNull) — 그때는 표시하지 않는다.
      ownerName: r.list.owner.id === userId ? null : r.list.owner.name,
      assigneeName: responsible(r.assignee ?? r.creator, userId),
    }));

  const groups = [...groupMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  if (hasUngrouped) {
    const t = translatorFor((await getRequestPrefs()).locale);
    groups.push({ id: UNGROUPED_SCOPE_ID, name: t("reports.ungrouped") });
  }

  return { tasks, groups };
}

export type ReportListItem = {
  id: string;
  weekStart: string;
  title: string;
  publishedAt: string | null;
  sendCount: number;
  sharedWithCount: number;
};

export async function listReports(userId: string): Promise<ReportListItem[]> {
  const rows = await prisma.weeklyReport.findMany({
    where: { authorId: userId },
    orderBy: { weekStart: "desc" },
    select: {
      id: true, weekStart: true, title: true, publishedAt: true,
      _count: { select: { sends: true } },
    },
  });

  const shares = await prisma.share.groupBy({
    by: ["subjectId"],
    where: { subjectType: "REPORT", subjectId: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
  });
  const shareCount = new Map(shares.map((s) => [s.subjectId, s._count._all]));

  return rows.map((r) => ({
    id: r.id,
    weekStart: dateOnlyToString(r.weekStart),
    title: r.title,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    sendCount: r._count.sends,
    sharedWithCount: shareCount.get(r.id) ?? 0,
  }));
}

export type SharedReportItem = {
  id: string;
  weekStart: string;
  title: string;
  publishedAt: string;
  authorName: string;
};

/**
 * 나에게 공유된 보고서.
 * 발행된 것만 보인다 — 초안은 작성 중이라 남에게 보일 이유가 없다.
 */
export async function listSharedReports(userId: string): Promise<SharedReportItem[]> {
  const shares = await prisma.share.findMany({
    where: { subjectType: "REPORT", granteeUserId: userId },
    select: { subjectId: true },
  });
  if (shares.length === 0) return [];

  const rows = await prisma.weeklyReport.findMany({
    where: { id: { in: shares.map((s) => s.subjectId) }, publishedAt: { not: null } },
    orderBy: { weekStart: "desc" },
    select: {
      id: true, weekStart: true, title: true, publishedAt: true,
      author: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    weekStart: dateOnlyToString(r.weekStart),
    title: r.title,
    publishedAt: r.publishedAt!.toISOString(),
    authorName: r.author.name,
  }));
}

export type ReadableReport = {
  id: string;
  title: string;
  authorName: string;
  publishedAt: string;
  content: unknown;
};

/** 공유받은 보고서 열람. 작성자 본인이면 편집 화면으로 가므로 여기 오지 않는다. */
export async function getSharedReport(userId: string, id: string): Promise<ReadableReport | null> {
  const share = await prisma.share.findUnique({
    where: {
      subjectType_subjectId_granteeUserId: {
        subjectType: "REPORT",
        subjectId: id,
        granteeUserId: userId,
      },
    },
    select: { id: true },
  });
  if (!share) return null;

  const r = await prisma.weeklyReport.findUnique({
    where: { id },
    select: {
      id: true, title: true, publishedAt: true, contentJson: true,
      author: { select: { name: true } },
    },
  });
  // 발행 취소된 보고서는 공유가 남아 있어도 열리지 않는다.
  if (!r || !r.publishedAt || !r.contentJson) return null;

  return {
    id: r.id,
    title: r.title,
    authorName: r.author.name,
    publishedAt: r.publishedAt.toISOString(),
    content: r.contentJson,
  };
}
