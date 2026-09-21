import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { HOME_PATH } from "@/lib/home";

/** "작업"은 사용자별 기본 목록이다. 실제 목록 화면으로 넘긴다. */
export default async function TasksPage() {
  const userId = await requireUserId();
  const inbox = await prisma.list.findFirst({
    where: { ownerId: userId, isInbox: true },
    select: { id: true },
  });
  if (!inbox) redirect(HOME_PATH);
  redirect(`/list/${inbox.id}`);
}
