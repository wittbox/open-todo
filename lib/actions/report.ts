"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { PermissionError } from "@/lib/permissions";
import { dateOnlyFromString, weekStartOf } from "@/lib/date";
import { buildReport } from "@/lib/report/aggregate";
import { EMPTY_SCOPE, getReportSource, parseScope, type ReportScope } from "@/lib/queries/report";
import { run, type ActionResult } from "./_helpers";
import { getRequestPrefs } from "@/lib/prefs";
import { formatterFor, translatorFor } from "@/i18n/server";

function refresh() {
  revalidatePath("/reports", "layout");
}

/** 편집·발행·발송은 작성자만. 공유받은 사람은 읽기만 한다(lib/queries/report.ts). */
async function ownReport(userId: string, id: string) {
  const r = await prisma.weeklyReport.findUnique({
    where: { id },
    select: { id: true, authorId: true, weekStart: true, title: true, summary: true, scopeJson: true, publishedAt: true },
  });
  if (!r || r.authorId !== userId) throw new PermissionError();
  return r;
}

/**
 * 기본 제목. "주간업무보고 - 제품팀 8월 14일" 꼴이다.
 *
 * 날짜는 그 주 금요일 하나만 쓴다 — 기간은 본문 머리글이 요일과 함께 보여 주므로
 * 제목에서까지 되풀이하면 같은 정보가 두 줄로 겹친다.
 *
 * 소속은 사용자가 설정에 적은 값이다. 비어 있으면 작성자 이름을 쓴다.
 */
async function defaultReportTitle(userId: string, weekStart: Date): Promise<string> {
  const [user, { locale }] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, department: true } }),
    getRequestPrefs(),
  ]);
  const friday = new Date(weekStart.getTime() + 4 * 86_400_000);
  const who = user?.department || user?.name || "";
  const date = formatterFor(locale, "UTC").dateTime(friday, { month: "long", day: "numeric", timeZone: "UTC" });
  return translatorFor(locale)("reports.defaultTitle", { who, date }).replace("  ", " ");
}

/** 해당 주차 보고서를 열거나 없으면 만든다. */
export async function openReport(weekStartStr: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const userId = await requireUserId();
    const weekStart = weekStartOf(dateOnlyFromString(weekStartStr));

    const existing = await prisma.weeklyReport.findUnique({
      where: { authorId_weekStart: { authorId: userId, weekStart } },
      select: { id: true },
    });
    if (existing) return existing;

    const created = await prisma.weeklyReport.create({
      data: {
        authorId: userId,
        weekStart,
        title: await defaultReportTitle(userId, weekStart),
        scopeJson: EMPTY_SCOPE,
      },
      select: { id: true },
    });
    refresh();
    return created;
  });
}

export async function updateReport(
  id: string,
  patch: { title?: string; summary?: string; scope?: Partial<ReportScope> },
): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const report = await ownReport(userId, id);

    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const t = patch.title.trim().slice(0, 200);
      if (t) data.title = t;
    }
    if (patch.summary !== undefined) data.summary = patch.summary.slice(0, 4000);
    if (patch.scope) {
      const current = parseScope(report.scopeJson);
      data.scopeJson = { ...current, ...patch.scope } satisfies ReportScope;
    }

    if (Object.keys(data).length === 0) return;
    await prisma.weeklyReport.update({ where: { id }, data });
    refresh();
  });
}

/**
 * 발행 — 지금 집계한 내용을 스냅샷으로 굳힌다.
 * 이후 원본 작업이 바뀌어도 보고서는 그대로다. 다시 발행하면 새로 굳힌다.
 * 공유받은 사람에게 보이는 것도, 메일로 나가는 것도 이 스냅샷이다.
 */
export async function publishReport(id: string): Promise<ActionResult<void>> {
  return run(async () => {
    const userId = await requireUserId();
    const report = await ownReport(userId, id);
    const scope = parseScope(report.scopeJson);

    const { tasks } = await getReportSource(userId, report.weekStart, scope);
    const { locale, timeZone } = await getRequestPrefs();
    const content = buildReport(tasks, report.weekStart, {
      timeZone,
      locale,
      title: report.title,
      summary: report.summary,
      excludedTaskIds: scope.excludedTaskIds,
      comments: scope.comments,
      // 손으로 옮긴 구간도 함께 굳힌다. 빠뜨리면 편집 화면과 발행본이 어긋난다.
      sections: scope.sections,
    });

    await prisma.weeklyReport.update({
      where: { id },
      data: { contentJson: content, publishedAt: new Date() },
    });
    refresh();
  });
}

/** 발행 취소. 스냅샷과 공유받은 사람의 열람이 함께 닫힌다. */
export async function unpublishReport(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await ownReport(userId, id);
    await prisma.weeklyReport.update({
      where: { id },
      data: { publishedAt: null },
    });
    refresh();
  });
}

export async function deleteReport(id: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await ownReport(userId, id);
    await prisma.share.deleteMany({ where: { subjectType: "REPORT", subjectId: id } });
    await prisma.weeklyReport.delete({ where: { id } });
    refresh();
  });
}

/* ── 공유 ──────────────────────────────────────────────────────── */

/**
 * 보고서 공유는 읽기 전용이고 작성자만 관리한다.
 * 공유받은 사람이 다시 남에게 넘기지 못하게 하려는 것이다.
 */
export async function shareReport(id: string, granteeUserId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const report = await ownReport(userId, id);
    if (granteeUserId === report.authorId) {
      throw new PermissionError(translatorFor((await getRequestPrefs()).locale)("reports.errors.cannotShareAuthor"));
    }

    await prisma.share.upsert({
      where: {
        subjectType_subjectId_granteeUserId: {
          subjectType: "REPORT",
          subjectId: id,
          granteeUserId,
        },
      },
      create: {
        subjectType: "REPORT",
        subjectId: id,
        granteeUserId,
        role: "VIEWER",
        invitedById: userId,
      },
      update: { role: "VIEWER" },
    });
    refresh();
  });
}

export async function unshareReport(id: string, granteeUserId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    const report = await prisma.weeklyReport.findUnique({
      where: { id },
      select: { authorId: true },
    });
    if (!report) throw new PermissionError();

    // 작성자가 거두거나, 공유받은 사람이 스스로 빠지거나.
    if (report.authorId !== userId && granteeUserId !== userId) throw new PermissionError();

    await prisma.share.deleteMany({
      where: { subjectType: "REPORT", subjectId: id, granteeUserId },
    });
    refresh();
  });
}

/**
 * 예약 발송 취소.
 *
 * 아직 기다리는 예약만 취소된다. 보내는 중이거나 이미 나간 것은 되돌릴 수 없는
 * 외부 발신이라 손대지 않는다 — 조건부 갱신이라 처리기와 동시에 눌려도 한쪽만 이긴다.
 * 이미 지나간 예약을 누른 경우는 오류로 만들지 않는다. 새로 고친 화면이 실제 상태를 보여 준다.
 */
export async function cancelScheduledSend(reportId: string, sendId: string): Promise<ActionResult> {
  return run(async () => {
    const userId = await requireUserId();
    await ownReport(userId, reportId);
    await prisma.reportSend.updateMany({
      where: { id: sendId, reportId, status: "SCHEDULED" },
      data: { status: "CANCELED", errorMsg: translatorFor((await getRequestPrefs()).locale)("reports.errors.scheduleCanceled") },
    });
    refresh();
  });
}
