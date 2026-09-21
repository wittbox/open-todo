import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { deliverReport } from "@/lib/report/deliver";
import { MAX_ATTEMPTS, RETRY_AFTER_MIN } from "@/lib/report/schedule";

/**
 * 예약 발송 처리기. 5분마다 한 번 불린다(/api/cron/sends).
 *
 * 한 예약의 한살이:
 *
 *   SCHEDULED ──(때가 됨, 집어 듦)──> SENDING ──> SENT
 *       ^                                 │
 *       └──(실패, 아직 기회 남음)──────────┤
 *                                         ├──> FAILED   (3번 다 실패 → 작성자에게 앱 알림)
 *                                         └──> CANCELED (보낼 발행본이 사라짐)
 *
 * 보내는 내용은 보내는 시각의 발행본이다. 예약 뒤 고치고 다시 발행하면 고친 내용이
 * 나간다 — 금요일 오후에 예약해 두고 마지막에 한 번 더 손보는 쓰임새를 살렸다.
 */

export type SendsResult = { sent: number; retried: number; failed: number; canceled: number };

/** 한 번에 처리하는 예약 수. 5분 안에 끝나야 다음 차례와 겹치지 않는다. */
const BATCH = 20;
/** SENDING 에 이만큼 머물렀으면 처리기가 도중에 죽은 것이다. 다시 줄 세운다. */
const STUCK_AFTER_MIN = 15;
const MIN = 60_000;

/** 다시 시도할 때는 원래 예약 시각을 바꾸지 않는다 — 이력에 "17:00 예약분" 이 그대로 남아야 한다. */
export function isDue(row: { scheduledAt: Date | null; attempts: number }, now: Date): boolean {
  if (!row.scheduledAt) return false;
  return row.scheduledAt.getTime() + row.attempts * RETRY_AFTER_MIN * MIN <= now.getTime();
}

export async function runScheduledSends(now: Date = new Date()): Promise<SendsResult> {
  const result: SendsResult = { sent: 0, retried: 0, failed: 0, canceled: 0 };

  // 처리 도중 서버가 재시작되면 SENDING 에 영원히 머문다. 다시 줄에 세운다.
  // 한 번 더 나갈 수 있지만, 영영 안 나가는 것보다 낫다 — 메일 서버가 받았는지 모르는 상태다.
  await prisma.reportSend.updateMany({
    where: { status: "SENDING", sentAt: { lt: new Date(now.getTime() - STUCK_AFTER_MIN * MIN) } },
    data: { status: "SCHEDULED" },
  });

  const candidates = await prisma.reportSend.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: BATCH * 3,
    select: { id: true, scheduledAt: true, attempts: true },
  });

  for (const c of candidates.filter((r) => isDue(r, now)).slice(0, BATCH)) {
    // 집어 든다. 두 처리기가 겹쳐도 상태를 바꾸는 데 성공한 쪽만 보낸다.
    const claimed = await prisma.reportSend.updateMany({
      where: { id: c.id, status: "SCHEDULED" },
      data: { status: "SENDING", sentAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    const row = await prisma.reportSend.findUnique({
      where: { id: c.id },
      select: {
        toEmails: true,
        attachPdf: true,
        attempts: true,
        report: {
          select: {
            id: true, title: true, authorId: true, publishedAt: true, contentJson: true,
            author: { select: { name: true, email: true } },
          },
        },
      },
    });
    if (!row) continue;
    const r = row.report;

    const res = await deliverReport(
      {
        id: r.id,
        title: r.title,
        authorId: r.authorId,
        authorName: r.author.name,
        authorEmail: r.author.email,
        publishedAt: r.publishedAt,
        contentJson: r.contentJson,
      },
      row.toEmails,
      row.attachPdf,
    );

    if (res.ok) {
      await prisma.reportSend.update({
        where: { id: c.id },
        // 제목은 보낸 순간의 것으로 남긴다. 예약 뒤 제목을 고쳤을 수 있다.
        data: { status: "SENT", subject: r.title, errorMsg: null, sentAt: new Date() },
      });
      result.sent += 1;
      continue;
    }

    if (res.stage === "unpublished") {
      // 보낼 발행본이 없다. 실패가 아니라 멈춘 것이다 — 다시 시도해도 결과는 같다.
      await prisma.reportSend.update({
        where: { id: c.id },
        data: { status: "CANCELED", errorMsg: res.error },
      });
      result.canceled += 1;
      continue;
    }

    if (row.attempts < MAX_ATTEMPTS) {
      await prisma.reportSend.update({
        where: { id: c.id },
        data: { status: "SCHEDULED", errorMsg: res.error },
      });
      result.retried += 1;
      continue;
    }

    await prisma.reportSend.update({
      where: { id: c.id },
      data: { status: "FAILED", errorMsg: res.error },
    });
    // 메일로는 알리지 않는다 — 메일이 막혀서 실패했을 수 있다.
    await notify({ userId: r.authorId, kind: "REPORT_SEND_FAILED", reportId: r.id });
    result.failed += 1;
  }

  return result;
}
