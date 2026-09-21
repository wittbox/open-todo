"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { assertCan, PermissionError } from "@/lib/permissions";
import { orderAfter, orderSequence } from "@/lib/ordering";
import { THEMES } from "@/lib/theme";
import type { ListSortBy } from "@/app/generated/prisma/enums";
import { cleanName, deleteSharesFor, orderBetweenLists, run, type ActionResult } from "./_helpers";
import { getRequestPrefs } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";

function refresh() {
  revalidatePath("/", "layout");
}

/** 저장되는 문구(기본 이름·복사본 이름)는 만든 사람의 언어로 남긴다. */
async function tasksText(key: string, values?: Record<string, string | number>): Promise<string> {
  const { locale } = await getRequestPrefs();
  return (translatorFor(locale) as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);
}

async function nextOrderIn(userId: string, groupId: string | null): Promise<string> {
  const last = await prisma.list.findFirst({
    where: groupId ? { groupId } : { ownerId: userId, groupId: null },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  return orderAfter(last?.order ?? null);
}

export async function createList(
  name: string,
  groupId: string | null = null,
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    if (groupId) await assertCan(userId, "manage", { kind: "group", id: groupId });

    const list = await prisma.list.create({
      data: {
        ownerId: userId,
        groupId,
        name: cleanName(name, await tasksText("tasks.defaults.list")),
        order: await nextOrderIn(userId, groupId),
      },
      select: { id: true },
    });
    refresh();
    return list;
  });
}

export async function renameList(id: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "list", id });
    await prisma.list.update({ where: { id }, data: { name: cleanName(name, await tasksText("tasks.defaults.list")) } });
    refresh();
  });
}

export async function deleteList(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "list", id });

    const list = await prisma.list.findUnique({ where: { id }, select: { isInbox: true } });
    // 사유를 적은 PermissionError 는 run() 이 그대로 내보내므로 여기서 번역해 둔다.
    if (list?.isInbox) throw new PermissionError(await tasksText("tasks.errors.inboxUndeletable"));

    await deleteSharesFor("LIST", id);
    await prisma.list.delete({ where: { id } }); // 작업·세부 단계는 cascade
    refresh();
  });
}

/** 목록 복제 — 작업과 세부 단계까지 복사한다. 완료 여부와 기한도 그대로 가져간다. */
export async function duplicateList(id: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "read", { kind: "list", id });

    const src = await prisma.list.findUniqueOrThrow({
      where: { id },
      include: { tasks: { orderBy: { order: "asc" }, include: { steps: { orderBy: { order: "asc" } } } } },
    });

    const copy = await prisma.list.create({
      data: {
        ownerId: userId,
        groupId: src.groupId,
        name: await tasksText("tasks.defaults.copy", { name: src.name }),
        themeKey: src.themeKey,
        backgroundKey: src.backgroundKey,
        sortBy: src.sortBy,
        showCompleted: src.showCompleted,
        showSeq: src.showSeq,
        order: await nextOrderIn(userId, src.groupId),
      },
      select: { id: true },
    });

    const taskOrders = orderSequence(Math.max(src.tasks.length, 1));
    for (const [i, t] of src.tasks.entries()) {
      const task = await prisma.task.create({
        data: {
          listId: copy.id,
          creatorId: userId,
          title: t.title,
          note: t.note,
          isImportant: t.isImportant,
          isCompleted: t.isCompleted,
          completedAt: t.completedAt,
          dueDate: t.dueDate,
          order: taskOrders[i],
        },
        select: { id: true },
      });
      if (t.steps.length) {
        const stepOrders = orderSequence(t.steps.length);
        await prisma.step.createMany({
          data: t.steps.map((s, si) => ({
            taskId: task.id,
            title: s.title,
            isCompleted: s.isCompleted,
            order: stepOrders[si],
          })),
        });
      }
    }

    refresh();
    return copy;
  });
}

/**
 * 목록을 다른 그룹으로 옮기거나(groupId) 그룹에서 빼낸다(null).
 * 대상 그룹에도 관리 권한이 있어야 한다.
 */
export async function moveListToGroup(id: string, groupId: string | null): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "list", id });
    if (groupId) await assertCan(userId, "manage", { kind: "group", id: groupId });

    await prisma.list.update({
      where: { id },
      data: { groupId, order: await nextOrderIn(userId, groupId) },
    });
    refresh();
  });
}

/**
 * 목록 보기 설정(정렬 · 완료 항목 표시 · 일련번호 표시).
 * 목록에 저장되므로 공유받은 사람에게도 똑같이 보인다. To Do 원본과 같은 동작이다.
 */
export async function updateListSettings(
  id: string,
  patch: { sortBy?: ListSortBy; showCompleted?: boolean; showSeq?: boolean; themeKey?: string },
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "write", { kind: "list", id });

    const data: Record<string, unknown> = {};
    if (patch.sortBy !== undefined) data.sortBy = patch.sortBy;
    if (patch.showCompleted !== undefined) data.showCompleted = patch.showCompleted;
    if (patch.showSeq !== undefined) data.showSeq = patch.showSeq;
    if (patch.themeKey !== undefined && patch.themeKey in THEMES) data.themeKey = patch.themeKey;
    if (Object.keys(data).length === 0) return;

    await prisma.list.update({ where: { id }, data });
    refresh();
  });
}

/** 드래그 정렬. 같은 컨테이너 안 이동과 그룹 간 이동을 함께 처리한다. */
export async function reorderList(
  id: string,
  groupId: string | null,
  prevId: string | null,
  nextId: string | null,
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "list", id });
    if (groupId) await assertCan(userId, "manage", { kind: "group", id: groupId });

    const order = await orderBetweenLists(prevId, nextId);
    await prisma.list.update({ where: { id }, data: { groupId, order } });
    refresh();
  });
}
