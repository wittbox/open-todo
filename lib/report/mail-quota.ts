import { prisma } from "@/lib/db";
import { getRequestPrefs } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";

/**
 * 보고서 메일 한도 — 누구나 가입하는 설치에서 이 앱이 스팸 중계가 되지 않게.
 *
 * - 확인된 이메일의 사용자만 보낸다.
 * - 한 번에 받는 사람 수: `REPORT_MAIL_MAX_RECIPIENTS`(기본 10)
 * - 하루(24시간) 받는 사람 수 합계: `REPORT_MAIL_DAILY_LIMIT`(기본 100). 예약도 만든 순간 센다.
 */

const DAY = 86_400_000;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const maxRecipients = () => envInt("REPORT_MAIL_MAX_RECIPIENTS", 10);
export const dailyRecipientLimit = () => envInt("REPORT_MAIL_DAILY_LIMIT", 100);

/** 지난 24시간 동안 이 사람이 보냈거나 예약한 받는 사람 수. 실패·취소는 세지 않는다. */
export async function recipientsInLastDay(userId: string, now = new Date()): Promise<number> {
  const rows = await prisma.reportSend.findMany({
    where: {
      report: { authorId: userId },
      sentAt: { gte: new Date(now.getTime() - DAY) },
      status: { in: ["SENT", "SCHEDULED", "SENDING"] },
    },
    select: { toEmails: true },
  });
  return rows.reduce((n, r) => n + r.toEmails.length, 0);
}

/** 보내도 되면 null, 아니면 화면에 보일 문구와 상태 코드. */
export async function checkReportMailQuota(input: {
  userId: string;
  verified: boolean;
  recipients: number;
  now?: Date;
}): Promise<{ error: string; status: number } | null> {
  const t = translatorFor((await getRequestPrefs()).locale);
  if (!input.verified) return { error: t("reportMail.unverified"), status: 403 };
  const max = maxRecipients();
  if (input.recipients > max) return { error: t("reportMail.tooManyRecipients", { max }), status: 400 };
  const limit = dailyRecipientLimit();
  if ((await recipientsInLastDay(input.userId, input.now)) + input.recipients > limit) {
    return { error: t("reportMail.dailyLimit", { limit }), status: 429 };
  }
  return null;
}
