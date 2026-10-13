"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/session";
import {
  addComment,
  addIssueLabel,
  createIssueLabel,
  createIssue,
  deleteComment,
  deleteIssue,
  deleteLabel,
  editComment,
  issueImageLinks,
  saveLabel,
  setWatching,
  updateIssue,
  updateIssueSettings,
  type IssuePatch,
} from "@/lib/issues/core";
import { run, type ActionResult } from "@/lib/actions/_helpers";
import type { IssuePriority } from "@/app/generated/prisma/enums";
import type { IssueLabelItem } from "@/lib/queries/issues";

/**
 * 이슈 동작. 규칙은 lib/issues/core.ts 에 있고 여기는 로그인 확인과 화면 갱신만.
 * 파일이 실리는 만들기·댓글은 multipart 라우트로 온다(app/api/projects/[id]/issues, app/api/issues/[id]/comments).
 */

function refresh() {
  revalidatePath("/projects/[id]", "page");
}

export async function createIssueAction(input: {
  projectId: string;
  title: string;
  body: string;
  priority?: IssuePriority;
  assigneeId?: string | null;
  labelIds?: string[];
  dueDate?: string | null;
  sourceMessageId?: string | null;
}): Promise<ActionResult<{ id: string; number: number }>> {
  return run(async () => {
    const userId = await requireUserId();
    const r = await createIssue(userId, input);
    refresh();
    return r;
  });
}

export async function updateIssueAction(issueId: string, patch: IssuePatch): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await updateIssue(userId, issueId, patch);
    refresh();
  });
}

export async function addCommentAction(issueId: string, body: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const r = await addComment(userId, issueId, { body });
    refresh();
    return r;
  });
}

export async function editCommentAction(eventId: string, body: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await editComment(userId, eventId, body);
    refresh();
  });
}

export async function deleteCommentAction(eventId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await deleteComment(userId, eventId);
    refresh();
  });
}

export async function deleteIssueAction(issueId: string): Promise<ActionResult<{ projectId: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const r = await deleteIssue(userId, issueId);
    refresh();
    return r;
  });
}

export async function setWatchingAction(issueId: string, on: boolean): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await setWatching(userId, issueId, on);
    refresh();
  });
}

export async function updateIssueSettingsAction(
  projectId: string,
  input: { enabled: boolean; key?: string; template?: string },
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await updateIssueSettings(userId, projectId, input);
    revalidatePath("/", "layout");
  });
}

export async function saveLabelAction(projectId: string, input: { id?: string; name: string; color: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const r = await saveLabel(userId, projectId, input);
    refresh();
    return r;
  });
}

/** 새 이슈 창에서 새 라벨 만들기 — 이슈를 쓸 수 있는 사람 누구나. 같은 이름이 있으면 그것을 돌려준다. */
export async function createIssueLabelAction(projectId: string, input: { name: string; color: string }): Promise<ActionResult<IssueLabelItem>> {
  return run(async () => {
    const userId = await requireUserId();
    const r = await createIssueLabel(userId, projectId, input);
    refresh();
    return r;
  });
}

/** 이슈 화면에서 새 라벨을 만들어 바로 붙인다 — 이슈를 고칠 수 있는 사람 누구나 */
export async function addIssueLabelAction(issueId: string, input: { name: string; color: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const r = await addIssueLabel(userId, issueId, input);
    refresh();
    return r;
  });
}

/** ‘Claude Code 용 복사’ — 본문 사진의 24시간 임시 링크(경로만, 주소는 화면이 붙인다) */
export async function issueImageLinksAction(issueId: string): Promise<ActionResult<{ name: string; size: number; path: string }[]>> {
  return run(async () => {
    const userId = await requireUserId();
    return issueImageLinks(userId, issueId);
  });
}

export async function deleteLabelAction(projectId: string, labelId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await deleteLabel(userId, projectId, labelId);
    refresh();
  });
}
