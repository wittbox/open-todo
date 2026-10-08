import { prisma } from "@/lib/db";
import { getProjectRole, ROLE_RANK } from "@/lib/permissions";
import { dateOnlyToString } from "@/lib/date";
import { tokenIds } from "@/lib/mentions";
import { issueRef } from "@/lib/issues/format";
import type { IssueEventKind, IssuePriority, IssueStatus } from "@/app/generated/prisma/enums";
import type { AttachmentItem } from "@/lib/queries/list";

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
  };
}

/** "BUG-23" 이 가리키는 이슈의 프로젝트와 번호. 멤버가 아니면 null(존재를 알려 주지 않는다). */
export async function resolveIssueRef(userId: string, key: string, number: number): Promise<{ projectId: string; number: number } | null> {
  const p = await prisma.project.findUnique({ where: { issueKey: key }, select: { id: true } });
  if (!p || !(await getProjectRole(userId, p.id))) return null;
  const exists = await prisma.issue.findUnique({ where: { projectId_number: { projectId: p.id, number } }, select: { id: true } });
  return exists ? { projectId: p.id, number } : null;
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

/** 사이드바 '나에게 할당됨' 숫자에 더할 이슈 수(listMyIssues 와 같은 조건) */
export async function countMyIssues(userId: string): Promise<number> {
  return prisma.issue.count({
    where: { assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS"] }, project: { issuesEnabled: true, members: { some: { userId } } } },
  });
}
