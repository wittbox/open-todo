import Link from "next/link";
import { Icon } from "@/components/icons";
import { ReportBody } from "@/lib/report/render";
import type { ReportContent } from "@/lib/report/aggregate";
import type { ReadableReport } from "@/lib/queries/report";
import { getFormatter, getTranslations } from "next-intl/server";

/**
 * 공유받은 보고서. 발행된 스냅샷을 읽기만 한다.
 * 작업 번호는 평문이다 — 보고서 열람권과 작업 접근권은 별개이고, 번호를 링크로
 * 걸어 두면 권한 없는 사람이 눌러 보고 "권한 없음"만 반복해서 만난다.
 * 원본을 봐야 하면 해당 목록을 따로 공유받아야 한다.
 */
export async function SharedReportView({ report }: { report: ReadableReport }) {
  const content = report.content as ReportContent;
  const format = await getFormatter();
  const t = await getTranslations("reports");

  return (
    <section className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-pane-bg py-4 md:py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-3 flex w-[820px] max-w-[92vw] items-center gap-3 print:hidden">
        <Link href="/reports" className="flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
          <Icon name="chevronRight" size={14} className="rotate-180" />
          {t("shared.title")}
        </Link>
        <span className="ml-auto rounded-full bg-pane-bg px-2.5 py-1 text-xs text-ink-2">
          {t("shared.badge")}
        </span>
      </div>

      <article className="mx-auto w-[820px] max-w-[92vw] border border-[#e1dfdd] bg-white px-4 py-6 md:px-12 md:py-10 shadow-[0_1px_4px_rgba(0,0,0,.08)] print:w-full print:max-w-none print:border-0 print:shadow-none">
        <header className="mb-5 border-b-[3px] border-[#4f52b2] pb-3.5">
          <h1 className="text-2xl font-semibold">{content.title}</h1>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {content.rangeLabel} · {report.authorName}
          </p>
        </header>

        <ReportBody content={content} />

        <footer className="mt-8 border-t border-divider pt-3.5 text-xs leading-relaxed text-ink-2">
          {t("shared.publishedNote", {
            date: format.dateTime(new Date(report.publishedAt), { dateStyle: "medium", timeStyle: "short" }),
          })}
          <br />
          {t("shared.deepLinkNote")}
        </footer>
      </article>
    </section>
  );
}
