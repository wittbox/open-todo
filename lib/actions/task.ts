"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { assertCan, getListRole, getProjectRole, PermissionError, ROLE_RANK } from "@/lib/permissions";
import { removeFile } from "@/lib/files/storage";
import { orderAfter } from "@/lib/ordering";
import { canBeAssigned } from "@/lib/queries/members";
import { notify } from "@/lib/notify";
import { nextDue, normalizeRule, type RepeatRule } from "@/lib/repeat";
import { ActionError, cleanName, orderBetweenTasks, run, type ActionResult } from "./_helpers";
import { getRequestPrefs, requestToday } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";

function refresh() {
  revalidatePath("/", "layout");
}

/** 저장되는 기본 이름(빈 제목의 세부 단계 등)은 만든 사람의 언어로 남긴다. */
async function defaultStepName(): Promise<string> {
  const { locale } = await getRequestPrefs();
  return translatorFor(locale)("tasks.defaults.step");
}

/** 제목은 목록/그룹 이름보다 길 수 있다. */
function cleanTitle(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 255);
}

export async function createTask(
  listId: string,
  title: string,
  opts: { important?: boolean; myDay?: boolean; dueDate?: string | null } = {},
): Promise<ActionResult<{ id: string; seq: number }>> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "list", id: listId });

    const t = cleanTitle(title);
    if (!t) throw ActionError.key("tasks.errors.emptyTitle");

    // 새 작업은 미완료 목록의 맨 뒤에 붙인다.
    const last = await prisma.task.findFirst({
      where: { listId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const task = await prisma.task.create({
      data: {
        listId,
        creatorId: userId,
        title: t,
        isImportant: opts.important ?? false,
        dueDate: opts.dueDate ? new Date(`${opts.dueDate}T00:00:00.000Z`) : null,
        order: orderAfter(last?.order ?? null),
      },
      select: { id: true, seq: true },
    });

    if (opts.myDay) {
      await prisma.myDayEntry.create({ data: { userId, taskId: task.id, date: await requestToday() } });
    }

    refresh();
    return task;
  });
}

export type TaskPatch = {
  title?: string;
  note?: string | null;
  isImportant?: boolean;
  isCompleted?: boolean;
  /** "YYYY-MM-DD" 또는 null. 날짜 전용 값이므로 UTC 자정으로 저장된다. */
  dueDate?: string | null;
  /** 나의 하루는 사용자마다 달라서 Task 가 아니라 MyDayEntry 로 저장한다 */
  myDay?: boolean;
};

export async function updateTask(id: string, patch: TaskPatch): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id });

    if (patch.myDay !== undefined) {
      if (patch.myDay) {
        await prisma.myDayEntry.upsert({
          where: { userId_taskId: { userId, taskId: id } },
          create: { userId, taskId: id, date: await requestToday() },
          update: { date: await requestToday() },
        });
      } else {
        await prisma.myDayEntry.deleteMany({ where: { userId, taskId: id } });
      }
    }

    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const t = cleanTitle(patch.title);
      if (t) data.title = t;
    }
    if (patch.note !== undefined) data.note = patch.note?.trim() ? patch.note.slice(0, 8000) : null;
    if (patch.isImportant !== undefined) data.isImportant = patch.isImportant;
    if (patch.isCompleted !== undefined) {
      data.isCompleted = patch.isCompleted;
      data.completedAt = patch.isCompleted ? new Date() : null;
    }
    if (patch.dueDate !== undefined) {
      data.dueDate = patch.dueDate ? new Date(`${patch.dueDate}T00:00:00.000Z`) : null;
    }

    if (Object.keys(data).length > 0) await prisma.task.update({ where: { id }, data });

    // 반복은 완료를 눌렀을 때만 움직인다. 되돌리면 그때 만든 것도 되돌린다.
    if (patch.isCompleted === true) {
      await spawnNextOccurrence(id, await requestToday());
    } else if (patch.isCompleted === false) {
      await removeUntouchedFollowUp(id);
    }

    refresh();
  });
}

/**
 * 미리 알림 시각 지정·해제.
 * 시각을 바꾸면 remindedAt 을 지워 다시 울리게 한다.
 */
export async function setReminder(taskId: string, at: string | null): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id: taskId });

    const remindAt = at ? new Date(at) : null;
    if (remindAt && Number.isNaN(remindAt.getTime())) throw ActionError.key("tasks.errors.badTime");

    await prisma.task.update({
      where: { id: taskId },
      data: { remindAt, remindedAt: null },
    });
    refresh();
  });
}

/**
 * 반복 규칙 지정·해제.
 * 해제해도 이미 만들어진 작업은 건드리지 않는다 — 앞으로 안 생길 뿐이다.
 */
export async function setRepeat(taskId: string, raw: Partial<RepeatRule> | null): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id: taskId });

    const rule = normalizeRule(raw);
    await prisma.task.update({
      where: { id: taskId },
      data: {
        repeatUnit: rule?.unit ?? null,
        repeatEvery: rule?.every ?? 1,
        repeatDays: rule?.days ?? [],
      },
    });
    refresh();
  });
}

/**
 * 반복 작업을 완료했을 때 다음 하나를 만든다.
 *
 * 미리 여러 개를 만들어 두지 않는 이유는, 규칙이 바뀌거나 반복이 꺼졌을 때
 * 앞서 만들어 둔 것들을 쫓아다니며 고쳐야 하기 때문이다. 완료 시점에 하나만
 * 만들면 그런 뒷정리가 없다.
 */
async function spawnNextOccurrence(taskId: string, completedOn: Date): Promise<void> {
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      listId: true, creatorId: true, assigneeId: true, title: true, note: true,
      isImportant: true, dueDate: true, order: true,
      repeatUnit: true, repeatEvery: true, repeatDays: true,
      steps: { orderBy: { order: "asc" }, select: { title: true, order: true } },
    },
  });
  const rule = normalizeRule(
    t?.repeatUnit ? { unit: t.repeatUnit, every: t.repeatEvery, days: t.repeatDays } : null,
  );
  if (!t || !rule) return;

  // 기한이 없는 반복은 완료한 날을 기준으로 다음을 잡는다.
  const anchor = t.dueDate ?? completedOn;
  const due = nextDue(rule, anchor, completedOn);

  await prisma.task.create({
    data: {
      listId: t.listId,
      creatorId: t.creatorId,
      assigneeId: t.assigneeId,
      title: t.title,
      note: t.note,
      isImportant: t.isImportant,
      dueDate: due,
      order: t.order,
      repeatUnit: rule.unit,
      repeatEvery: rule.every,
      repeatDays: rule.days,
      repeatFromId: taskId,
      // 세부 단계는 체크가 풀린 채로 따라간다.
      steps: { create: t.steps.map((s) => ({ title: s.title, order: s.order })) },
    },
  });
}

/**
 * 완료를 취소했을 때, 그때 만들어진 다음 작업을 되돌린다.
 * 이미 손을 댄 것은 남긴다 — 남의 작업일 수도 있고, 지우면 그 편집이 사라진다.
 */
async function removeUntouchedFollowUp(taskId: string): Promise<void> {
  const followUps = await prisma.task.findMany({
    where: { repeatFromId: taskId, isCompleted: false },
    select: {
      id: true,
      title: true,
      note: true,
      _count: { select: { myDayEntries: true } },
      steps: { select: { isCompleted: true } },
    },
  });

  const untouched = followUps.filter(
    (f) => f._count.myDayEntries === 0 && f.steps.every((s) => !s.isCompleted),
  );
  if (untouched.length > 0) {
    await prisma.task.deleteMany({ where: { id: { in: untouched.map((f) => f.id) } } });
  }
}

/**
 * 담당자 지정·해제.
 *
 * 지정하는 사람은 그 작업을 고칠 수 있어야 하고, 지정받는 사람은 그 목록을 볼 수
 * 있어야 한다. 두 번째를 빼먹으면 볼 수 없는 작업이 남의 [나에게 할당됨]에 쌓인다.
 */
export async function setAssignee(taskId: string, assigneeId: string | null): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id: taskId });

    if (assigneeId) {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { listId: true } });
      if (!task) throw ActionError.key("tasks.errors.taskNotFound");
      if (!(await canBeAssigned(assigneeId, task.listId))) {
        throw ActionError.key("tasks.errors.assigneeNoAccess");
      }
    }

    await prisma.task.update({ where: { id: taskId }, data: { assigneeId } });
    if (assigneeId) {
      await notify({ userId: assigneeId, kind: "ASSIGNED", taskId, actorId: userId });
    }
    refresh();
  });
}

/**
 * 첨부 지우기. 올린 본인이거나 목록(프로젝트) 관리자만.
 *
 * 편집 권한만으로 남이 올린 자료를 지울 수 있으면, 공유 목록에서 누군가의
 * 근거가 조용히 사라진다.
 */
export async function deleteAttachment(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const file = await prisma.attachment.findUnique({
      where: { id },
      select: {
        uploaderId: true, storageKey: true,
        task: { select: { listId: true } },
        message: { select: { projectId: true } },
      },
    });
    if (!file) throw new PermissionError();

    const role = file.task
      ? await getListRole(userId, file.task.listId)
      : file.message
        ? await getProjectRole(userId, file.message.projectId)
        : null;
    if (!role) throw new PermissionError();
    const mine = file.uploaderId === userId;
    if (!mine && ROLE_RANK[role] < ROLE_RANK.ADMIN) {
      throw ActionError.key("tasks.errors.attachmentDeleteDenied");
    }

    // DB 를 먼저 지운다. 디스크만 남으면 고아 파일이지만, 반대는 화면에
    // 있는데 열리지 않는 항목이 되어 더 나쁘다.
    await prisma.attachment.delete({ where: { id } });
    await removeFile(file.storageKey);
    refresh();
  });
}

export async function deleteTask(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id });

    // 행은 cascade 로 함께 사라지지만 디스크 파일은 우리가 지워야 한다.
    const files = await prisma.attachment.findMany({
      where: { taskId: id },
      select: { storageKey: true },
    });
    await prisma.task.delete({ where: { id } }); // 세부 단계·첨부 행은 cascade
    for (const f of files) await removeFile(f.storageKey);
    refresh();
  });
}

export async function reorderTask(
  id: string,
  prevId: string | null,
  nextId: string | null,
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id });
    await prisma.task.update({ where: { id }, data: { order: await orderBetweenTasks(prevId, nextId) } });
    refresh();
  });
}

/* ── 세부 단계 ─────────────────────────────────────────────────── */

export async function createStep(taskId: string, title: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id: taskId });

    const last = await prisma.step.findFirst({
      where: { taskId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const step = await prisma.step.create({
      data: { taskId, title: cleanName(title, await defaultStepName()), order: orderAfter(last?.order ?? null) },
      select: { id: true },
    });
    refresh();
    return step;
  });
}

async function taskIdOfStep(stepId: string): Promise<string> {
  const step = await prisma.step.findUniqueOrThrow({ where: { id: stepId }, select: { taskId: true } });
  return step.taskId;
}

export async function updateStep(
  id: string,
  patch: { title?: string; isCompleted?: boolean },
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id: await taskIdOfStep(id) });

    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = cleanName(patch.title, await defaultStepName());
    if (patch.isCompleted !== undefined) data.isCompleted = patch.isCompleted;
    if (Object.keys(data).length === 0) return;

    await prisma.step.update({ where: { id }, data });
    refresh();
  });
}

export async function deleteStep(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "task", id: await taskIdOfStep(id) });
    await prisma.step.delete({ where: { id } });
    refresh();
  });
}
