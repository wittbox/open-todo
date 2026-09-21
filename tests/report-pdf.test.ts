import { describe, expect, it } from "vitest";
import { renderReportPdf } from "@/lib/report/pdf";
import { reportPdfFileName } from "@/lib/report/filename";
import type { ReportContent } from "@/lib/report/aggregate";

/**
 * 주간보고서 PDF.
 *
 * 모양은 사람이 눈으로 본다. 여기서는 눈으로 보기 전에 깨지는 것만 막는다 —
 * 글꼴이 이미지에서 빠지면 한글이 전부 네모가 되는데, PDF 는 그래도 "만들어진다".
 * 그래서 파일이 생겼는지가 아니라 글꼴이 실제로 들어갔는지를 본다.
 */

const content: ReportContent = {
  weekStart: "2026-09-07",
  weekEnd: "2026-09-13",
  rangeLabel: "9/7(월) ~ 9/11(금)",
  title: "주간업무보고 (09-07~09-13)",
  summary: "보완자료 1차 제출.",
  taskCount: 1,
  sections: [
    {
      key: "done",
      label: "이번 주 완료",
      groups: [
        {
          path: "해외 › [해외] 신제품 수출",
          owner: null,
          tasks: [
            {
              id: "t1", seq: 141, title: "계약서 서명", listId: "l1", path: "해외 › [해외] 신제품 수출",
              stepDone: 0, stepTotal: 0, dueDate: null, dueLabel: "9/9(수)", steps: [],
              comment: "원본은 우편으로", assignee: null, reason: "step",
            },
          ],
        },
      ],
    },
  ],
};

describe("PDF 렌더", () => {
  it("한글 글꼴을 문서 안에 넣는다", async () => {
    const buf = await renderReportPdf(content, { authorName: "홍길동", issuedAt: new Date("2026-09-11T08:00:00Z") });
    const raw = Buffer.from(buf).toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    // 글꼴을 못 찾으면 기본 Helvetica 로 떨어지고 한글은 전부 네모가 된다.
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Pretendard/);
    expect(raw).toContain("/FontFile2");
  });

  it("쓴 글자만 담아 가볍다", async () => {
    const buf = await renderReportPdf(content, { authorName: "홍길동", issuedAt: new Date() });
    // 글꼴 원본은 2.7MB 다. 통째로 들어갔다면 이 크기를 한참 넘는다.
    expect(buf.length).toBeLessThan(200_000);
  });
});

describe("첨부 파일 이름", () => {
  it("보고서·작성자·주 시작일", () => {
    expect(reportPdfFileName(content, "홍길동")).toBe("주간업무보고_홍길동_2026-09-07.pdf");
  });

  it("파일 이름에 못 쓰는 글자와 공백은 지운다", () => {
    expect(reportPdfFileName(content, "홍 길/동")).toBe("주간업무보고_홍길동_2026-09-07.pdf");
  });

  it("이름이 비면 자리만 채운다", () => {
    expect(reportPdfFileName(content, "  ")).toBe("주간업무보고_작성자_2026-09-07.pdf");
  });
});
