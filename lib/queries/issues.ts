import { prisma } from "@/lib/db";
import { getProjectRole, ROLE_RANK } from "@/lib/permissions";
import { dateOnlyToString } from "@/lib/date";
import { tokenIds } from "@/lib/mentions";
import { issueRef, parseIssueRef } from "@/lib/issues/format";
import type { IssueEventKind, IssuePriority, IssueStatus } from "@/app/generated/prisma/enums";
import type { AttachmentItem } from "@/lib/queries/list";
import type { SearchResult } from "@/lib/queries/tasks";

/**
 * 이슈 조회. 멤버가 아니면 null — 없는 프로젝트·이슈와 구분하지 않는다.
 * 목록은 프로젝트의 이슈를 통째로 내려 주고 화면이 거르고 정렬한다(lib/issues/format.ts 의 filterIssues).
 * 프로젝트 하나의 이슈가 수천 건이 되기 전에는 이쪽이 빠르고 단순하다.
 */

export type IssuePerson = { id: string; name: string; avatarColor: string };
export type IssueLabelItem = { id: string; name: string; color: string };

export type IssueItem = {
  id: string;
  number: number;
  ref: string;
  title: string;
  body: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  assignee: IssuePerson | null;
  reporter: IssuePerson | null;
  labelIds: string[];
  dueDate: string | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IssueEventItem = {
  id: string;
  kind: IssueEventKind;
  actor: IssuePerson | null;
  body: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  isMine: boolean;
  attachments: AttachmentItem[];
};

export type IssueDetail = IssueItem & {
  attachments: AttachmentItem[];
  events: IssueEventItem[];
  /** 본문·댓글의 <@id> 와 담당자 바뀐 기록에 나오는 사람 이름 */
  people: { userId: string; name: string }[];
  watcherCount: number;
  isWatching: boolean;
  /** 올린 사람이나 관리자 */
  canDelete: boolean;
  /** 메시지에서 만든 이슈면 그 메시지(지워졌으면 null) — 이슈 페이지의 "메시지에서" 링크 */
  sourceMessageId: string | null;
};

export type IssueSettings = {
  enabled: boolean;
  key: string | null;
  template: string;
  /** 이슈가 생긴 뒤에는 약어를 못 바꾼다 */
  keyLocked: boolean;
  labels: IssueLabelItem[];
};

const PERSON = { select: { id: true, name: true, avatarColor: true } } as const;
const ATTACHMENT = {
  orderBy: { createdAt: "asc" as const },
  select: { id: true, name: true, size: true, mimeType: true, createdAt: true, uploader: { select: { name: true } } },
};

type RawAttachment = { id: string; name: string; size: number; mimeType: string; createdAt: Date; uploader: { name: string } | null };
const toAttachment = (a: RawAttachment): AttachmentItem => ({
  id: a.id, name: a.name, size: a.size, mimeType: a.mimeType, uploaderName: a.uploader?.name ?? null, createdAt: a.createdAt.toISOString(),
});

export async function getIssueSettings(projectId: string): Promise<IssueSettings> {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      issuesEnabled: true, issueKey: true, issueTemplate: true, issueSeq: true,
      issueLabels: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, color: true } },
    },
  });
  return {
    enabled: p.issuesEnabled, key: p.issueKey, template: p.issueTemplate, keyLocked: p.issueSeq > 0 && p.issueKey != null,
    labels: p.issueLabels,
  };
}

export async function listIssues(userId: string, projectId: string): Promise<IssueItem[] | null> {
  if (!(await getProjectRole(userId, projectId))) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { issueKey: true } });
  const rows = await prisma.issue.findMany({
    where: { projectId },
    select: {
      id: true, number: true, title: true, body: true, status: true, priority: true, assigneeId: true, dueDate: true,
      createdAt: true, updatedAt: true,
      assignee: PERSON, reporter: PERSON,
      labels: { select: { labelId: true } },
      _count: { select: { events: { where: { kind: "COMMENT", deletedAt: null } } } },
    },
    orderBy: { number: "desc" },
  });
  return rows.map((r) => ({
    id: r.id, number: r.number, ref: issueRef(project?.issueKey ?? null, r.number),
    title: r.title, body: r.body, status: r.status, priority: r.priority,
    assigneeId: r.assigneeId, assignee: r.assignee, reporter: r.reporter,
    labelIds: r.labels.map((l) => l.labelId),
    dueDate: r.dueDate ? dateOnlyToString(r.dueDate) : null,
    commentCount: r._count.events,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }));
}

/** 번호로 이슈 하나. 다른 프로젝트의 번호면 null. */
export async function getIssueDetail(userId: string, projectId: string, number: number): Promise<IssueDetail | null> {
  const role = await getProjectRole(userId, projectId);
  if (!role) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { issueKey: true } });
  const r = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number } },
    select: {
      id: true, number: true, title: true, body: true, status: true, priority: true, assigneeId: true, reporterId: true,
      dueDate: true, createdAt: true, updatedAt: true,
      assignee: PERSON, reporter: PERSON,
      labels: { select: { labelId: true } },
      attachments: ATTACHMENT,
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, kind: true, body: true, fromValue: true, toValue: true, createdAt: true, editedAt: true, deletedAt: true,
          actorId: true, actor: PERSON, attachments: ATTACHMENT,
        },
      },
      _count: { select: { watchers: true } },
      watchers: { where: { userId }, select: { userId: true } },
      sourceMessage: { select: { id: true, deletedAt: true } },
    },
  });
  if (!r) return null;

  // 이름이 필요한 사람: 본문·댓글의 멘션, 담당자 바뀐 기록의 앞뒤.
  const ids = new Set<string>(tokenIds(r.body));
  for (const e of r.events) {
    for (const id of tokenIds(e.body)) ids.add(id);
    if (e.kind === "ASSIGNEE") for (const v of [e.fromValue, e.toValue]) if (v) ids.add(v);
  }
  ids.delete("all");
  const people = ids.size
    ? (await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })).map((u) => ({ userId: u.id, name: u.name }))
    : [];

  const comments = r.events.filter((e) => e.kind === "COMMENT" && !e.deletedAt).length;
  return {
    id: r.id, number: r.number, ref: issueRef(project?.issueKey ?? null, r.number),
    title: r.title, body: r.body, status: r.status, priority: r.priority,
    assigneeId: r.assigneeId, assignee: r.assignee, reporter: r.reporter,
    labelIds: r.labels.map((l) => l.labelId),
    dueDate: r.dueDate ? dateOnlyToString(r.dueDate) : null,
    commentCount: comments,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    attachments: r.attachments.map(toAttachment),
    events: r.events.map((e) => ({
      id: e.id, kind: e.kind, actor: e.actor, body: e.deletedAt ? "" : e.body, fromValue: e.fromValue, toValue: e.toValue,
      createdAt: e.createdAt.toISOString(), editedAt: e.editedAt?.toISOString() ?? null, deleted: e.deletedAt != null,
      isMine: e.actorId === userId, attachments: e.attachments.map(toAttachment),
    })),
    people,
    watcherCount: r._count.watchers,
    isWatching: r.watchers.length > 0,
    canDelete: r.reporterId === userId || ROLE_RANK[role] >= ROLE_RANK.ADMIN,
    sourceMessageId: r.sourceMessage && !r.sourceMessage.deletedAt ? r.sourceMessage.id : null,
  };
}

/** "BUG-23" 이 가리키는 이슈의 프로젝트와 번호. 멤버가 아니면 null(존재를 알려 주지 않는다). */
export async function resolveIssueRef(userId: string, key: string, number: number): Promise<{ projectId: string; number: number } | null> {
  const p = await prisma.project.findUnique({ where: { issueKey: key }, select: { id: true } });
  if (!p || !(await getProjectRole(userId, p.id))) return null;
  const exists = await prisma.issue.findUnique({ where: { projectId_number: { projectId: p.id, number } }, select: { id: true } });
  return exists ? { projectId: p.id, number } : null;
}

/* ── 사이드바 검색 ── */

export type IssueSearchHit = {
  id: string;
  ref: string;
  title: string;
  status: IssueStatus;
  projectName: string;
  href: string;
  /** 제목·본문이 아니라 댓글에서만 찾았다 — 왜 걸렸는지 보이게 */
  inComment: boolean;
};

/** 사이드바 검색이 받는 모양 — 작업(접근 권한이 있는 목록)과 이슈(멤버인 프로젝트)를 함께(/api/search). */
export type SidebarSearchResult = SearchResult & { issueJump: IssueSearchHit | null; issues: IssueSearchHit[] };

const SEARCH_STATUS_RANK: Record<IssueStatus, number> = { IN_PROGRESS: 0, OPEN: 1, RESOLVED: 2, CLOSED: 3 };

/**
 * 사이드바 검색의 이슈 쪽. 내가 멤버이고 이슈를 켠 프로젝트에서 제목·본문·댓글(지운 것 빼고)을 찾는다.
 * "BUG-23"(소문자도)이면 그 이슈를 `jump` 로 — 결과 맨 위 "바로 이동". 번호만("23")은 작업 번호라 여기서는 보지 않는다.
 * 정렬은 진행 중 → 열림 → 해결됨 → 닫힘, 같은 상태끼리는 최근 갱신 순. 닫힌 것은 화면이 흐리게 그린다.
 */
export async function searchIssues(userId: string, raw: string): Promise<{ jump: IssueSearchHit | null; hits: IssueSearchHit[] }> {
  const q = raw.trim();
  if (!q) return { jump: null, hits: [] };
  const inProjects = { issuesEnabled: true, members: { some: { userId } } };
  const ref = parseIssueRef(q);
  const select = {
    id: true, number: true, title: true, body: true, status: true, updatedAt: true,
    project: { select: { id: true, name: true, issueKey: true } },
  } as const;

  const [jumpRow, rows] = await Promise.all([
    ref
      ? prisma.issue.findFirst({ where: { number: ref.number, project: { ...inProjects, issueKey: ref.key } }, select })
      : Promise.resolve(null),
    prisma.issue.findMany({
      where: {
        project: inProjects,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
          { events: { some: { kind: "COMMENT", deletedAt: null, body: { contains: q, mode: "insensitive" } } } },
        ],
      },
      select,
      orderBy: { updatedAt: "desc" },
      // 상태로 다시 줄 세운 뒤 자른다 — 오래된 열린 이슈가 최근 닫힌 것에 밀려 빠지지 않게 넉넉히.
      take: 60,
    }),
  ]);

  const needle = q.toLowerCase();
  const toHit = (r: NonNullable<typeof jumpRow>): IssueSearchHit => ({
    id: r.id,
    ref: issueRef(r.project.issueKey, r.number),
    title: r.title,
    status: r.status,
    projectName: r.project.name,
    href: `/projects/${r.project.id}?tab=issues&issue=${r.number}`,
    inComment: !r.title.toLowerCase().includes(needle) && !r.body.toLowerCase().includes(needle),
  });
  const hits = rows
    .filter((r) => r.id !== jumpRow?.id)
    .sort((a, b) => SEARCH_STATUS_RANK[a.status] - SEARCH_STATUS_RANK[b.status])
    .slice(0, 20)
    .map(toHit);
  return { jump: jumpRow ? { ...toHit(jumpRow), inComment: false } : null, hits };
}

/* ── 나에게 맡겨진 이슈(나에게 할당됨·달력) ── */

export type MyIssue = {
  id: string;
  ref: string;
  number: number;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  /** 누르면 갈 곳 — 그 프로젝트의 이슈 탭에서 이 이슈를 연다 */
  href: string;
};

/**
 * 내가 맡아 아직 할 일이 남은 이슈 — 열림·진행 중. 해결됨은 내 몫이 끝나 보고자 확인을 기다리는 것이라 뺀다.
 * 작업으로 옮겨 적지 않고 그대로 비춰 보인다 — 완료는 이슈에서 한 번.
 * 이슈를 켠, 내가 멤버인 프로젝트만. `due` 를 주면 기한이 그 범위 [from, to) 안인 것만(달력).
 */
export async function listMyIssues(userId: string, due?: { from: Date; to: Date }): Promise<MyIssue[]> {
  const rows = await prisma.issue.findMany({
    where: {
      assigneeId: userId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      project: { issuesEnabled: true, members: { some: { userId } } },
      ...(due ? { dueDate: { gte: due.from, lt: due.to } } : {}),
    },
    select: {
      id: true, number: true, title: true, status: true, priority: true, dueDate: true,
      project: { select: { id: true, name: true, issueKey: true } },
    },
  });
  const statusRank = { IN_PROGRESS: 0, OPEN: 1, RESOLVED: 2, CLOSED: 3 } as const;
  const prioRank = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;
  return rows
    .map((r) => ({
      id: r.id,
      ref: issueRef(r.project.issueKey, r.number),
      number: r.number,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.dueDate ? dateOnlyToString(r.dueDate) : null,
      projectId: r.project.id,
      projectName: r.project.name,
      href: `/projects/${r.project.id}?tab=issues&issue=${r.number}`,
    }))
    .sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        prioRank[a.priority] - prioRank[b.priority] ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        a.ref.localeCompare(b.ref),
    );
}

/**
 * 이 프로젝트 이슈들의 '바뀜 표시' — 이슈 화면이 몇 초마다 이것만 물어보고, 달라졌을 때만 화면을 다시 그린다.
 * 이슈 수·마지막 갱신(상태·담당·댓글은 이슈의 updatedAt 을 올린다), 기록 수와 댓글 고침·지움 시각, 라벨·지켜보기 수.
 * 내용을 싣지 않으므로 멤버 확인은 부르는 쪽이 한다.
 */
export async function issueStamp(projectId: string): Promise<string> {
  const [issues, events, labels, watchers] = await Promise.all([
    prisma.issue.aggregate({ where: { projectId }, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.issueEvent.aggregate({
      where: { issue: { projectId } },
      _count: { _all: true },
      _max: { createdAt: true, editedAt: true, deletedAt: true },
    }),
    prisma.issueLabel.count({ where: { projectId } }),
    prisma.issueWatcher.count({ where: { issue: { projectId } } }),
  ]);
  const t = (d: Date | null) => d?.getTime() ?? 0;
  return [
    issues._count._all,
    t(issues._max.updatedAt),
    events._count._all,
    t(events._max.createdAt),
    t(events._max.editedAt),
    t(events._max.deletedAt),
    labels,
    watchers,
  ].join(".");
}

/** 사이드바 '나에게 할당됨' 숫자에 더할 이슈 수(listMyIssues 와 같은 조건) */
export async function countMyIssues(userId: string): Promise<number> {
  return prisma.issue.count({
    where: { assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS"] }, project: { issuesEnabled: true, members: { some: { userId } } } },
  });
}
