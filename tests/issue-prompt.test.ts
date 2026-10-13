import { describe, expect, it } from "vitest";
import { buildIssuePrompt } from "@/lib/issues/prompt";
import { translatorFor } from "@/i18n/server";
import type { Translate } from "@/lib/projects/format";

const tOf = (locale: "ko" | "en"): Translate => (k, v) => (translatorFor(locale) as unknown as Translate)(`issues.${k}`, v);
const tKo = tOf("ko");

/**
 * 이슈 → Claude Code 프롬프트(2026-10-13). 머리말 + 본문, 본문 사진은 임시 링크, 요청 단락 없음.
 */
const issue = {
  ref: "BUG-3",
  title: "표의 기준 칸이 좁음",
  body: "## 재현 순서\r\n1. 기준 칸이 좁다\r\n<@u1234567890123456789> 확인 부탁\r\n## 기대 결과\n모든 글자가 보임",
  status: "OPEN" as const,
  priority: "LOW" as const,
  labelIds: ["bug"],
  dueDate: null,
  createdAt: "2026-10-13T02:15:00.000Z",
  assignee: { id: "a", name: "이준", avatarColor: "#000" },
  reporter: { id: "r", name: "김하늘", avatarColor: "#000" },
  people: [{ userId: "u1234567890123456789", name: "박지민" }],
  attachments: [
    { id: "f1", name: "화면.png", size: 34 * 1024, mimeType: "image/png", uploaderName: null, createdAt: "" },
    { id: "f2", name: "로그.txt", size: 120, mimeType: "text/plain", uploaderName: null, createdAt: "" },
  ],
};

describe("buildIssuePrompt", () => {
  it("머리말 · 본문(소제목 그대로, 멘션은 @이름) · 사진 링크 · 그 밖의 첨부, 요청 단락은 없다", () => {
    const text = buildIssuePrompt({
      issue,
      projectName: "품질 개선",
      labels: [{ id: "bug", name: "버그" }, { id: "x", name: "질문" }],
      url: "https://todo.test/i/BUG-3",
      images: [{ name: "화면.png", size: 34 * 1024, url: "https://todo.test/api/shared-file/f1?e=1&s=abc" }],
      t: tKo,
    });
    expect(text).toBe(
      [
        "# BUG-3 표의 기준 칸이 좁음",
        "",
        "- 프로젝트: 품질 개선 · 상태: 열림 · 우선순위: 낮음 · 라벨: 버그",
        "- 보고자: 김하늘 · 담당자: 이준 · 열린 날: 2026-10-13",
        "- 링크: https://todo.test/i/BUG-3",
        "",
        "## 재현 순서",
        "1. 기준 칸이 좁다",
        "@박지민 확인 부탁",
        "## 기대 결과",
        "모든 글자가 보임",
        "",
        "## 첨부 사진 (24시간 동안 열리는 링크 — 내려받아 보세요)",
        "- 화면.png (34 KB): https://todo.test/api/shared-file/f1?e=1&s=abc",
        "",
        "## 그 밖의 첨부 (이슈 화면에서 받기)",
        "- 로그.txt (120 B)",
        "",
      ].join("\n"),
    );
  });

  it("사진·첨부·라벨이 없으면 그 줄도 없다. 빈 본문은 ‘(본문 없음)’", () => {
    const text = buildIssuePrompt({
      issue: { ...issue, body: "  ", labelIds: [], attachments: [], assignee: null, dueDate: "2026-10-20" },
      projectName: "품질 개선",
      labels: [],
      url: "https://todo.test/i/BUG-3",
      images: [],
      t: tKo,
    });
    expect(text).toContain("우선순위: 낮음\n");
    expect(text).toContain("담당자: 없음 · 기한: 2026-10-20 · 열린 날");
    expect(text).toContain("(본문 없음)");
    expect(text).not.toContain("## 첨부");
  });

  it("영어로 복사하면 머리말도 영어", () => {
    const text = buildIssuePrompt({ issue, projectName: "QA", labels: [], url: "https://todo.test/i/BUG-3", images: [], t: tOf("en") });
    expect(text).toContain("- Project: QA · Status: Open · Priority: Low\n");
    expect(text).toContain("- Reporter: 김하늘 · Assignee: 이준 · Opened: 2026-10-13");
  });
});
