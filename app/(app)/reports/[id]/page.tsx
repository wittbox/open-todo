import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { pageTitle } from "@/lib/brand-server";
import { requireUserId } from "@/lib/session";
import { ALL_GROUPS_SCOPE, getReportSource, getSharedReport, parseScope } from "@/lib/queries/report";
import { dateOnlyToString } from "@/lib/date";
import { ReportEditor } from "@/components/report/ReportEditor";
import { SharedReportView } from "@/components/report/SharedReportView";
import { NotFoundPane } from "@/components/list-view/NotFoundPane";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");
  return { title: await pageTitle(t("navTitle")) };
}

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const { id } = await params;
  const userId = await requireUserId();

  const report = await prisma.weeklyReport.findUnique({
    where: { id },
    select: {
      id: true, authorId: true, weekStart: true, title: true, summary: true,
      scopeJson: true, publishedAt: true,
      author: { select: { name: true } },
      sends: {
        orderBy: { sentAt: "desc" },
        select: {
          id: true, toEmails: true, sentAt: true, status: true, errorMsg: true,
          scheduledAt: true, attachPdf: true,
        },
      },
    },
  });

  // 작성자가 아니면 공유받았는지 본다. 둘 다 아니면 없는 것과 같게 취급한다.
  if (!report || report.authorId !== userId) {
    const shared = await getSharedReport(userId, id);
    if (!shared) return <NotFoundPane />;
    return <SharedReportView report={shared} />;
  }

  const scope = parseScope(report.scopeJson);
  // 후보는 전부 넘기고 범위 필터는 화면에서 즉시 반영한다.
  const { tasks, groups } = await getReportSource(userId, report.weekStart, {
    ...scope,
    ...ALL_GROUPS_SCOPE,
  });

  const shares = await prisma.share.findMany({
    where: { subjectType: "REPORT", subjectId: id },
    orderBy: { createdAt: "asc" },
    select: { grantee: { select: { id: true, name: true, email: true, avatarColor: true } } },
  });

  return (
    <ReportEditor
      reportId={report.id}
      authorName={report.author.name}
      weekStart={dateOnlyToString(report.weekStart)}
      initialTitle={report.title}
      initialSummary={report.summary}
      scope={scope}
      groups={groups}
      tasks={tasks}
      publishedAt={report.publishedAt?.toISOString() ?? null}
      baseUrl={process.env.APP_BASE_URL ?? "http://localhost:3000"}
      sends={pendingFirst(report.sends).map((s) => ({
        id: s.id,
        toEmails: s.toEmails,
        sentAt: s.sentAt.toISOString(),
        status: s.status,
        errorMsg: s.errorMsg,
        scheduledAt: s.scheduledAt?.toISOString() ?? null,
        attachPdf: s.attachPdf,
      }))}
      sharedWith={shares.map((s) => ({
        userId: s.grantee.id,
        name: s.grantee.name,
        email: s.grantee.email,
        avatarColor: s.grantee.avatarColor,
      }))}
    />
  );
}

/**
 * 기다리는 예약을 맨 위에, 가까운 순으로. 나머지는 최근 순.
 * 앞으로 일어날 일이 지나간 일 아래 묻히면 예약해 둔 걸 잊는다.
 */
function pendingFirst<T extends { status: string; scheduledAt: Date | null; sentAt: Date }>(rows: T[]): T[] {
  const pending = rows.filter((r) => r.status === "SCHEDULED" || r.status === "SENDING");
  const rest = rows.filter((r) => !pending.includes(r));
  pending.sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
  return [...pending, ...rest];
}
