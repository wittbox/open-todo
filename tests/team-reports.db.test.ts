import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getTeamReports, teamMemberIds } from "@/lib/queries/report";
import { dateOnly } from "@/lib/date";
import type { ReportContent } from "@/lib/report/aggregate";

/**
 * 팀 보고서 — 팀장만 본다. 팀원 = 나에게 보고서를 한 번이라도 공유한 사람(보고 관계).
 * 팀원끼리는 서로 공유하지 않는 한 보이지 않는다. 공유받지 않은 보고서의 제목·내용은 새지 않아야 한다.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);

const suffix = `team-${process.pid}-${Date.now()}`;
const W0 = dateOnly(2026, 9, 21);
const W1 = dateOnly(2026, 9, 28);
const W2 = dateOnly(2026, 10, 5);
const ids: Record<string, string> = {};

const content = (done: number, inProgress: number): ReportContent =>
  ({
    weekStart: "2026-10-05", weekEnd: "2026-10-11", rangeLabel: "", title: "t", summary: "", taskCount: done + inProgress,
    sections: [
      { key: "done", label: "완료", groups: [{ path: "g", owner: null, tasks: Array.from({ length: done }, (_, i) => task(`d${i}`)) }] },
      { key: "inProgress", label: "진행 중", groups: [{ path: "g", owner: null, tasks: Array.from({ length: inProgress }, (_, i) => task(`p${i}`)) }] },
      { key: "upcoming", label: "예정", groups: [] },
    ],
  }) as unknown as ReportContent;
const task = (id: string) => ({ id, seq: 1, title: id, listId: "l", path: "g", stepDone: 0, stepTotal: 0, dueDate: null, dueLabel: null, steps: [], comment: null, assignee: null, reason: "step" });

d("팀 보고서 (DB)", () => {
  beforeAll(async () => {
    const mk = (k: string, name: string) =>
      prisma.user.create({ data: { email: `${k}-${suffix}@x.test`, name, department: "같은부서" } });
    const lead = await mk("ld", "팀장");
    const a = await mk("a", "가팀원");
    const b = await mk("b", "나팀원");
    const loner = await mk("lo", "공유안한사람");

    const share = (subjectId: string, granteeUserId: string) =>
      prisma.share.create({ data: { subjectType: "REPORT", subjectId, granteeUserId, role: "VIEWER" } });

    // 가팀원: 지난주 발행본을 팀장에게 공유(→ 팀원), 이번 주 발행본은 아직 공유 안 함
    const aOld = await prisma.weeklyReport.create({ data: { authorId: a.id, weekStart: W1, title: "가 지난주", contentJson: content(3, 0), publishedAt: new Date() } });
    const aNew = await prisma.weeklyReport.create({ data: { authorId: a.id, weekStart: W2, title: "가 이번 주 비밀", contentJson: content(9, 9), publishedAt: new Date() } });
    await share(aOld.id, lead.id);
    // 나팀원: 이번 주 초안(쓰는 중), 예전 발행본을 팀장에게 공유
    const bOld = await prisma.weeklyReport.create({ data: { authorId: b.id, weekStart: W0, title: "나 옛날", contentJson: content(1, 1), publishedAt: new Date() } });
    const bDraft = await prisma.weeklyReport.create({ data: { authorId: b.id, weekStart: W2, title: "나 초안 제목" } });
    await share(bOld.id, lead.id);
    // 나팀원은 가팀원에게도 공유하지 않았다 — 팀원끼리는 서로 보이지 않는다.
    // 공유안한사람: 같은 부서지만 팀장에게 공유한 적이 없다.
    await prisma.weeklyReport.create({ data: { authorId: loner.id, weekStart: W2, title: "외톨이", publishedAt: new Date() } });
    // 팀장 본인 보고서
    const mine = await prisma.weeklyReport.create({ data: { authorId: lead.id, weekStart: W2, title: "팀장 보고서", contentJson: content(2, 1), publishedAt: new Date() } });

    Object.assign(ids, { lead: lead.id, a: a.id, b: b.id, loner: loner.id, aOld: aOld.id, aNew: aNew.id, bOld: bOld.id, bDraft: bDraft.id, mine: mine.id });
  });

  afterAll(async () => {
    if (!hasDb || !ids.lead) return;
    await prisma.share.deleteMany({ where: { subjectId: { in: [ids.aOld, ids.bOld] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.lead, ids.a, ids.b, ids.loner] } } });
  });

  it("팀원은 나에게 보고서를 공유한 적이 있는 사람 — 같은 부서라도 공유하지 않았으면 아니다", async () => {
    expect((await teamMemberIds(ids.lead)).sort()).toEqual([ids.a, ids.b].sort());
    expect(await teamMemberIds(ids.a)).toEqual([]);
    expect(await teamMemberIds(ids.loner)).toEqual([]);
  });

  it("팀장: 나를 맨 앞에, 공유받은 발행본만 제목·수까지 — 나머지는 상태만", async () => {
    const t = await getTeamReports(ids.lead, [W2, W1]);
    expect(t.members[0]).toMatchObject({ userId: ids.lead, isMe: true });
    expect(t.members.map((m) => m.userId).sort()).toEqual([ids.lead, ids.a, ids.b].sort());
    const c = (u: string, w: string) => t.cells[u][w];
    expect(c(ids.lead, "2026-10-05")).toMatchObject({ status: "published", reportId: ids.mine, counts: { done: 2, inProgress: 1, upcoming: 0 } });
    expect(c(ids.a, "2026-09-28")).toMatchObject({ status: "published", reportId: ids.aOld, title: "가 지난주", counts: { done: 3, inProgress: 0, upcoming: 0 } });
    expect(c(ids.a, "2026-10-05")).toMatchObject({ status: "published", reportId: null, title: null, counts: null });
    expect(c(ids.b, "2026-10-05")).toEqual({ status: "draft", reportId: null, title: null, publishedAt: null, counts: null });
    expect(c(ids.b, "2026-09-28").status).toBe("none");
    const json = JSON.stringify(t);
    for (const secret of ["가 이번 주 비밀", "나 초안 제목", "외톨이"]) expect(json).not.toContain(secret);
  });

  it("팀원(공유받은 적 없음)은 팀 보고서가 비어 있다", async () => {
    expect(await getTeamReports(ids.a, [W2])).toEqual({ members: [], weeks: ["2026-10-05"], cells: {} });
  });
});
