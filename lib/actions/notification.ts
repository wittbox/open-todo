"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { run, type ActionResult } from "./_helpers";

/** 알림은 받는 사람 것이다. 남의 알림은 건드릴 수 없다. */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/", "layout");
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/", "layout");
  });
}

/** 아침 요약 메일을 받을지. 개인별 설정이다. */
export async function setDailyMail(on: boolean): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await prisma.user.update({ where: { id: userId }, data: { dailyMail: on } });
    revalidatePath("/", "layout");
  });
}
