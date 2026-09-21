import type { ReportContent } from "@/lib/report/aggregate";
import { translatorFor } from "@/i18n/server";

/**
 * 첨부 PDF 의 파일 이름.
 *
 * 받는 사람이 폴더에 모아 둬도 날짜순으로 정렬되게 주 시작일을 붙인다.
 * 보내기 창(브라우저)과 발송 라우트(서버)가 같은 이름을 보여 줘야 해서, PDF 렌더러와
 * 떨어진 이 파일에 둔다 — 렌더러는 글꼴을 fs 로 읽는 서버 전용이라 창에서 못 부른다.
 */
export function reportPdfFileName(content: Pick<ReportContent, "weekStart" | "locale">, authorName: string): string {
  // 파일 이름에 쓸 수 없는 글자와 공백은 지운다.
  const who = authorName.replace(/[\\/:*?"<>|\s]+/g, "");
  const t = translatorFor(content.locale ?? "ko");
  return t("reports.pdf.fileName", { who: who || t("reports.pdf.author"), date: content.weekStart });
}
