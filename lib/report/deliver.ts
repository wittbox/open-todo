import { getMailProvider } from "@/lib/mail";
import type { MailAttachment } from "@/lib/mail/provider";
import { renderReportEmailHtml, renderReportText } from "@/lib/report/email";
import { renderReportPdf } from "@/lib/report/pdf";
import { reportPdfFileName } from "@/lib/report/filename";
import type { ReportContent } from "@/lib/report/aggregate";
import { getUserPrefs } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";
import { appName } from "@/lib/brand-server";

/**
 * 발행된 보고서 한 통을 실제로 내보낸다.
 *
 * "지금 보내기"(발송 라우트)와 예약 발송(5분 주기 처리기)이 같은 길로 나가야
 * 둘이 서로 다른 메일을 만들지 않는다. 그래서 본문·PDF·발송을 여기 한 곳에 둔다.
 *
 * 보낸 사람 주소는 설치 주소(MAIL_FROM)이고, 이름만 "작성자 (앱 이름)" 으로 보인다. 답장은 작성자에게 간다
 * (Reply-To). 작성자 주소로 직접 보내면 받는 쪽 메일 서버가 SPF/DMARC 로 막는다.
 * 호출부가 발신자를 고를 수 없게 인자로 받지 않는다 — 예약 발송도 작성자의 이름으로만 나간다.
 */

export type DeliverableReport = {
  id: string;
  title: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  publishedAt: Date | null;
  contentJson: unknown;
};

export type DeliverResult =
  | { ok: true }
  | { ok: false; stage: "unpublished" | "pdf" | "mail"; error: string };

export async function deliverReport(
  report: DeliverableReport,
  to: string[],
  attachPdf: boolean,
): Promise<DeliverResult> {
  // 보고서 메일은 작성자의 언어로 나간다 — 받는 사람은 앱 밖에 있을 수 있다.
  const [{ locale, timeZone }, app] = await Promise.all([getUserPrefs(report.authorId), appName()]);
  const t = translatorFor(locale);
  if (!report.publishedAt || !report.contentJson) {
    return { ok: false, stage: "unpublished", error: t("reports.errors.unpublished") };
  }
  const content = report.contentJson as ReportContent;

  // 본문과 같은 스냅샷으로 PDF 를 만든다. 못 만들면 보내지 않는다 — 첨부를 약속한
  // 발송이 조용히 본문만 가면, 받는 사람도 보낸 사람도 모른 채 넘어간다.
  let attachments: MailAttachment[] | undefined;
  if (attachPdf) {
    try {
      const pdf = await renderReportPdf(content, { authorName: report.authorName, issuedAt: report.publishedAt, timeZone, locale, app });
      attachments = [
        { filename: reportPdfFileName(content, report.authorName), contentType: "application/pdf", data: pdf },
      ];
    } catch (e) {
      console.error("[report-pdf]", e);
      return { ok: false, stage: "pdf", error: t("reports.errors.pdfFailed") };
    }
  }

  const result = await getMailProvider().send(
    {
      to,
      subject: report.title,
      html: renderReportEmailHtml(content, { authorName: report.authorName, app }),
      text: renderReportText(content),
      attachments,
      fromName: `${report.authorName} (${app})`,
      replyTo: report.authorEmail,
    },
    report.authorId,
  );
  return result.ok ? { ok: true } : { ok: false, stage: "mail", error: result.error };
}
