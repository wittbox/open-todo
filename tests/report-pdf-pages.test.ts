import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderReportPdf } from "@/lib/report/pdf";
import type { ReportContent, ReportTask } from "@/lib/report/aggregate";

/**
 * PDF 쪽 넘김.
 *
 * '예정' 제목과 파란 줄만 1쪽 끝에 남고 내용은 2쪽으로 넘어간 적이 있다(2026-09-11 신고).
 * 이 환경에서는 PDF 를 그림으로 볼 수 없으니, 쪽마다 글자를 뽑아 "구간 제목과 그 첫 작업이
 * 같은 쪽에 있는가" 를 본다. 앞 구간의 줄 수를 한 줄씩 늘려 가며 여러 번 그리므로
 * 제목이 쪽 끝에 걸리는 경우가 반드시 한 번은 생긴다.
 */

function task(seq: number, title: string): ReportTask {
  return {
    id: `t${seq}`, seq, title, listId: "l", path: "", stepDone: 0, stepTotal: 0,
    dueDate: null, dueLabel: null, steps: [], comment: null, assignee: null, reason: "due",
  };
}

function content(inProgressRows: number): ReportContent {
  return {
    weekStart: "2026-09-07", weekEnd: "2026-09-13", rangeLabel: "9/7(월) ~ 9/11(금)",
    title: "주간업무보고", summary: "", taskCount: inProgressRows + 2,
    sections: [
      {
        key: "inProgress", label: "진행 중",
        groups: [{
          path: "제품 출하 › 출하검사", owner: null,
          tasks: Array.from({ length: inProgressRows }, (_, i) => task(100 + i, `진행작업${i}`)),
        }],
      },
      {
        key: "upcoming", label: "예정",
        groups: [{ path: "해외 › 해외 수출", owner: null, tasks: [task(143, "출고준비"), task(144, "현지설치")] }],
      },
    ],
  };
}

// 글자만 뽑을 거라 필요 없지만, 지정하지 않으면 pdfjs 가 쪽마다 경고를 남긴다.
// pdfjs 는 끝이 "/" 인 주소를 요구한다. 윈도우 경로의 역슬래시는 받지 않는다.
const STANDARD_FONTS = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts").split(path.sep).join("/") + "/";

async function pagesText(buf: Uint8Array): Promise<string[]> {
  const task = getDocument({
    data: buf,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
  });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = await page.getTextContent();
    pages.push(text.items.map((it) => ("str" in it ? it.str : "")).join(""));
  }
  await task.destroy();
  return pages;
}

describe("PDF 쪽 넘김", () => {
  it("글자를 뽑아낼 수 있다 — 아래 검사가 헛돌지 않는지 먼저 본다", async () => {
    const pages = await pagesText(new Uint8Array(await renderReportPdf(content(3), { authorName: "홍길동", issuedAt: new Date() })));
    expect(pages.join("")).toContain("출고준비");
  });

  it("구간 제목은 언제나 그 구간의 첫 작업과 같은 쪽에 있다", async () => {
    let brokeAcrossPages = false;

    for (let n = 26; n <= 46; n++) {
      const buf = await renderReportPdf(content(n), { authorName: "홍길동", issuedAt: new Date() });
      const pages = await pagesText(new Uint8Array(buf));
      if (pages.length > 1) brokeAcrossPages = true;

      // pdfjs 는 제목과 건수 사이의 빈칸을 따로 한 조각으로 뽑는다.
      const headPage = pages.findIndex((p) => /예정\s*2건/.test(p));
      const firstPage = pages.findIndex((p) => p.includes("출고준비"));
      expect({ n, headPage }).toEqual({ n, headPage: firstPage });
    }

    // 한 번도 쪽이 넘어가지 않았다면 이 검사는 아무것도 증명하지 못한다.
    expect(brokeAcrossPages).toBe(true);
  }, 60_000);
});
