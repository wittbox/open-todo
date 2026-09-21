import { prisma } from "@/lib/db";
import { assertCan, PermissionError, ROLE_RANK } from "@/lib/permissions";
import { notify } from "@/lib/notify";
import { dateOnlyToString, todayDateOnly } from "@/lib/date";
import { extractMentions, MAX_MENTIONS, tokenIds } from "@/lib/mentions";
import { checkFile, MAX_FILES_PER_MESSAGE } from "@/lib/files/policy";
import { removeFile, saveFile } from "@/lib/files/storage";
import { toMessageItems, type MessageItem } from "@/lib/queries/project";
import { ActionError } from "@/lib/actions/_helpers";
import { translatorFor } from "@/i18n/server";
import { getRequestPrefs } from "@/lib/prefs";

/**
 * 프로젝트 메시지의 핵심 규칙. 서버 액션과 (파일이 실리는) multipart 라우트가 함께 쓴다.
 *
 * "use server" 파일이 아니다 — 여기 함수들은 클라이언트가 직접 부를 수 없다.
 * 권한 확인(assertCan)은 매번 다시 한다.
 */

export const MESSAGE_MAX_CHARS = 4000;

export type IncomingFile = { name: string; bytes: Buffer; mimeType: string };

export function normalizeBody(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * 보관 거절. PermissionError 로 던져야 라우트가 403 을 준다(ActionError 는 400).
 * PermissionError 는 번역 열쇠를 담지 못하므로 여기서 요청한 사람의 말로 바꿔 넣는다.
 */
export async function archivedError(): Promise<PermissionError> {
  const t = translatorFor((await getRequestPrefs()).locale);
  return new PermissionError(t("projects.errors.archived"));
}

/** 보관된 프로젝트는 읽기 전용이다. 글·답글·수정·고정·참여 앞에서 부른다. */
export async function requireOpen(projectId: string): Promise<void> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { archivedAt: true } });
  if (!p) throw new PermissionError();
  if (p.archivedAt) throw await archivedError();
}

/** 소유자만. 없는 프로젝트와 같은 메시지로 거절한다. */
export async function requireOwner(userId: string, projectId: string): Promise<void> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } });
  if (!p || p.ownerId !== userId) throw new PermissionError();
}

/** 본문 검사 + 멘션 풀기. 멤버·비멤버 이름을 찾아 토큰을 정리한다. 파일이 있으면 본문이 비어도 된다. */
async function prepareBody(projectId: string, authorId: string, raw: string, allowEmpty = false) {
  const body = normalizeBody(raw);
  if (!body.trim() && !allowEmpty) throw ActionError.key("projects.errors.emptyBody");
  if (body.length > MESSAGE_MAX_CHARS) {
    throw ActionError.key("projects.errors.bodyTooLong", { max: MESSAGE_MAX_CHARS });
  }

  const memberRows = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true, user: { select: { name: true } } },
  });
  const members = new Map(memberRows.map((m) => [m.userId, m.user.name]));
  const strangers = tokenIds(body).filter((id) => !members.has(id));
  const known = new Map(
    strangers.length
      ? (await prisma.user.findMany({ where: { id: { in: strangers } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
      : [],
  );
  const m = extractMentions(body, { members, known, authorId });
  if (m.tooMany) throw ActionError.key("projects.errors.tooManyMentions", { count: m.tooMany, max: MAX_MENTIONS });
  return { body: m.body, userIds: m.userIds, all: m.all, memberIds: [...members.keys()] };
}

/** 파일 검사. 개수·크기·확장자. 실제 바이트 크기로 다시 본다(브라우저가 알려 준 값을 믿지 않는다). */
function checkFiles(files: IncomingFile[]): { name: string; bytes: Buffer; mimeType: string }[] {
  if (files.length > MAX_FILES_PER_MESSAGE) {
    throw ActionError.key("files.errors.tooManyPerMessage", { max: MAX_FILES_PER_MESSAGE });
  }
  return files.map((f) => {
    const c = checkFile(f.name, f.bytes.byteLength);
    if (!c.ok) throw ActionError.key(c.key, c.values);
    return { name: c.name, bytes: f.bytes, mimeType: f.mimeType || "application/octet-stream" };
  });
}

/** 멘션 알림. @전체면 작성자 빼고 모두. 메시지마다 한 번 — dayKey 를 작성일로 고정한다. */
async function notifyMentions(
  projectId: string,
  messageId: string,
  authorId: string,
  targets: string[],
  createdAt: Date,
): Promise<void> {
  const dayKey = dateOnlyToString(todayDateOnly(createdAt));
  for (const userId of targets) {
    if (userId === authorId) continue;
    await notify({ userId, kind: "MENTION", projectId, messageId, actorId: authorId, dayKey });
  }
}

export async function createMessage(
  userId: string,
  input: { projectId: string; body: string; parentId?: string | null; files?: IncomingFile[] },
): Promise<MessageItem> {
  let projectId = input.projectId;

  // 답글은 원글의 프로젝트를 따른다. 클라이언트가 보낸 projectId 를 믿으면
  // 다른 프로젝트에 끼워 넣을 수 있다.
  if (input.parentId) {
    const parent = await prisma.message.findUnique({
      where: { id: input.parentId },
      select: { projectId: true, parentId: true, deletedAt: true },
    });
    if (!parent) throw new PermissionError();
    if (parent.parentId) throw ActionError.key("projects.errors.replyToReply");
    if (parent.deletedAt) throw ActionError.key("projects.errors.replyToDeleted");
    projectId = parent.projectId;
  }

  const role = await assertCan(userId, "write", { kind: "project", id: projectId });
  await requireOpen(projectId);
  const files = checkFiles(input.files ?? []);
  const prepared = await prepareBody(projectId, userId, input.body, files.length > 0);

  // 파일은 먼저 디스크에 둔다. 행을 만들다 실패하면 방금 쓴 파일을 도로 지운다.
  const stored: { name: string; size: number; mimeType: string; storageKey: string }[] = [];
  for (const f of files) {
    const { storageKey } = await saveFile(f.bytes);
    stored.push({ name: f.name, size: f.bytes.byteLength, mimeType: f.mimeType, storageKey });
  }

  let created: { id: string; seq: number; parentId: string | null; createdAt: Date };
  try {
    created = await prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: {
          projectId, authorId: userId, parentId: input.parentId ?? null,
          body: prepared.body, mentionsAll: prepared.all,
          mentions: { create: prepared.userIds.map((id) => ({ userId: id })) },
          attachments: { create: stored.map((s) => ({ ...s, uploaderId: userId })) },
        },
        select: { id: true, seq: true, parentId: true, createdAt: true },
      });
      // 내 글은 내가 읽은 것이다. 원글일 때만 — 답글은 안 읽음에 세지 않는다.
      if (!m.parentId) {
        await tx.projectMember.updateMany({
          where: { projectId, userId, lastReadSeq: { lt: m.seq } },
          data: { lastReadSeq: m.seq },
        });
      }
      return m;
    });
  } catch (e) {
    for (const s of stored) await removeFile(s.storageKey);
    throw e;
  }

  await notifyMentions(projectId, created.id, userId, prepared.all ? prepared.memberIds : prepared.userIds, created.createdAt);

  const row = await prisma.message.findUniqueOrThrow({ where: { id: created.id }, select: MESSAGE_ROW_SELECT });
  const [item] = await toMessageItems([row], userId, role);
  return item;
}

/**
 * 본문 고치기. 작성자만. 멘션은 다시 풀어 새로 부른 사람에게만 알린다 —
 * 이미 알린 사람은 중복 열쇠(messageId)로도 막히지만, 빠진 사람의 행은 지운다.
 */
export async function updateMessageBody(userId: string, messageId: string, raw: string): Promise<void> {
  const m = await prisma.message.findUnique({
    where: { id: messageId },
    select: { projectId: true, authorId: true, deletedAt: true, mentionsAll: true, createdAt: true, _count: { select: { attachments: true } } },
  });
  if (!m || m.deletedAt) throw new PermissionError();
  await assertCan(userId, "write", { kind: "project", id: m.projectId });
  if (m.authorId !== userId) throw ActionError.key("projects.errors.editOwnOnly");
  await requireOpen(m.projectId);

  const prepared = await prepareBody(m.projectId, userId, raw, m._count.attachments > 0);
  const before = new Set(
    (await prisma.messageMention.findMany({ where: { messageId }, select: { userId: true } })).map((x) => x.userId),
  );
  const added = prepared.userIds.filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !prepared.userIds.includes(id));

  await prisma.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: messageId },
      data: { body: prepared.body, mentionsAll: prepared.all, editedAt: new Date() },
    });
    if (removed.length) await tx.messageMention.deleteMany({ where: { messageId, userId: { in: removed } } });
    if (added.length) await tx.messageMention.createMany({ data: added.map((id) => ({ messageId, userId: id })) });
  });

  const targets = prepared.all && !m.mentionsAll ? prepared.memberIds : added;
  await notifyMentions(m.projectId, messageId, userId, targets, m.createdAt);
}

/** 삭제는 작성자 또는 프로젝트 관리자. 관리자는 지울 수는 있어도 고칠 수는 없다. */
export async function assertCanDelete(userId: string, messageId: string): Promise<string> {
  const m = await prisma.message.findUnique({
    where: { id: messageId },
    select: { projectId: true, authorId: true, deletedAt: true },
  });
  if (!m || m.deletedAt) throw new PermissionError();
  const role = await assertCan(userId, "write", { kind: "project", id: m.projectId });
  if (m.authorId !== userId && ROLE_RANK[role] < ROLE_RANK.ADMIN) {
    throw ActionError.key("projects.errors.deleteOwnOrAdmin");
  }
  await requireOpen(m.projectId);
  return m.projectId;
}

/**
 * 삭제는 소프트다 — 답글 달린 원글은 자리를 남기고, 폴링이 "바뀐 것"으로 알아챈다.
 * 내용은 남기지 않는다. 멘션·알림·첨부 행도 지우고, 파일은 storageKey 를 돌려주니
 * 부른 쪽이 디스크에서 지운다(DB 먼저, 디스크 나중 — deleteAttachment 와 같은 순서).
 */
export async function softDeleteMessage(messageId: string): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const files = await tx.attachment.findMany({ where: { messageId }, select: { storageKey: true } });
    await tx.attachment.deleteMany({ where: { messageId } });
    await tx.messageMention.deleteMany({ where: { messageId } });
    await tx.notification.deleteMany({ where: { messageId } });
    await tx.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: "", mentionsAll: false, pinnedAt: null, pinnedById: null, editedAt: null },
    });
    return files.map((f) => f.storageKey);
  });
}

/** 프로젝트에 넣었다고 알린다. 멤버 행이 생긴 뒤에 불러야 notify 의 가시성 검사를 통과한다. */
export async function notifyInvited(projectId: string, userId: string, actorId: string): Promise<void> {
  await notify({
    userId, kind: "PROJECT_INVITED", projectId, actorId,
    dayKey: dateOnlyToString(todayDateOnly()),
  });
}

/** queries/project.ts 의 MESSAGE_SELECT 와 같은 모양. 순환 참조를 피하려고 여기서 다시 적는다. */
const MESSAGE_ROW_SELECT = {
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
