import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { getAssignedView } from "@/lib/queries/tasks";
import { getTaskDetail } from "@/lib/queries/list";
import { getListRole, ROLE_RANK } from "@/lib/permissions";
import { SMART_VIEW_THEMES } from "@/lib/theme";
import { SmartView } from "@/components/list-view/SmartView";
import { DetailPane } from "@/components/detail-pane/DetailPane";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: await pageTitle(t("assigned.title")) };
}

export default async function AssignedPage({ searchParams }: PageProps<"/assigned">) {
  const t = await getTranslations("tasks");
  const userId = await requireUserId();
  const q = await searchParams;
  const data = await getAssignedView(userId);

  const inbox = await prisma.list.findFirst({
    where: { ownerId: userId, isInbox: true },
    select: { id: true },
  });

  const selectedId = typeof q.task === "string" ? q.task : null;
  const detail = selectedId ? await getTaskDetail(userId, selectedId) : null;
  const detailRole = detail ? await getListRole(userId, detail.listId) : null;

  return (
    <>
      <SmartView
        colors={SMART_VIEW_THEMES.assigned}
        title={t("assigned.title")}
        titleIcon="person"
        meId={userId}
        sections={[{ label: null, tasks: data.open }]}
        done={data.done}
        writableTaskIds={[...data.open, ...data.done]
          .filter((t) => data.writableListIds.has(t.listId))
          .map((t) => t.id)}
        addTo={inbox ? { listId: inbox.id, label: t("addTask") } : null}
        emptyMessage={
          <>
            {t("assigned.emptyLine1")}
            <br />
            {t("assigned.emptyLine2")}
          </>
        }
      />
      {detail && detailRole && (
        <DetailPane key={detail.id} task={detail} canWrite={ROLE_RANK[detailRole] >= ROLE_RANK.EDITOR} />
      )}
    </>
  );
}
