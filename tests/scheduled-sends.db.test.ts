import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

/**
 * 예약 발송 처리기의 한살이.
 *
 * 외부로 나가는 메일이라 한 번 잘못되면 되돌릴 수 없다. 그래서 두 가지를 특히 본다.
 *   1. 처리기 두 번이 겹쳐도 한 통만 나간다(집어 들기).
 *   2. 실패는 세 번까지만 다시 시도하고, 그다음엔 멈추고 작성자에게 알린다.
 * 메일 발송은 가짜로 바꿔 끼운다.
 */

const sent: { to: string[]; userId: string }[] = [];
let failNext = 0;

vi.mock("@/lib/mail", () => ({
  getMailProvider: () => ({
    name: "test",
    async send(msg: { to: string[] }, userId: string) {
      if (failNext > 0) {
        failNext -= 1;
        return { ok: false as const, error: "메일 서버에 연결하지 못했습니다." };
      }
      sent.push({ to: msg.to, userId });
      return { ok: true as const };
    },
  }),
}));

// 알림 발송 경로의 다른 부수효과는 이 테스트의 관심사가 아니다.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { runScheduledSends } = await import("@/lib/report/scheduled-sends");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

let authorId = "";
let reportId = "";

const CONTENT = {
  weekStart: "2026-09-07", weekEnd: "2026-09-13", rangeLabel: "9/7(월) ~ 9/11(금)",
  title: "주간업무보고", summary: "", taskCount: 0, sections: [],
};

async function schedule(at: Date, extra: Record<string, unknown> = {}) {
  return prisma.reportSend.create({
    data: {
      reportId, toEmails: ["boss@x.test"], subject: "주간업무보고",
      status: "SCHEDULED", scheduledAt: at, attachPdf: false, ...extra,
    },
    select: { id: true },
  });
}

const status = async (id: string) =>
  prisma.reportSend.findUniqueOrThrow({ where: { id }, select: { status: true, attempts: true, errorMsg: true } });

d("예약 발송 처리기", () => {
  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: `sched-${suffix}@x.test`, name: "작성자" },
    });
    authorId = u.id;
    const r = await prisma.weeklyReport.create({
      data: {
        authorId, weekStart: new Date("2026-09-07T00:00:00.000Z"), title: `예약-${suffix}`,
        contentJson: CONTENT, publishedAt: new Date(),
      },
      select: { id: true },
    });
    reportId = r.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: authorId } });
    await prisma.reportSend.deleteMany({ where: { reportId } });
    await prisma.weeklyReport.deleteMany({ where: { id: reportId } });
    await prisma.user.deleteMany({ where: { id: authorId } });
  });

  beforeEach(async () => {
    sent.length = 0;
    failNext = 0;
    await prisma.reportSend.deleteMany({ where: { reportId } });
    await prisma.weeklyReport.update({ where: { id: reportId }, data: { publishedAt: new Date() } });
  });

  it("때가 된 예약을 작성자 이름으로 보내고 '발송' 으로 남긴다", async () => {
    const now = new Date("2026-09-11T08:05:00.000Z");
    const row = await schedule(new Date("2026-09-11T08:00:00.000Z"));

    const r = await runScheduledSends(now);

    expect(r.sent).toBe(1);
    expect(sent).toEqual([{ to: ["boss@x.test"], userId: authorId }]);
    expect((await status(row.id)).status).toBe("SENT");
  });

  it("아직 때가 안 된 예약은 건드리지 않는다", async () => {
    const row = await schedule(new Date("2026-09-11T09:00:00.000Z"));
    await runScheduledSends(new Date("2026-09-11T08:05:00.000Z"));
    expect(sent).toHaveLength(0);
    expect((await status(row.id)).status).toBe("SCHEDULED");
  });

  it("다른 처리기가 이미 집어 든 예약은 다시 보내지 않는다", async () => {
    // 처리기 두 번이 겹치면, 조건부 갱신(SCHEDULED → SENDING)에 성공한 쪽만 보낸다.
    // 로컬 개발 DB(prisma dev, 연결 하나)는 진짜 동시 쿼리를 받지 못해(08P01) 겹침 자체를
    // 재현할 수 없다. 대신 "이미 집어 든 상태"를 만들어 두고 두 번째 처리기의 입장에서 본다.
    const row = await schedule(new Date("2026-09-11T08:00:00.000Z"), {
      status: "SENDING",
      attempts: 1,
      sentAt: new Date("2026-09-11T08:04:00.000Z"),
    });

    const r = await runScheduledSends(new Date("2026-09-11T08:05:00.000Z"));

    expect(r.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect((await status(row.id)).status).toBe("SENDING");
  });

  it("발행이 취소됐으면 보내지 않고 '취소' 로 멈춘다 — 실패가 아니다", async () => {
    await prisma.weeklyReport.update({ where: { id: reportId }, data: { publishedAt: null } });
    const row = await schedule(new Date("2026-09-11T08:00:00.000Z"));

    const r = await runScheduledSends(new Date("2026-09-11T08:05:00.000Z"));

    expect(r.canceled).toBe(1);
    expect(sent).toHaveLength(0);
    expect((await status(row.id)).status).toBe("CANCELED");
  });

  it("실패하면 10분 뒤 다시 시도하고, 세 번 다 실패하면 멈추고 알린다", async () => {
    const at = new Date("2026-09-11T08:00:00.000Z");
    const row = await schedule(at);
    failNext = 3;

    await runScheduledSends(new Date("2026-09-11T08:05:00.000Z"));
    expect(await status(row.id)).toMatchObject({ status: "SCHEDULED", attempts: 1 });

    // 10분이 안 지났으면 다시 하지 않는다
    await runScheduledSends(new Date("2026-09-11T08:08:00.000Z"));
    expect((await status(row.id)).attempts).toBe(1);

    await runScheduledSends(new Date("2026-09-11T08:10:00.000Z"));
    expect(await status(row.id)).toMatchObject({ status: "SCHEDULED", attempts: 2 });

    const last = await runScheduledSends(new Date("2026-09-11T08:20:00.000Z"));
    expect(last.failed).toBe(1);
    expect(await status(row.id)).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(sent).toHaveLength(0);

    const n = await prisma.notification.findMany({ where: { userId: authorId, kind: "REPORT_SEND_FAILED" } });
    expect(n).toHaveLength(1);
    expect(n[0].reportId).toBe(reportId);
  });

  it("한 번 실패했다가 다음에 성공하면 '발송' 이다", async () => {
    const row = await schedule(new Date("2026-09-11T08:00:00.000Z"));
    failNext = 1;
    await runScheduledSends(new Date("2026-09-11T08:05:00.000Z"));
    await runScheduledSends(new Date("2026-09-11T08:15:00.000Z"));
    expect(await status(row.id)).toMatchObject({ status: "SENT", attempts: 2, errorMsg: null });
    expect(sent).toHaveLength(1);
  });

  it("처리 도중 멈춘 '보내는 중' 은 15분 뒤 다시 줄에 선다", async () => {
    const row = await schedule(new Date("2026-09-11T08:00:00.000Z"), {
      status: "SENDING",
      attempts: 1,
      sentAt: new Date("2026-09-11T08:00:00.000Z"),
    });
    await runScheduledSends(new Date("2026-09-11T08:20:00.000Z"));
    expect((await status(row.id)).status).toBe("SENT");
  });

  it("사람이 취소한 예약은 나가지 않는다", async () => {
    const row = await schedule(new Date("2026-09-11T08:00:00.000Z"), { status: "CANCELED" });
    await runScheduledSends(new Date("2026-09-11T08:05:00.000Z"));
    expect(sent).toHaveLength(0);
    expect((await status(row.id)).status).toBe("CANCELED");
  });
});
