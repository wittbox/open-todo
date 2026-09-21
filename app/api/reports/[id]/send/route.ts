import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { deliverReport } from "@/lib/report/deliver";
import { checkScheduleAt } from "@/lib/report/schedule";
import { getRequestPrefs, getRequestTimeZone } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";
import { crossSiteRejected, isCrossSiteRequest } from "@/lib/http";
import { checkReportMailQuota } from "@/lib/report/mail-quota";
import { getMailProvider } from "@/lib/mail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 주간보고서 메일 발송 — 지금 보내거나, 예약한다.
 *
 * 되돌릴 수 없는 외부 발신이라 클라이언트가 미리보기와 수신자 확인을 거친 뒤 부른다.
 * 결과는 성공·실패·예약 모두 ReportSend 에 남긴다.
 *
 * 예약은 여기서 저장만 한다. 실제 발송은 5분마다 도는 처리기가 같은 발송 모듈
 * (lib/report/deliver.ts)로 한다 — 지금 보낸 것과 예약한 것이 다른 메일이 되지 않게.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/reports/[id]/send">) {
  if (isCrossSiteRequest(req.headers)) return crossSiteRejected();
  const t = translatorFor((await getRequestPrefs()).locale);
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });

  const { id } = await ctx.params;
  const report = await prisma.weeklyReport.findUnique({
    where: { id },
    select: {
      id: true,
      authorId: true,
      title: true,
      contentJson: true,
      publishedAt: true,
      author: { select: { name: true, email: true, emailVerifiedAt: true } },
    },
  });

  // 남의 보고서와 없는 보고서를 구분하지 않는다.
  if (!report || report.authorId !== userId) {
    return NextResponse.json({ error: t("reports.errors.notFound") }, { status: 404 });
  }
  if (!report.contentJson || !report.publishedAt) {
    return NextResponse.json({ error: t("reports.errors.publishFirst") }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    to?: unknown;
    attachPdf?: unknown;
    scheduleAt?: unknown;
  };
  const to = Array.isArray(body.to)
    ? [...new Set(body.to.filter((v): v is string => typeof v === "string").map((v) => v.trim()))]
    : [];
  // 기본은 붙인다. 보내기 창에서 끈 경우만 본문만 보낸다.
  const attachPdf = body.attachPdf !== false;

  if (to.length === 0) return NextResponse.json({ error: t("reports.errors.noRecipients") }, { status: 400 });

  const bad = to.filter((a) => !EMAIL_RE.test(a));
  if (bad.length > 0) {
    return NextResponse.json({ error: t("reports.errors.badEmails", { list: bad.join(", ") }) }, { status: 400 });
  }

  // 누구나 가입하는 설치에서 이 앱이 스팸 중계가 되지 않게 — 확인된 이메일·한 번에 몇 명·하루 몇 명.
  const quota = await checkReportMailQuota({ userId, verified: Boolean(report.author.emailVerifiedAt), recipients: to.length });
  if (quota) return NextResponse.json({ error: quota.error }, { status: quota.status });

  // ── 예약 ──
  if (body.scheduleAt != null) {
    const check = checkScheduleAt(body.scheduleAt, new Date(), await getRequestTimeZone());
    if (!check.ok) {
      const message = (t as unknown as (k: string, v?: Record<string, number>) => string)(check.key, check.values);
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const row = await prisma.reportSend.create({
      data: {
        reportId: id,
        toEmails: to,
        subject: report.title,
        status: "SCHEDULED",
        scheduledAt: check.at,
        attachPdf,
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, scheduled: true, id: row.id, scheduledAt: check.at.toISOString() });
  }

  // ── 지금 ──
  const result = await deliverReport(
    {
      id: report.id,
      title: report.title,
      authorId: report.authorId,
      authorName: report.author.name,
      authorEmail: report.author.email,
      publishedAt: report.publishedAt,
      contentJson: report.contentJson,
    },
    to,
    attachPdf,
  );

  if (!result.ok && result.stage === "pdf") {
    return NextResponse.json(
      { error: t("reports.errors.pdfFailedSend") },
      { status: 500 },
    );
  }

  await prisma.reportSend.create({
    data: {
      reportId: id,
      toEmails: to,
      subject: report.title,
      status: result.ok ? "SENT" : "FAILED",
      errorMsg: result.ok ? null : result.error,
      attachPdf,
    },
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, to, mock: getMailProvider().name === "mock" });
}
