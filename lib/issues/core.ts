import { prisma } from "@/lib/db";
import { assertCan, PermissionError, ROLE_RANK, type Role } from "@/lib/permissions";
import { notify } from "@/lib/notify";
import { dateOnlyFromString, dateOnlyToString, todayDateOnly } from "@/lib/date";
import { tokenIds } from "@/lib/mentions";
import { readFileBytes, removeFile, saveFile } from "@/lib/files/storage";
import { checkFiles, prepareBody, requireOpen, type IncomingFile } from "@/lib/projects/messages";
import { ActionError } from "@/lib/actions/_helpers";
import { DEFAULT_LABELS, LABEL_COLOR_KEYS, normalizeIssueKey, PRIORITIES, STATUSES } from "@/lib/issues/format";
import { getRequestPrefs } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";
import type { IssuePriority, IssueStatus } from "@/app/generated/prisma/enums";

/**
 * 이슈의 핵심 규칙. 서버 액션(lib/actions/issue.ts)과 파일이 실리는 multipart 라우트가 함께 쓴다.
 * "use server" 파일이 아니다 — 여기 함수들은 클라이언트가 직접 부를 수 없다. 권한은 매번 다시 본다.
 *
 * 누가 무엇을: 프로젝트 멤버는 이슈를 올리고, 고치고(제목·본문·상태·담당자·우선순위·라벨·기한), 댓글을 단다.
 * 이슈 삭제는 올린 사람이나 관리자. 이슈 설정(켜기·약어·템플릿·라벨)은 관리자. 보관된 프로젝트는 읽기 전용,
 * 이슈를 끈 프로젝트는 이슈를 새로 쓰지 못한다(지난 이슈는 그대로 남는다).
 *
 * 알림 받는 사람: 올린 사람 · 담당자 · 지켜보는 사람(자기가 한 일은 빼고).
 *  - 담당 지정 → 새 담당자에게 ISSUE_ASSIGNED
 *  - 상태 변경 → ISSUE_STATUS(해결됨이면 보고자 화면이 "확인하고 닫아 주세요")
 *  - 댓글 → ISSUE_COMMENT, 그 댓글에서 불린 사람은 ISSUE_MENTION 하나만
 */

export const ISSUE_TITLE_MAX = 200;
export const ISSUE_BODY_MAX = 10_000;
export const ISSUE_COMMENT_MAX = 4_000;

type IssueRow = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  body: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: Date | null;
};

const ISSUE_ROW = {
  id: true, projectId: true, number: true, title: true, body: true, status: true, priority: true,
  assigneeId: true, reporterId: true, dueDate: true,
} as const;

/* ── 확인 ── */

async function requireIssuesEnabled(projectId: string): Promise<{ issueKey: string }> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { issuesEnabled: true, issueKey: true } });
  if (!p) throw new PermissionError();
  if (!p.issuesEnabled || !p.issueKey) throw ActionError.key("issues.errors.notEnabled");
  return { issueKey: p.issueKey };
}

/** 이슈를 읽거나(read) 고칠(write) 수 있는지. 없는 이슈와 권한 없는 이슈는 같은 오류다. */
async function issueFor(userId: string, issueId: string, action: "read" | "write"): Promise<{ issue: IssueRow; role: Role }> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: ISSUE_ROW });
  if (!issue) throw new PermissionError();
  const role = await assertCan(userId, action, { kind: "project", id: issue.projectId });
  if (action === "write") {
    await requireOpen(issue.projectId);
    await requireIssuesEnabled(issue.projectId);
  }
  return { issue, role };
}

function cleanTitle(raw: string): string {
  const t = raw.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (!t) throw ActionError.key("issues.errors.titleRequired");
  if (t.length > ISSUE_TITLE_MAX) throw ActionError.key("issues.errors.titleTooLong", { max: ISSUE_TITLE_MAX });
  return t;
}

function parseDue(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw ActionError.key("issues.errors.badDue");
  return dateOnlyFromString(raw);
}

async function requireMember(projectId: string, userId: string | null): Promise<void> {
  if (!userId) return;
  const m = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { id: true } });
  if (!m) throw ActionError.key("issues.errors.assigneeNotMember");
}

async function projectLabelIds(projectId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.issueLabel.findMany({ where: { projectId, id: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function storeFiles(files: { name: string; bytes: Buffer; mimeType: string }[]) {
  const stored: { name: string; size: number; mimeType: string; storageKey: string }[] = [];
  for (const f of files) {
    const { storageKey } = await saveFile(f.bytes);
    stored.push({ name: f.name, size: f.bytes.byteLength, mimeType: f.mimeType, storageKey });
  }
  return stored;
}

/* ── 알림 ── */

/** 이 이슈의 소식을 받을 사람 — 올린 사람·담당자·지켜보는 사람. */
async function followers(issue: { id: string; reporterId: string | null; assigneeId: string | null }): Promise<Set<string>> {
  const watchers = await prisma.issueWatcher.findMany({ where: { issueId: issue.id }, select: { userId: true } });
  const out = new Set<string>(watchers.map((w) => w.userId));
  if (issue.reporterId) out.add(issue.reporterId);
  if (issue.assigneeId) out.add(issue.assigneeId);
  return out;
}

async function notifyMany(
  userIds: Iterable<string>,
  base: { kind: "ISSUE_ASSIGNED" | "ISSUE_STATUS" | "ISSUE_COMMENT" | "ISSUE_MENTION"; projectId: string; issueId: string; issueEventId?: string | null; actorId: string },
): Promise<void> {
  // 이벤트마다 한 번 알릴 것(댓글·상태·멘션)은 이벤트 id 가 중복 열쇠다. 날짜는 오늘로 둔다.
  const dayKey = dateOnlyToString(todayDateOnly());
  for (const userId of new Set(userIds)) {
    await notify({ userId, dayKey, ...base });
  }
}

/* ── 만들기 ── */

export async function createIssue(
  userId: string,
  input: {
    projectId: string;
    title: string;
    body: string;
    priority?: IssuePriority;
    assigneeId?: string | null;
    labelIds?: string[];
    dueDate?: string | null;
    files?: IncomingFile[];
    /** 메시지에서 만들 때(⋯ › 이슈로 만들기). 그 메시지의 파일을 복사해 붙이고, 메시지 아래에 이 이슈가 이어 보인다. */
    sourceMessageId?: string | null;
  },
): Promise<{ id: string; number: number }> {
  const { projectId } = input;
  await assertCan(userId, "write", { kind: "project", id: projectId });
  await requireOpen(projectId);
  await requireIssuesEnabled(projectId);

  const title = cleanTitle(input.title);
  const priority = input.priority && PRIORITIES.includes(input.priority) ? input.priority : "NORMAL";
  const assigneeId = input.assigneeId || null;
  await requireMember(projectId, assigneeId);
  const labelIds = await projectLabelIds(projectId, input.labelIds ?? []);
  const dueDate = parseDue(input.dueDate);
  const prepared = await prepareBody(projectId, userId, input.body, true, { max: ISSUE_BODY_MAX, key: "issues.errors.bodyTooLong" });

  // 원 메시지는 같은 프로젝트의 지워지지 않은 것만. 파일은 옮기지 않고 복사한다 — 메시지에서도 그대로 보여야 한다.
  let sourceMessageId: string | null = null;
  const copied: IncomingFile[] = [];
  if (input.sourceMessageId) {
    const m = await prisma.message.findFirst({
      where: { id: input.sourceMessageId, projectId, deletedAt: null },
      select: { id: true, attachments: { select: { name: true, mimeType: true, storageKey: true } } },
    });
    if (!m) throw ActionError.key("issues.errors.sourceMissing");
    sourceMessageId = m.id;
    for (const a of m.attachments) {
      const bytes = await readFileBytes(a.storageKey).catch(() => null);
      if (bytes) copied.push({ name: a.name, bytes, mimeType: a.mimeType });
    }
  }
  const files = checkFiles([...copied, ...(input.files ?? [])], "issues.errors.tooManyFiles");

  const stored = await storeFiles(files);
  let created: { id: string; number: number; eventId: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      // 번호는 프로젝트 행을 고치며 받는다 — 같은 순간 두 사람이 올려도 번호가 겹치지 않는다(행 잠금).
      const { issueSeq } = await tx.project.update({
        where: { id: projectId },
        data: { issueSeq: { increment: 1 } },
        select: { issueSeq: true },
      });
      const issue = await tx.issue.create({
        data: {
          projectId, number: issueSeq, title, body: prepared.body, priority, assigneeId, reporterId: userId, dueDate, sourceMessageId,
          labels: { create: labelIds.map((labelId) => ({ labelId })) },
          attachments: { create: stored.map((s) => ({ ...s, uploaderId: userId })) },
        },
        select: { id: true, number: true },
      });
      const ev = await tx.issueEvent.create({ data: { issueId: issue.id, actorId: userId, kind: "CREATED" }, select: { id: true } });
      // 메시지 화면은 "그 뒤로 바뀐 것" 을 받아 간다 — 원 메시지를 건드려야 다른 사람 화면에도 "↪ BUG-24" 가 붙는다.
      if (sourceMessageId) await tx.message.update({ where: { id: sourceMessageId }, data: { updatedAt: new Date() } });
      return { ...issue, eventId: ev.id };
    });
  } catch (e) {
    for (const s of stored) await removeFile(s.storageKey);
    throw e;
  }

  const base = { projectId, issueId: created.id, actorId: userId };
  if (assigneeId) await notifyMany([assigneeId], { ...base, kind: "ISSUE_ASSIGNED" });
  const mentioned = prepared.all ? prepared.memberIds : prepared.userIds;
  await notifyMany(mentioned.filter((id) => id !== assigneeId), { ...base, kind: "ISSUE_MENTION", issueEventId: created.eventId });
  return { id: created.id, number: created.number };
}

/* ── 고치기 ── */

export type IssuePatch = {
  title?: string;
  body?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeId?: string | null;
  labelIds?: string[];
  dueDate?: string | null;
};

/**
 * 이슈 고치기. 바뀐 칸마다 활동 기록을 하나씩 남긴다(본문 고침은 기록하지 않는다 — 글 다듬기는 소식이 아니다).
 * 상태를 바꾸면 해결·닫은 시각을 맞춰 둔다: 다시 열면 둘 다 지운다.
 */
export async function updateIssue(userId: string, issueId: string, patch: IssuePatch): Promise<void> {
  const { issue } = await issueFor(userId, issueId, "write");
  const data: Record<string, unknown> = {};
  const events: { kind: "TITLE" | "STATUS" | "ASSIGNEE" | "PRIORITY" | "LABELS" | "DUE"; fromValue: string | null; toValue: string | null }[] = [];
  let newMentions: string[] = [];

  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if (title !== issue.title) {
      data.title = title;
      events.push({ kind: "TITLE", fromValue: issue.title, toValue: title });
    }
  }

  if (patch.body !== undefined) {
    const prepared = await prepareBody(issue.projectId, userId, patch.body, true, { max: ISSUE_BODY_MAX, key: "issues.errors.bodyTooLong" });
    if (prepared.body !== issue.body) {
      data.body = prepared.body;
      const before = new Set(tokenIds(issue.body));
      newMentions = (prepared.all && !before.has("all") ? prepared.memberIds : prepared.userIds).filter((id) => !before.has(id));
    }
  }

  if (patch.status !== undefined && patch.status !== issue.status) {
    if (!STATUSES.includes(patch.status)) throw ActionError.key("issues.errors.badStatus");
    data.status = patch.status;
    const now = new Date();
    if (patch.status === "RESOLVED") Object.assign(data, { resolvedAt: now, closedAt: null });
    else if (patch.status === "CLOSED") data.closedAt = now; // 해결한 시각은 그대로 둔다
    else Object.assign(data, { resolvedAt: null, closedAt: null }); // 다시 열었다
    events.push({ kind: "STATUS", fromValue: issue.status, toValue: patch.status });
  }

  if (patch.priority !== undefined && patch.priority !== issue.priority) {
    if (!PRIORITIES.includes(patch.priority)) throw ActionError.key("issues.errors.badPriority");
    data.priority = patch.priority;
    events.push({ kind: "PRIORITY", fromValue: issue.priority, toValue: patch.priority });
  }

  if (patch.assigneeId !== undefined && (patch.assigneeId || null) !== issue.assigneeId) {
    const next = patch.assigneeId || null;
    await requireMember(issue.projectId, next);
    data.assigneeId = next;
    events.push({ kind: "ASSIGNEE", fromValue: issue.assigneeId, toValue: next });
  }

  if (patch.dueDate !== undefined) {
    const next = parseDue(patch.dueDate);
    const prev = issue.dueDate ? dateOnlyToString(issue.dueDate) : null;
    const nextStr = next ? dateOnlyToString(next) : null;
    if (prev !== nextStr) {
      data.dueDate = next;
      events.push({ kind: "DUE", fromValue: prev, toValue: nextStr });
    }
  }

  let labelChange: { add: string[]; remove: string[] } | null = null;
  if (patch.labelIds !== undefined) {
    const next = await projectLabelIds(issue.projectId, patch.labelIds);
    const current = (await prisma.issueLabelLink.findMany({ where: { issueId }, select: { labelId: true, label: { select: { name: true } } } }));
    const cur = new Set(current.map((c) => c.labelId));
    const add = next.filter((id) => !cur.has(id));
    const remove = [...cur].filter((id) => !next.includes(id));
    if (add.length || remove.length) {
      labelChange = { add, remove };
      const names = new Map(
        (await prisma.issueLabel.findMany({ where: { id: { in: [...cur, ...next] } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]),
      );
      events.push({
        kind: "LABELS",
        fromValue: [...cur].map((id) => names.get(id)).filter(Boolean).join(", ") || null,
        toValue: next.map((id) => names.get(id)).filter(Boolean).join(", ") || null,
      });
    }
  }

  if (Object.keys(data).length === 0 && !labelChange) return;

  const createdEvents = await prisma.$transaction(async (tx) => {
    // 라벨만 바뀌어도 이슈의 갱신 시각은 움직여야 '최근 갱신' 정렬이 맞는다.
    await tx.issue.update({ where: { id: issueId }, data: { ...data, updatedAt: new Date() } });
    if (labelChange) {
      if (labelChange.remove.length) await tx.issueLabelLink.deleteMany({ where: { issueId, labelId: { in: labelChange.remove } } });
      if (labelChange.add.length) await tx.issueLabelLink.createMany({ data: labelChange.add.map((labelId) => ({ issueId, labelId })) });
    }
    const out: { id: string; kind: string }[] = [];
    for (const e of events) {
      out.push(await tx.issueEvent.create({ data: { issueId, actorId: userId, ...e }, select: { id: true, kind: true } }));
    }
    return out;
  });

  const base = { projectId: issue.projectId, issueId, actorId: userId };
  const after = { ...issue, assigneeId: (data.assigneeId as string | null | undefined) !== undefined ? (data.assigneeId as string | null) : issue.assigneeId };
  const assigned = createdEvents.find((e) => e.kind === "ASSIGNEE");
  if (assigned && after.assigneeId) await notifyMany([after.assigneeId], { ...base, kind: "ISSUE_ASSIGNED" });
  const status = createdEvents.find((e) => e.kind === "STATUS");
  if (status) {
    const who = await followers(after);
    await notifyMany(who, { ...base, kind: "ISSUE_STATUS", issueEventId: status.id });
  }
  if (newMentions.length) await notifyMany(newMentions, { ...base, kind: "ISSUE_MENTION" });
}

/* ── 댓글 ── */

export async function addComment(userId: string, issueId: string, input: { body: string; files?: IncomingFile[] }): Promise<{ id: string }> {
  const { issue } = await issueFor(userId, issueId, "write");
  const files = checkFiles(input.files ?? [], "issues.errors.tooManyFiles");
  const prepared = await prepareBody(issue.projectId, userId, input.body, files.length > 0, { max: ISSUE_COMMENT_MAX, key: "issues.errors.commentTooLong" });

  const stored = await storeFiles(files);
  let eventId: string;
  try {
    eventId = await prisma.$transaction(async (tx) => {
      const ev = await tx.issueEvent.create({
        data: {
          issueId, actorId: userId, kind: "COMMENT", body: prepared.body,
          attachments: { create: stored.map((s) => ({ ...s, uploaderId: userId })) },
        },
        select: { id: true },
      });
      await tx.issue.update({ where: { id: issueId }, data: { updatedAt: new Date() } });
      return ev.id;
    });
  } catch (e) {
    for (const s of stored) await removeFile(s.storageKey);
    throw e;
  }

  const base = { projectId: issue.projectId, issueId, actorId: userId, issueEventId: eventId };
  const mentioned = new Set(prepared.all ? prepared.memberIds : prepared.userIds);
  await notifyMany(mentioned, { ...base, kind: "ISSUE_MENTION" });
  const who = [...(await followers(issue))].filter((id) => !mentioned.has(id));
  await notifyMany(who, { ...base, kind: "ISSUE_COMMENT" });
  return { id: eventId };
}

async function commentFor(userId: string, eventId: string) {
  const ev = await prisma.issueEvent.findUnique({
    where: { id: eventId },
    select: { id: true, kind: true, actorId: true, body: true, deletedAt: true, issueId: true, createdAt: true },
  });
  if (!ev || ev.kind !== "COMMENT" || ev.deletedAt) throw new PermissionError();
  const { issue, role } = await issueFor(userId, ev.issueId, "write");
  return { ev, issue, role };
}

/** 댓글 고치기 — 쓴 사람만. 새로 부른 사람에게만 알린다. */
export async function editComment(userId: string, eventId: string, raw: string): Promise<void> {
  const { ev, issue } = await commentFor(userId, eventId);
  if (ev.actorId !== userId) throw ActionError.key("issues.errors.editOwnComment");
  const hasFiles = (await prisma.attachment.count({ where: { issueEventId: eventId } })) > 0;
  const prepared = await prepareBody(issue.projectId, userId, raw, hasFiles, { max: ISSUE_COMMENT_MAX, key: "issues.errors.commentTooLong" });
  const before = new Set(tokenIds(ev.body));
  await prisma.issueEvent.update({ where: { id: eventId }, data: { body: prepared.body, editedAt: new Date() } });
  const added = (prepared.all && !before.has("all") ? prepared.memberIds : prepared.userIds).filter((id) => !before.has(id));
  await notifyMany(added, { projectId: issue.projectId, issueId: issue.id, actorId: userId, issueEventId: eventId, kind: "ISSUE_MENTION" });
}

/** 댓글 지우기 — 쓴 사람이나 관리자. 자리는 남기고("삭제된 댓글") 본문과 파일만 지운다. */
export async function deleteComment(userId: string, eventId: string): Promise<void> {
  const { ev, role } = await commentFor(userId, eventId);
  if (ev.actorId !== userId && ROLE_RANK[role] < ROLE_RANK.ADMIN) {
    throw ActionError.key("issues.errors.deleteComment");
  }
  const files = await prisma.attachment.findMany({ where: { issueEventId: eventId }, select: { id: true, storageKey: true } });
  await prisma.$transaction([
    prisma.attachment.deleteMany({ where: { issueEventId: eventId } }),
    prisma.issueEvent.update({ where: { id: eventId }, data: { body: "", deletedAt: new Date() } }),
  ]);
  for (const f of files) await removeFile(f.storageKey);
}

/* ── 지우기 · 지켜보기 ── */

/** 이슈 지우기 — 올린 사람이나 관리자. 번호는 되돌리지 않는다. */
export async function deleteIssue(userId: string, issueId: string): Promise<{ projectId: string }> {
  const { issue, role } = await issueFor(userId, issueId, "write");
  if (issue.reporterId !== userId && ROLE_RANK[role] < ROLE_RANK.ADMIN) {
    throw ActionError.key("issues.errors.deleteIssue");
  }
  const files = await prisma.attachment.findMany({
    where: { OR: [{ issueId }, { issueEvent: { issueId } }] },
    select: { storageKey: true },
  });
  await prisma.issue.delete({ where: { id: issueId } });
  for (const f of files) await removeFile(f.storageKey);
  return { projectId: issue.projectId };
}

export async function setWatching(userId: string, issueId: string, on: boolean): Promise<void> {
  // 지켜보기는 읽기만 되면 된다 — 보관된 프로젝트에서도 끌 수 있게.
  await issueFor(userId, issueId, "read");
  if (on) {
    await prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      create: { issueId, userId },
      update: {},
    });
  } else {
    await prisma.issueWatcher.deleteMany({ where: { issueId, userId } });
  }
}

/* ── 설정(관리자) ── */

/**
 * 이슈 켜기·끄기·약어·템플릿. 처음 켤 때는 약어가 꼭 있어야 하고, 템플릿·라벨이 비어 있으면 버그용 기본값을 채운다.
 * 약어는 이슈가 하나라도 생긴 뒤에는 바꾸지 않는다 — 글 속의 BUG-23 링크가 다른 데를 가리키게 된다.
 */
export async function updateIssueSettings(
  userId: string,
  projectId: string,
  input: { enabled: boolean; key?: string; template?: string },
): Promise<void> {
  await assertCan(userId, "manage", { kind: "project", id: projectId });
  await requireOpen(projectId);
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { issueKey: true, issueSeq: true, issueTemplate: true, _count: { select: { issueLabels: true } } },
  });

  let issueKey = p.issueKey;
  if (input.key !== undefined && input.key.trim() !== (p.issueKey ?? "")) {
    const k = normalizeIssueKey(input.key);
    if (!k) throw ActionError.key("issues.errors.keyFormat");
    if (p.issueKey && p.issueSeq > 0) throw ActionError.key("issues.errors.keyLocked");
    const taken = await prisma.project.findFirst({ where: { issueKey: k, id: { not: projectId } }, select: { id: true } });
    if (taken) throw ActionError.key("issues.errors.keyTaken", { key: k });
    issueKey = k;
  }
  if (input.enabled && !issueKey) throw ActionError.key("issues.errors.keyRequired");

  // 처음 켤 때 채우는 템플릿·라벨은 켠 사람의 언어로 남긴다(다른 기본 이름과 같은 규칙).
  const tr = translatorFor((await getRequestPrefs()).locale) as unknown as (key: string) => string;

  const template = input.template !== undefined ? input.template.replace(/\r\n/g, "\n").slice(0, ISSUE_BODY_MAX) : p.issueTemplate;
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        issuesEnabled: input.enabled,
        issueKey,
        issueTemplate:
          input.enabled && !template && p.issueSeq === 0 && input.template === undefined ? tr("issues.defaults.template") : template,
      },
    });
    if (input.enabled && p._count.issueLabels === 0) {
      await tx.issueLabel.createMany({
        data: DEFAULT_LABELS.map((l) => ({ projectId, name: tr(`issues.defaults.${l.key}`), color: l.color })),
        skipDuplicates: true,
      });
    }
  });
}

export async function saveLabel(
  userId: string,
  projectId: string,
  input: { id?: string; name: string; color: string },
): Promise<{ id: string }> {
  await assertCan(userId, "manage", { kind: "project", id: projectId });
  await requireOpen(projectId);
  const name = input.name.trim().slice(0, 30);
  if (!name) throw ActionError.key("issues.errors.labelName");
  const color = (LABEL_COLOR_KEYS as string[]).includes(input.color) ? input.color : "gray";
  const clash = await prisma.issueLabel.findFirst({
    where: { projectId, name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash) throw ActionError.key("issues.errors.labelExists", { name });
  if (input.id) {
    const own = await prisma.issueLabel.findFirst({ where: { id: input.id, projectId }, select: { id: true } });
    if (!own) throw new PermissionError();
    await prisma.issueLabel.update({ where: { id: input.id }, data: { name, color } });
    return { id: input.id };
  }
  return prisma.issueLabel.create({ data: { projectId, name, color }, select: { id: true } });
}

/** 라벨 지우기 — 이슈에서도 빠진다(활동 기록의 옛 이름은 남는다). */
export async function deleteLabel(userId: string, projectId: string, labelId: string): Promise<void> {
  await assertCan(userId, "manage", { kind: "project", id: projectId });
  await requireOpen(projectId);
  await prisma.issueLabel.deleteMany({ where: { id: labelId, projectId } });
}
