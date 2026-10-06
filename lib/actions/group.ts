"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { assertCan } from "@/lib/permissions";
import { orderAfter } from "@/lib/ordering";
import { ActionError, cleanName, deleteSharesFor, orderBetweenGroups, run, type ActionResult } from "./_helpers";
import { getRequestPrefs } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";

function refresh() {
  revalidatePath("/", "layout");
}

/** 저장되는 기본 이름은 만든 사람의 언어로 남긴다. */
async function defaultGroupName(): Promise<string> {
  const { locale } = await getRequestPrefs();
  return translatorFor(locale)("tasks.defaults.group");
}

export async function createGroup(name: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const last = await prisma.group.findFirst({
      where: { ownerId: userId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const group = await prisma.group.create({
      data: { ownerId: userId, name: cleanName(name, await defaultGroupName()), order: orderAfter(last?.order ?? null) },
      select: { id: true },
    });
    refresh();
    return group;
  });
}

export async function renameGroup(id: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "group", id });
    await prisma.group.update({ where: { id }, data: { name: cleanName(name, await defaultGroupName()) } });
    refresh();
  });
}

/**
 * 그룹 삭제 — **빈 그룹만**. 목록은 늘 그룹 안에 있어야 하므로, 예전의 '그룹 해제'(안의 목록을
 * 최상위로 올리기)는 없앴다. 목록이 남아 있으면 다른 그룹으로 옮기거나 지운 뒤에 지운다.
 */
export async function deleteGroup(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "group", id });

    const count = await prisma.list.count({ where: { groupId: id } });
    if (count > 0) throw ActionError.key("tasks.errors.groupNotEmpty", { count });

    await deleteSharesFor("GROUP", id);
    await prisma.group.delete({ where: { id } });
    refresh();
  });
}

export async function reorderGroup(
  id: string,
  prevId: string | null,
  nextId: string | null,
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "group", id });
    const order = await orderBetweenGroups(prevId, nextId);
    await prisma.group.update({ where: { id }, data: { order } });
    refresh();
  });
}
