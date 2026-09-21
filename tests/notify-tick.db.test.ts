import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { dateOnly } from "@/lib/date";
import type { MailMessage } from "@/lib/mail";

/**
 * 매시 cron — "아침 8시" 와 "오늘" 은 받는 사람의 시간대로 본다.
 *
 * 서울 사람과 뉴욕 사람이 한 서버에 있다. 서울 8시에 뉴욕 사람에게 요약 메일이 가거나,
 * 뉴욕에서는 아직 어제인 일을 "오늘 기한" 으로 알리면 안 된다.
 */
const { sent } = vi.hoisted(() => ({ sent: [] as MailMessage[] }));
vi.mock("@/lib/mail", () => ({
  getMailProvider: () => ({
    name: "test",
    async send(msg: MailMessage) {
      sent.push(msg);
      return { ok: true };
    },
  }),
}));

const { runTick } = await import("@/lib/notify-tick");

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
const suffix = `tick-${process.pid}`;
const userIds: string[] = [];
const NY = "America/New_York";

/** 앱에 들어와 본 적 있는 사람 + 그 사람의 목록 */
async function person(key: string, timeZone?: string) {
  const user = await prisma.user.create({
    data: {
      email: `${key}-${suffix}@x.test`,
      name: key,
      lastLoginAt: new Date("2026-09-01T00:00:00Z"),
      settings: timeZone ? { timeZone } : {},
    },
  });
  userIds.push(user.id);
  const list = await prisma.list.create({ data: { ownerId: user.id, name: `L-${key}-${suffix}`, order: "a0" } });
  const task = (title: string, data: { dueDate?: Date; remindAt?: Date } = {}) =>
    prisma.task.create({ data: { listId: list.id, creatorId: user.id, title: `${title}-${suffix}`, order: "a0", ...data } });
  return { user, task };
}

const mailsTo = (email: string) => sent.filter((m) => m.to.includes(email));
const dueTodayOf = (userId: string) =>
  prisma.notification.findMany({ where: { userId, kind: "DUE_TODAY" }, select: { taskId: true, dayKey: true } });

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

d("아침 요약 메일은 각자 현지 평일 8시에 하루 한 통 (DB)", () => {
  it("서울 8시에 서울 사람만, 뉴욕 8시에 뉴욕 사람만 받는다", async () => {
    const seoul = await person("digest-seoul");
    const ny = await person("digest-ny", NY);
    // 보낼 거리가 있어야 메일이 나간다 — 둘 다 지난 기한이 하나씩.
    await seoul.task("지난일", { dueDate: dateOnly(2026, 9, 1) });
    await ny.task("지난일", { dueDate: dateOnly(2026, 9, 1) });
    const { email: s } = seoul.user;
    const { email: n } = ny.user;

    // 서울 9/18(금) 07:30 · 뉴욕 9/17(목) 18:30 — 뉴욕은 오늘 아침 몫을 이미 받았다고 해 둔다.
    await prisma.user.update({ where: { id: ny.user.id }, data: { lastDigestAt: new Date("2026-09-17T12:10:00Z") } });
    await runTick(new Date("2026-09-17T22:30:00Z"));
    expect([mailsTo(s).length, mailsTo(n).length]).toEqual([0, 0]);

    // 서울 08:10 — 서울 사람 차례
    await runTick(new Date("2026-09-17T23:10:00Z"));
    expect([mailsTo(s).length, mailsTo(n).length]).toEqual([1, 0]);
    expect(mailsTo(s)[0].subject).toContain("9월 18일 (금)");

    // 서울 09:10 — 같은 날 두 번 보내지 않는다
    sent.length = 0;
    await runTick(new Date("2026-09-18T00:10:00Z"));
    expect([mailsTo(s).length, mailsTo(n).length]).toEqual([0, 0]);

    // 뉴욕 9/18(금) 08:10 — 뉴욕 사람 차례. 서울은 이미 밤 9시라 오늘 몫을 받았다.
    await runTick(new Date("2026-09-18T12:10:00Z"));
    expect([mailsTo(s).length, mailsTo(n).length]).toEqual([0, 1]);
    expect(mailsTo(n)[0].subject).toContain("9월 18일 (금)");

    // 뉴욕 9/19(토) 08:10 — 주말에는 쉰다
    sent.length = 0;
    await runTick(new Date("2026-09-19T12:10:00Z"));
    expect(mailsTo(n)).toHaveLength(0);
  });

  it("요약의 '오늘 울릴 알림' 은 그 사람의 하루(현지 자정~자정)다 — UTC 하루가 아니다", async () => {
    const ny = await person("digest-remind", NY);
    // 뉴욕 9/17 23:00 — UTC 로는 이미 9/18 이지만 뉴욕 사람에게는 오늘 밤이다.
    await ny.task("밤알림", { remindAt: new Date("2026-09-18T03:00:00Z") });
    // 뉴욕 9/16 22:00 — UTC 로는 9/17 이지만 뉴욕 사람에게는 어제다.
    await ny.task("어제알림", { remindAt: new Date("2026-09-17T02:00:00Z") });

    await runTick(new Date("2026-09-17T12:10:00Z")); // 뉴욕 9/17(목) 08:10
    const [mail] = mailsTo(ny.user.email);
    expect(mail?.text).toContain(`밤알림-${suffix}`);
    expect(mail?.text).toContain("오후 11:00");
    expect(mail?.text).not.toContain(`어제알림-${suffix}`);
  });
});

d("기한이 오늘인 알림은 챙길 사람의 오늘·아침 8시 (DB)", () => {
  it("서울은 9/18 기한을, 뉴욕은 아직 9/17 기한을 오늘로 본다", async () => {
    const seoul = await person("due-seoul");
    const ny = await person("due-ny", NY);
    const s18 = await seoul.task("서울18", { dueDate: dateOnly(2026, 9, 18) });
    const n17 = await ny.task("뉴욕17", { dueDate: dateOnly(2026, 9, 17) });
    await ny.task("뉴욕18", { dueDate: dateOnly(2026, 9, 18) });

    // 서울 07:10 — 서울은 아직 이르다. 뉴욕은 9/17 18:10 이라 9/17 기한이 오늘이다.
    await runTick(new Date("2026-09-17T22:10:00Z"));
    expect(await dueTodayOf(seoul.user.id)).toEqual([]);
    expect(await dueTodayOf(ny.user.id)).toEqual([{ taskId: n17.id, dayKey: "2026-09-17" }]);

    // 서울 08:10 — 서울 9/18 기한. 뉴욕의 9/18 기한은 아직 내일이다.
    await runTick(new Date("2026-09-17T23:10:00Z"));
    expect(await dueTodayOf(seoul.user.id)).toEqual([{ taskId: s18.id, dayKey: "2026-09-18" }]);
    expect(await dueTodayOf(ny.user.id)).toHaveLength(1);
  });
});

d("끝난 메일 링크 청소 (DB)", () => {
  it("하루 넘게 지난 쓰인·만료된 링크는 지우고, 살아 있는 것은 둔다", async () => {
    const email = `tokens-${suffix}@x.test`;
    const now = new Date("2026-09-18T00:00:00Z");
    const old = new Date("2026-09-16T00:00:00Z");
    const mk = (tokenHash: string, data: { usedAt?: Date; expiresAt: Date }) =>
      prisma.verificationToken.create({ data: { purpose: "VERIFY_EMAIL", tokenHash: `${tokenHash}-${suffix}`, email, ...data } });
    await mk("used", { usedAt: old, expiresAt: new Date("2026-09-20T00:00:00Z") });
    await mk("expired", { expiresAt: old });
    await mk("alive", { expiresAt: new Date("2026-09-18T12:00:00Z") });
    await runTick(now);
    const left = await prisma.verificationToken.findMany({ where: { email }, select: { tokenHash: true } });
    expect(left.map((t) => t.tokenHash)).toEqual([`alive-${suffix}`]);
    await prisma.verificationToken.deleteMany({ where: { email } });
  });
});
