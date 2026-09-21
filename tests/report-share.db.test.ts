import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getSharedReport, listSharedReports } from "@/lib/queries/report";
import { renderReportEmailHtml, renderReportText } from "@/lib/report/email";
import { dateOnly } from "@/lib/date";
import type { ReportContent } from "@/lib/report/aggregate";

/**
 * 보고서 공유는 "발행된 것만, 읽기만" 이다.
 * 공개 링크를 없앤 뒤로 이 경계가 유일한 통제 지점이라 테스트로 고정한다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const suffix = `rshare-${process.pid}`;
const ids: Record<string, string> = {};

const content: ReportContent = {
  weekStart: "2026-08-03",
  weekEnd: "2026-08-09",
  rangeLabel: "2026-08-03 ~ 2026-08-09",
  title: "주간업무보고",
  summary: "요약",
  taskCount: 1,
  sections: [
    {
      key: "done",
      label: "이번 주 완료",
      groups: [
        {
          path: "그룹 › 목록",
          owner: null,
          tasks: [
            {
              id: "t1", seq: 1042, title: "기술문서 전달", listId: "l1", path: "그룹 › 목록",
              stepDone: 1, stepTotal: 1, dueDate: null, dueLabel: null,
              steps: ["수정본 전달"], comment: null, assignee: null, reason: "step",
            },
          ],
        },
      ],
    },
  ],
};

d("보고서 공유 (DB)", () => {
  beforeAll(async () => {
    const author = await prisma.user.create({
      data: { email: `a-${suffix}@x.test`, name: "작성자" },
    });
    const lead = await prisma.user.create({
      data: { email: `l-${suffix}@x.test`, name: "팀장" },
    });
    const stranger = await prisma.user.create({
      data: { email: `s-${suffix}@x.test`, name: "제3자" },
    });

    const published = await prisma.weeklyReport.create({
      data: {
        authorId: author.id, weekStart: dateOnly(2026, 8, 3), title: "발행본",
        contentJson: content, publishedAt: new Date(),
      },
    });
    const draft = await prisma.weeklyReport.create({
      data: { authorId: author.id, weekStart: dateOnly(2026, 7, 27), title: "초안" },
    });

    for (const subjectId of [published.id, draft.id]) {
      await prisma.share.create({
        data: { subjectType: "REPORT", subjectId, granteeUserId: lead.id, role: "VIEWER" },
      });
    }

    Object.assign(ids, {
      author: author.id, lead: lead.id, stranger: stranger.id,
      published: published.id, draft: draft.id,
    });
  });

  afterAll(async () => {
    if (!hasDb || !ids.author) return;
    await prisma.share.deleteMany({ where: { subjectId: { in: [ids.published, ids.draft] } } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.author, ids.lead, ids.stranger] } },
    });
  });

  it("공유받은 사람은 발행본을 읽는다", async () => {
    const r = await getSharedReport(ids.lead, ids.published);
    expect(r?.title).toBe("발행본");
    expect(r?.authorName).toBe("작성자");
  });

  it("초안은 공유가 걸려 있어도 열리지 않는다", async () => {
    expect(await getSharedReport(ids.lead, ids.draft)).toBeNull();
    expect((await listSharedReports(ids.lead)).map((r) => r.title)).toEqual(["발행본"]);
  });

  it("공유받지 않은 사람은 막힌다", async () => {
    expect(await getSharedReport(ids.stranger, ids.published)).toBeNull();
    expect(await listSharedReports(ids.stranger)).toEqual([]);
  });

  it("발행을 취소하면 공유가 남아 있어도 닫힌다", async () => {
    await prisma.weeklyReport.update({ where: { id: ids.published }, data: { publishedAt: null } });
    expect(await getSharedReport(ids.lead, ids.published)).toBeNull();
    expect(await listSharedReports(ids.lead)).toEqual([]);

    await prisma.weeklyReport.update({ where: { id: ids.published }, data: { publishedAt: new Date() } });
  });
});

describe("메일 본문에는 링크가 없다", () => {
  it("href 도 절대 URL 도 남기지 않는다", () => {
    const html = renderReportEmailHtml(content, { authorName: "작성자" });
    expect(html).not.toMatch(/href=/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('width="600"');
  });

  it("작업 번호는 평문으로 남는다", () => {
    const html = renderReportEmailHtml(content, { authorName: "작성자" });
    expect(html).toContain("#1042");
    expect(renderReportText(content)).toContain("#1042");
  });

  it("대체 텍스트 본문에도 링크가 없다", () => {
    expect(renderReportText(content)).not.toMatch(/https?:\/\//);
  });
});
