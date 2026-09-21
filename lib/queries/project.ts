import { prisma } from "@/lib/db";
import { getProjectRole, ROLE_RANK, type Role } from "@/lib/permissions";
import type { ProjectRole } from "@/app/generated/prisma/enums";
import type { AttachmentItem } from "@/lib/queries/list";

/**
 * 프로젝트(대화 공간) 조회.
 *
 * 멤버가 아니면 null — 공개 프로젝트라도 참여하기 전에는 이름·목적·멤버 수만 준다.
 * 날짜는 ISO 문자열로 넘겨 클라이언트에서 그대로 쓴다.
 */

export type ProjectCard = {
  id: string;
  name: string;
  purpose: string;
  isPublic: boolean;
  archivedAt: string | null;
  memberCount: number;
  unread: number;
};

export type ProjectMemberItem = {
  userId: string;
  name: string;
  email: string;
  avatarColor: string;
  department: string | null;
  role: ProjectRole;
  isOwner: boolean;
  isMe: boolean;
  /** 관리자가 사용 중지한 사람. 멤버 목록에는 남지만 새로 부르거나 맡기지 않는다. */
  disabled: boolean;
};

export type MessageItem = {
  id: string;
  seq: number;
  parentId: string | null;
  author: { id: string; name: string; avatarColor: string } | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  pinnedByName: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  mentionsAll: boolean;
  mentions: { userId: string; name: string }[];
  files: AttachmentItem[];
  isMine: boolean;
  canDelete: boolean;
};

export type ProjectView =
  | {
      kind: "member";
      id: string;
      name: string;
      purpose: string;
      isPublic: boolean;
      archivedAt: string | null;
      ownerId: string;
      myRole: ProjectRole;
      isOwner: boolean;
      members: ProjectMemberItem[];
      pinned: MessageItem[];
      messages: MessageItem[];
      hasMore: boolean;
      lastReadSeq: number;
      serverTime: string;
    }
  | { kind: "joinable"; id: string; name: string; purpose: string; memberCount: number };

export const PAGE_SIZE = 50;
export const POLL_LIMIT = 200;
export const MAX_PINS = 20;

const MESSAGE_SELECT = {
  id: true, seq: true, projectId: true, parentId: true, authorId: true,
  author: { select: { id: true, name: true, avatarColor: true } },
  body: true, mentionsAll: true, editedAt: true, deletedAt: true,
  pinnedAt: true, pinnedById: true, createdAt: true, updatedAt: true,
  mentions: { select: { user: { select: { id: true, name: true } } } },
  attachments: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true, name: true, size: true, mimeType: true, createdAt: true,
      uploader: { select: { name: true } },
    },
  },
} as const;

type RawMessage = {
  id: string; seq: number; projectId: string; parentId: string | null; authorId: string | null;
  author: { id: string; name: string; avatarColor: string } | null;
  body: string; mentionsAll: boolean; editedAt: Date | null; deletedAt: Date | null;
  pinnedAt: Date | null; pinnedById: string | null; createdAt: Date; updatedAt: Date;
  mentions: { user: { id: string; name: string } }[];
  attachments: {
    id: string; name: string; size: number; mimeType: string; createdAt: Date;
    uploader: { name: string } | null;
  }[];
};

type Ctx = {
  meId: string;
  myRole: Role;
  replies: Map<string, { count: number; last: Date | null }>;
  pinnerNames: Map<string, string>;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toItem(m: RawMessage, ctx: Ctx): MessageItem {
  const r = ctx.replies.get(m.id);
  const isMine = m.authorId != null && m.authorId === ctx.meId;
  return {
    id: m.id,
    seq: m.seq,
    parentId: m.parentId,
    author: m.author,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    editedAt: iso(m.editedAt),
    deletedAt: iso(m.deletedAt),
    pinnedAt: iso(m.pinnedAt),
    pinnedByName: m.pinnedById ? (ctx.pinnerNames.get(m.pinnedById) ?? null) : null,
    replyCount: r?.count ?? 0,
    lastReplyAt: iso(r?.last ?? null),
    mentionsAll: m.mentionsAll,
    mentions: m.mentions.map((x) => ({ userId: x.user.id, name: x.user.name })),
    files: m.attachments.map((a) => ({
      id: a.id, name: a.name, size: a.size, mimeType: a.mimeType,
      uploaderName: a.uploader?.name ?? null, createdAt: a.createdAt.toISOString(),
    })),
    isMine,
    canDelete: isMine || ROLE_RANK[ctx.myRole] >= ROLE_RANK.ADMIN,
  };
}

/** 원글들의 답글 수·마지막 답글 시각. 저장해 두지 않고 그때그때 센다(삭제와 얽히지 않게). */
async function replySummary(ids: string[]): Promise<Ctx["replies"]> {
  const m = new Map<string, { count: number; last: Date | null }>();
  if (ids.length === 0) return m;
  const rows = await prisma.message.groupBy({
    by: ["parentId"],
    where: { parentId: { in: ids }, deletedAt: null },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  for (const r of rows) if (r.parentId) m.set(r.parentId, { count: r._count._all, last: r._max.createdAt });
  return m;
}

async function pinnerNames(rows: { pinnedById: string | null }[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.pinnedById).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** 원시 행 묶음 → 화면 항목. 여러 조회가 같은 모양을 내도록 한 곳에 둔다. */
export async function toMessageItems(rows: RawMessage[], meId: string, myRole: Role): Promise<MessageItem[]> {
  const [replies, names] = await Promise.all([
    replySummary(rows.filter((r) => r.parentId == null).map((r) => r.id)),
    pinnerNames(rows),
  ]);
  const ctx: Ctx = { meId, myRole, replies, pinnerNames: names };
  return rows.map((r) => toItem(r, ctx));
}

/* ── 디렉터리 ─────────────────────────────────────────────────── */

export async function listProjectsDirectory(
  userId: string,
): Promise<{ mine: ProjectCard[]; open: ProjectCard[]; archived: ProjectCard[] }> {
  const [memberships, publicOnes, unread] = await Promise.all([
    prisma.projectMember.findMany({
      where: { userId },
      select: {
        project: {
          select: {
            id: true, name: true, purpose: true, isPublic: true, archivedAt: true,
            _count: { select: { members: true } },
          },
        },
      },
    }),
    prisma.project.findMany({
      where: { isPublic: true, archivedAt: null, members: { none: { userId } } },
      select: {
        id: true, name: true, purpose: true, isPublic: true, archivedAt: true,
        _count: { select: { members: true } },
      },
      orderBy: { name: "asc" },
    }),
    getUnreadByProject(userId),
  ]);

  const card = (p: (typeof publicOnes)[number]): ProjectCard => ({
    id: p.id, name: p.name, purpose: p.purpose, isPublic: p.isPublic,
    archivedAt: iso(p.archivedAt), memberCount: p._count.members, unread: unread.get(p.id) ?? 0,
  });
  const byName = (a: ProjectCard, b: ProjectCard) => a.name.localeCompare(b.name, "ko");
  const mineAll = memberships.map((m) => card(m.project)).sort(byName);

  return {
    mine: mineAll.filter((p) => !p.archivedAt),
    open: publicOnes.map(card),
    archived: mineAll.filter((p) => p.archivedAt),
  };
}

/* ── 프로젝트 화면 ────────────────────────────────────────────── */

export async function getProjectMembers(projectId: string, meId: string): Promise<ProjectMemberItem[]> {
  const [project, rows] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } }),
    prisma.projectMember.findMany({
      where: { projectId },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true, avatarColor: true, department: true, disabledAt: true } },
      },
    }),
  ]);
  const ownerId = project?.ownerId;
  return rows
    .map((r) => ({
      userId: r.user.id, name: r.user.name, email: r.user.email, avatarColor: r.user.avatarColor,
      department: r.user.department, role: r.role, isOwner: r.user.id === ownerId, isMe: r.user.id === meId,
      disabled: r.user.disabledAt != null,
    }))
    .sort(
      (a, b) =>
        Number(b.isOwner) - Number(a.isOwner) ||
        Number(b.role === "ADMIN") - Number(a.role === "ADMIN") ||
        a.name.localeCompare(b.name, "ko"),
    );
}

/**
 * 원글 목록. 삭제됐고 살아 있는 답글도 없는 글은 뺀다(자리를 남길 이유가 없다).
 * `before` 는 그 seq 앞의 것(이전 페이지), 없으면 최신부터.
 */
async function loadRoots(projectId: string, before: number | undefined, limit: number) {
  const rows = await prisma.message.findMany({
    where: {
      projectId,
      parentId: null,
      ...(before != null ? { seq: { lt: before } } : {}),
      OR: [{ deletedAt: null }, { replies: { some: { deletedAt: null } } }],
    },
    select: MESSAGE_SELECT,
    orderBy: { seq: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { rows: rows.slice(0, limit).reverse(), hasMore };
}

export async function getProjectView(userId: string, projectId: string): Promise<ProjectView | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, name: true, purpose: true, isPublic: true, archivedAt: true, ownerId: true,
      _count: { select: { members: true } },
    },
  });
  if (!project) return null;

  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true, lastReadSeq: true },
  });
  if (!membership) {
    if (project.isPublic && !project.archivedAt) {
      return {
        kind: "joinable", id: project.id, name: project.name, purpose: project.purpose,
        memberCount: project._count.members,
      };
    }
    return null;
  }

  const myRole: Role = project.ownerId === userId ? "ADMIN" : membership.role === "ADMIN" ? "ADMIN" : "EDITOR";
  const [members, { rows, hasMore }, pinnedRows] = await Promise.all([
    getProjectMembers(projectId, userId),
    loadRoots(projectId, undefined, PAGE_SIZE),
    prisma.message.findMany({
      where: { projectId, pinnedAt: { not: null }, deletedAt: null },
      select: MESSAGE_SELECT,
      orderBy: { pinnedAt: "desc" },
      take: MAX_PINS,
    }),
  ]);
  const [messages, pinned] = await Promise.all([
    toMessageItems(rows, userId, myRole),
    toMessageItems(pinnedRows, userId, myRole),
  ]);

  return {
    kind: "member",
    id: project.id,
    name: project.name,
    purpose: project.purpose,
    isPublic: project.isPublic,
    archivedAt: iso(project.archivedAt),
    ownerId: project.ownerId,
    myRole: project.ownerId === userId ? "ADMIN" : membership.role,
    isOwner: project.ownerId === userId,
    members,
    pinned,
    messages,
    hasMore,
    lastReadSeq: membership.lastReadSeq,
    serverTime: new Date().toISOString(),
  };
}

/**
 * 메시지 조회. 멤버가 아니면 null.
 *  - parentId: null 이면 원글, 값이 있으면 그 스레드의 답글(전부, 500 상한)
 *  - before: 그 seq 앞의 이전 페이지
 *  - since: 그 뒤로 바뀐 것 전부(새 글·수정·삭제·고정) — 폴링용. 삭제된 글도 준다.
 */
export async function listMessages(
  userId: string,
  projectId: string,
  opts: { parentId?: string | null; before?: number; since?: Date; limit?: number },
): Promise<{ messages: MessageItem[]; hasMore: boolean; serverTime: string } | null> {
  const myRole = await getProjectRole(userId, projectId);
  if (!myRole) return null;
  const serverTime = new Date().toISOString();

  if (opts.since) {
    const rows = await prisma.message.findMany({
      where: { projectId, updatedAt: { gt: opts.since } },
      select: MESSAGE_SELECT,
      orderBy: { updatedAt: "asc" },
      take: POLL_LIMIT,
    });
    return { messages: await toMessageItems(rows, userId, myRole), hasMore: rows.length === POLL_LIMIT, serverTime };
  }

  if (opts.parentId) {
    const rows = await prisma.message.findMany({
      where: { projectId, parentId: opts.parentId, deletedAt: null },
      select: MESSAGE_SELECT,
      orderBy: { seq: "asc" },
      take: 500,
    });
    return { messages: await toMessageItems(rows, userId, myRole), hasMore: false, serverTime };
  }

  const { rows, hasMore } = await loadRoots(projectId, opts.before, opts.limit ?? PAGE_SIZE);
  return { messages: await toMessageItems(rows, userId, myRole), hasMore, serverTime };
}

/** 스레드: 원글 하나와 그 답글. 원글이 이 프로젝트 것이 아니면 null. */
export async function getThread(
  userId: string,
  projectId: string,
  parentId: string,
): Promise<{ parent: MessageItem; replies: MessageItem[] } | null> {
  const myRole = await getProjectRole(userId, projectId);
  if (!myRole) return null;
  const parent = await prisma.message.findFirst({
    where: { id: parentId, projectId, parentId: null },
    select: MESSAGE_SELECT,
  });
  if (!parent) return null;
  const replies = await listMessages(userId, projectId, { parentId });
  const [item] = await toMessageItems([parent], userId, myRole);
  return { parent: item, replies: replies?.messages ?? [] };
}

/* ── 안 읽음 ──────────────────────────────────────────────────── */

/**
 * 프로젝트별 안 읽은 원글 수 — 남의 글, 삭제 안 된 것, 내가 마지막으로 읽은 seq 뒤.
 * 멤버십을 조인하므로 비멤버 프로젝트는 절대 나오지 않는다. 사이드바가 요청마다 부르니 쿼리 하나로.
 */
export async function getUnreadByProject(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ projectId: string; count: number }[]>`
    SELECT m."projectId" AS "projectId", count(*)::int AS "count"
    FROM "ProjectMember" pm
    JOIN "Message" m ON m."projectId" = pm."projectId"
    WHERE pm."userId" = ${userId}
      AND m."seq" > pm."lastReadSeq"
      AND m."parentId" IS NULL
      AND m."deletedAt" IS NULL
      AND m."authorId" IS DISTINCT FROM ${userId}
    GROUP BY m."projectId"
  `;
  return new Map(rows.map((r) => [r.projectId, r.count]));
}

export type SidebarProject = { id: string; name: string; isPublic: boolean; unread: number };

/** 사이드바 '프로젝트' 영역. 보관된 것은 뺀다. */
export async function listSidebarProjects(userId: string): Promise<SidebarProject[]> {
  const [memberships, unread] = await Promise.all([
    prisma.projectMember.findMany({
      where: { userId, project: { archivedAt: null } },
      select: { project: { select: { id: true, name: true, isPublic: true } } },
    }),
    getUnreadByProject(userId),
  ]);
  return memberships
    .map((m) => ({ ...m.project, unread: unread.get(m.project.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
