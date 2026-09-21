import { prisma } from "@/lib/db";
import { addDays, dateOnly, dateOnlyToString, dayStart } from "@/lib/date";
import { DATE_ONLY } from "@/lib/format";
import { formatterFor, translatorFor } from "@/i18n/server";
import type { AppLocale } from "@/i18n/locales";
import { notify } from "@/lib/notify";
import { getMailProvider } from "@/lib/mail";
import { appName } from "@/lib/brand-server";
import { getUsersPrefs, prefsFromSettings } from "@/lib/prefs";
import { zonedParts } from "@/lib/tz";

/**
 * 정해진 시각에 해야 하는 일.
 *
 * 이 앱은 누가 접속할 때만 움직이므로, 아침 8시에 무언가를 보내려면 밖에서
 * 한 번 두드려 줘야 한다. 서버의 cron 이 매시 /api/cron/tick 을 부른다.
 *
 * "아침 8시" 와 "오늘" 은 받는 사람의 시간대로 본다 — 서울 사람은 서울 8시, 뉴욕 사람은 뉴욕 8시에 받는다.
 *
 * 여러 번 불려도 같은 결과가 되도록 만들었다 — cron 이 겹치거나 재시도해도
 * 알림이 두 번 생기거나 메일이 두 통 나가지 않는다.
 */

const KEEP_NOTIFICATION_DAYS = 30;

/** 아침 알림·요약 메일을 보내기 시작하는 현지 시각 */
const MORNING_HOUR = 8;

export type TickResult = {
  reminders: number;
  dueToday: number;
  digests: number;
  cleaned: number;
};

/** 그 시간대의 지금 — 오늘(날짜 전용 값), 몇 시, 무슨 요일(일=0) */
function localNow(now: Date, tz: string) {
  const p = zonedParts(now, tz);
  return { today: dateOnly(p.year, p.month, p.day), hour: p.hour, weekday: p.weekday };
}

/** 작업을 챙길 사람 — 담당자, 없으면 만든 사람 */
const ownerOf = (t: { assigneeId: string | null; creatorId: string | null }) => t.assigneeId ?? t.creatorId;

export async function runTick(now: Date = new Date()): Promise<TickResult> {
  const result: TickResult = { reminders: 0, dueToday: 0, digests: 0, cleaned: 0 };

  // 1. 지정한 미리 알림 시각이 지난 것. 날짜 열쇠는 받는 사람의 오늘(notify 가 정한다).
  const due = await prisma.task.findMany({
    where: {
      isCompleted: false,
      remindAt: { not: null, lte: now },
      OR: [{ remindedAt: null }, { remindedAt: { lt: prisma.task.fields.remindAt } }],
    },
    select: { id: true, assigneeId: true, creatorId: true },
    take: 500,
  });
  for (const t of due) {
    const userId = ownerOf(t);
    if (userId) {
      await notify({ userId, kind: "REMINDER", taskId: t.id });
      result.reminders += 1;
    }
    await prisma.task.update({ where: { id: t.id }, data: { remindedAt: now } });
  }

  // 2. 기한이 오늘인 것 — 챙길 사람의 아침 8시가 지나면 한 번.
  //    "오늘" 이 사람마다 다르다. 어느 시간대든 현지 날짜는 UTC 날짜의 앞뒤 하루 안이라
  //    그만큼 넉넉히 읽고, 챙길 사람의 오늘과 같은 것만 남긴다.
  const utcToday = dateOnly(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  const nearDue = await prisma.task.findMany({
    where: { isCompleted: false, dueDate: { gte: addDays(utcToday, -1), lte: addDays(utcToday, 1) } },
    select: { id: true, dueDate: true, assigneeId: true, creatorId: true },
    take: 1500,
  });
  const owners = await getUsersPrefs(nearDue.map(ownerOf).filter((id): id is string => id != null));
  for (const t of nearDue) {
    const userId = ownerOf(t);
    const prefs = userId ? owners.get(userId) : undefined;
    if (!userId || !prefs || !t.dueDate) continue;
    const local = localNow(now, prefs.timeZone);
    if (local.hour < MORNING_HOUR || t.dueDate.getTime() !== local.today.getTime()) continue;
    await notify({ userId, kind: "DUE_TODAY", taskId: t.id, dayKey: dateOnlyToString(local.today) });
    result.dueToday += 1;
  }

  // 3. 아침 요약 메일 — 각자 평일 8시 이후, 각자의 하루에 한 통
  result.digests = await sendDigests(now);

  // 4. 오래된 알림 청소
  const cleaned = await prisma.notification.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - KEEP_NOTIFICATION_DAYS * 86_400_000) } },
  });
  result.cleaned = cleaned.count;

  // 5. 끝난 메일 링크 청소 — 쓰였거나 만료된 것. 가입 대기 중인 링크에는 비밀번호 해시가 들어 있어 오래 두지 않는다.
  const day = new Date(now.getTime() - 86_400_000);
  await prisma.verificationToken.deleteMany({ where: { OR: [{ usedAt: { lt: day } }, { expiresAt: { lt: day } }] } });

  return result;
}

async function sendDigests(now: Date): Promise<number> {
  // 한 번이라도 앱에 들어와 본 사람에게만 보낸다. 초대만 받고 들어온 적 없는 사람은
  // 이 앱을 쓴 적이 없으므로, 남이 뭔가를 맡겼다는 이유로 메일부터 받게 하지 않는다.
  const users = await prisma.user.findMany({
    where: { dailyMail: true, lastLoginAt: { not: null }, disabledAt: null },
    select: { id: true, email: true, settings: true, lastDigestAt: true },
  });

  const app = await appName();
  let sent = 0;
  for (const u of users) {
    const { locale, timeZone } = prefsFromSettings(u.settings);
    const local = localNow(now, timeZone);
    if (local.weekday < 1 || local.weekday > 5 || local.hour < MORNING_HOUR) continue;
    // 그 사람의 오늘 자정 뒤에 이미 보냈으면 오늘 몫은 끝났다.
    if (u.lastDigestAt && u.lastDigestAt >= dayStart(local.today, timeZone)) continue;

    const content = await digestFor(u.id, local.today, timeZone, locale, app);
    if (!content) continue;

    const res = await getMailProvider().send(
      {
        to: [u.email],
        subject: translatorFor(locale)("notifications.digest.subject", {
          date: formatterFor(locale, "UTC").dateTime(local.today, DATE_ONLY),
        }),
        html: content.html,
        text: content.text,
      },
      u.id,
    );
    // 실패해도 다음 사람으로 넘어간다. 한 사람의 주소가 틀렸다고 나머지가 못 받으면 안 된다.
    if (!res.ok) {
      console.error(`[tick] digest mail failed for ${u.email}: ${res.error}`);
      continue;
    }
    await prisma.user.update({ where: { id: u.id }, data: { lastDigestAt: now } });
    sent += 1;
  }
  return sent;
}

type Line = { title: string; note: string };

/** 보낼 것이 없으면 null. 빈 메일은 보내지 않는다. `today` 는 받는 사람 시간대(`tz`)의 오늘. */
async function digestFor(userId: string, today: Date, tz: string, locale: AppLocale, app: string): Promise<{ html: string; text: string } | null> {
  const t = translatorFor(locale);
  const format = formatterFor(locale, "UTC");
  const mine = { OR: [{ assigneeId: userId }, { assigneeId: null, creatorId: userId }] };

  const [overdue, dueToday, reminders] = await Promise.all([
    prisma.task.findMany({
      where: { isCompleted: false, dueDate: { lt: today }, ...mine },
      select: { title: true, dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: { isCompleted: false, dueDate: today, ...mine },
      select: { title: true },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        isCompleted: false,
        // 그 사람의 하루(현지 자정~자정) 안에 울릴 것
        remindAt: { gte: dayStart(today, tz), lt: dayStart(addDays(today, 1), tz) },
        ...mine,
      },
      select: { title: true, remindAt: true },
      take: 20,
    }),
  ]);

  if (overdue.length + dueToday.length + reminders.length === 0) return null;

  const sections: { label: string; color: string; lines: Line[] }[] = [
    {
      label: t("notifications.digest.overdue", { count: overdue.length }),
      color: "#a4262c",
      lines: overdue.map((task) => ({ title: task.title, note: task.dueDate ? format.dateTime(task.dueDate, DATE_ONLY) : "" })),
    },
    {
      label: t("notifications.digest.today", { count: dueToday.length }),
      color: "#201f1e",
      lines: dueToday.map((t) => ({ title: t.title, note: "" })),
    },
    {
      label: t("notifications.digest.reminders", { count: reminders.length }),
      color: "#201f1e",
      lines: reminders.map((task) => ({
        title: task.title,
        note: task.remindAt
          ? formatterFor(locale, tz).dateTime(task.remindAt, { hour: "numeric", minute: "2-digit" })
          : "",
      })),
    },
  ].filter((s) => s.lines.length > 0);

  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const body = sections
    .map(
      (s) =>
        `<div style="font-size:13px;font-weight:600;color:${s.color};padding:14px 0 4px;">${esc(s.label)}</div>` +
        `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
        s.lines
          .map(
            (l) =>
              `<tr><td style="padding:5px 0;font-size:13px;color:#201f1e;">${esc(l.title)}` +
              (l.note ? ` <span style="color:#666666;">${esc(l.note)}</span>` : "") +
              `</td></tr>`,
          )
          .join("") +
        `</table>`,
    )
    .join("");

  const html = `<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;background-color:#ffffff;border-collapse:collapse;font-family:'Malgun Gothic',sans-serif;">
<tr><td style="background-color:#2564cf;padding:18px 26px;color:#ffffff;">
  <div style="font-size:16px;">${esc(t("notifications.digest.heading"))}</div>
  <div style="font-size:12px;color:#dce6f8;padding-top:3px;">${esc(format.dateTime(today, DATE_ONLY))}</div>
</td></tr>
<tr><td style="padding:6px 26px 20px;">${body}</td></tr>
<tr><td style="padding:18px 26px;font-size:11px;color:#999999;border-top:1px solid #edebe9;">
  ${esc(t("notifications.digest.footer", { app }))}
</td></tr>
</table>`;

  const text = sections
    .map((s) => `■ ${s.label}\n` + s.lines.map((l) => `  ${l.title}${l.note ? `  (${l.note})` : ""}`).join("\n"))
    .join("\n\n");

  return { html, text };
}
