"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { assertCan } from "@/lib/permissions";
import { orderAfter } from "@/lib/ordering";
import { cleanName, deleteSharesFor, orderBetweenGroups, run, type ActionResult } from "./_helpers";
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
 * 그룹 해제 — 그룹만 없애고 안에 있던 목록은 최상위로 올린다.
 * 목록을 함께 지우지 않는 것이 To Do 원본 동작이다.
 */
export async function ungroupGroup(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await assertCan(userId, "manage", { kind: "group", id });

    const lists = await prisma.list.findMany({
      where: { groupId: id },
      orderBy: { order: "asc" },
      select: { id: true },
    });

    let cursor = (
      await prisma.list.findFirst({
        where: { ownerId: userId, groupId: null },
        orderBy: { order: "desc" },
        select: { order: true },
      })
    )?.order ?? null;

    for (const l of lists) {
      cursor = orderAfter(cursor);
      await prisma.list.update({ where: { id: l.id }, data: { groupId: null, order: cursor } });
    }

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
