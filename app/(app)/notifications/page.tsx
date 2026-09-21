import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireUserId } from "@/lib/session";
import { pageTitle } from "@/lib/brand-server";
import { prisma } from "@/lib/db";
import { listNotifications } from "@/lib/queries/notifications";
import { NotificationList } from "@/components/notifications/NotificationList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications");
  return { title: await pageTitle(t("title")) };
}

export default async function NotificationsPage() {
  const userId = await requireUserId();
  const [items, me] = await Promise.all([
    listNotifications(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { dailyMail: true } }),
  ]);

  return <NotificationList items={items} dailyMail={me?.dailyMail ?? true} />;
}
