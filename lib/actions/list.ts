"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { assertCan, PermissionError } from "@/lib/permissions";
import { orderAfter, orderSequence } from "@/lib/ordering";
import { THEMES } from "@/lib/theme";
import type { ListSortBy } from "@/app/generated/prisma/enums";
import { ActionError, cleanName, deleteSharesFor, orderBetweenLists, run, type ActionResult } from "./_helpers";
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

/**
 * 목록은 늘 그룹 안에 있다(기본 목록만 예외). 그 전에 그룹 밖에 있던 목록은 마이그레이션
 * `20261006000000_lists_always_in_group` 이 주인마다 '기타' 그룹으로 모았다.
 * 그룹 밖으로 내보내는 길(빼기·해제·끌어 놓기)은 모두 닫혀 있다 — 화면만이 아니라 여기서도.
 */
function requireGroupId(groupId: string | null | undefined): string {
  if (!groupId) throw ActionError.key("tasks.errors.needsGroup");
  return groupId;
}

async function nextOrderIn(groupId: string): Promise<string> {
  const last = await prisma.list.findFirst({
    where: { groupId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  return orderAfter(last?.order ?? null);
}

/** 내 그룹들 맨 아래에 그룹 하나를 만든다('새 그룹' 버튼과 같은 자리). */
async function createOwnGroup(userId: string, name: string): Promise<string> {
  const last = await prisma.group.findFirst({
    where: { ownerId: userId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const group = await prisma.group.create({
    data: {
      ownerId: userId,
      name: cleanName(name, await tasksText("tasks.defaults.group")),
      order: orderAfter(last?.order ?? null),
    },
    select: { id: true },
  });
  return group.id;
}

/**
 * 목록 만들기. 들어갈 그룹은 이미 있는 그룹(`groupId`)이거나, 같이 만들 새 그룹 이름(`newGroupName`)이다 —
 * 그룹이 하나도 없는 사람도 '새 목록' 한 번으로 그룹과 목록을 함께 만든다.
 */
export async function createList(
  name: string,
  target: { groupId: string } | { newGroupName: string },
): Promise<ActionResult<{ id: string; groupId: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    let groupId: string;
    if ("groupId" in target) {
      groupId = requireGroupId(target.groupId);
      await assertCan(userId, "manage", { kind: "group", id: groupId });
    } else {
      if (!target.newGroupName?.trim()) throw ActionError.key("tasks.errors.groupNameRequired");
      groupId = await createOwnGroup(userId, target.newGroupName);
    }

    const list = await prisma.list.create({
      data: {
        ownerId: userId,
        groupId,
        name: cleanName(name, await tasksText("tasks.defaults.list")),
        order: await nextOrderIn(groupId),
      },
      select: { id: true },
    });
    refresh();
    return { id: list.id, groupId };
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

    // 복사본도 그룹 안에 둔다 — 원본 그룹이 내 것이면 거기, 아니면(공유받은 목록·기본 목록) 내 그룹 맨 아래,
    // 내 그룹이 하나도 없으면 '기타' 를 만든다. 예전에는 남의 그룹 id 를 그대로 달고 생겼다.
    const groupId = await groupForCopy(userId, src.groupId);

    const copy = await prisma.list.create({
      data: {
        ownerId: userId,
        groupId,
        name: await tasksText("tasks.defaults.copy", { name: src.name }),
        themeKey: src.themeKey,
        backgroundKey: src.backgroundKey,
        sortBy: src.sortBy,
        showCompleted: src.showCompleted,
        showSeq: src.showSeq,
        order: await nextOrderIn(groupId),
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

async function groupForCopy(userId: string, srcGroupId: string | null): Promise<string> {
  if (srcGroupId) {
    const g = await prisma.group.findUnique({ where: { id: srcGroupId }, select: { ownerId: true } });
    if (g?.ownerId === userId) return srcGroupId;
  }
  const last = await prisma.group.findFirst({
    where: { ownerId: userId },
    orderBy: { order: "desc" },
    select: { id: true },
  });
  return last?.id ?? (await createOwnGroup(userId, await tasksText("tasks.defaults.otherGroup")));
}

/**
 * 목록을 다른 그룹으로 옮긴다. 그룹 밖으로는 옮길 수 없다(목록은 늘 그룹 안).
 * 대상 그룹에도 관리 권한이 있어야 한다.
 */
export async function moveListToGroup(id: string, groupId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const target = requireGroupId(groupId);
    await assertCan(userId, "manage", { kind: "list", id });
    await assertCan(userId, "manage", { kind: "group", id: target });

    await prisma.list.update({
      where: { id },
      data: { groupId: target, order: await nextOrderIn(target) },
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
  groupId: string,
  prevId: string | null,
  nextId: string | null,
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const target = requireGroupId(groupId);
    await assertCan(userId, "manage", { kind: "list", id });
    await assertCan(userId, "manage", { kind: "group", id: target });

    const order = await orderBetweenLists(prevId, nextId);
    await prisma.list.update({ where: { id }, data: { groupId: target, order } });
    refresh();
  });
}
