import { after } from "next/server";
import { appName } from "@/lib/brand-server";
import { translatorFor } from "@/i18n/server";
import type { AppLocale } from "@/i18n/locales";
import { getMailProvider, type MailMessage } from "@/lib/mail";

/**
 * 계정 메일 — 가입 확인, 비밀번호 재설정, 이미 가입된 주소 알림. 받는 사람의 언어로 쓴다.
 */

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Parts = { app: string; subject: string; heading: string; lines: string[]; button: { label: string; url: string }; notes: string[]; fallback: string };

function render(p: Parts): Omit<MailMessage, "to"> {
  const html = `<table width="560" cellpadding="0" cellspacing="0" style="margin:0 auto;background-color:#ffffff;border-collapse:collapse;font-family:'Segoe UI','Malgun Gothic',sans-serif;color:#201f1e;">
<tr><td style="padding:22px 28px 6px;font-size:13px;color:#605e5c;">${esc(p.app)}</td></tr>
<tr><td style="padding:0 28px;font-size:17px;font-weight:600;">${esc(p.heading)}</td></tr>
<tr><td style="padding:10px 28px 0;font-size:14px;line-height:1.6;">${p.lines.map(esc).join("<br>")}</td></tr>
<tr><td style="padding:18px 28px;"><a href="${esc(p.button.url)}" style="display:inline-block;background-color:#2564cf;color:#ffffff;text-decoration:none;border-radius:4px;padding:9px 20px;font-size:14px;font-weight:600;">${esc(p.button.label)}</a></td></tr>
<tr><td style="padding:0 28px 22px;font-size:12px;line-height:1.6;color:#8a8886;">${p.notes.map(esc).join("<br>")}<br><br>${esc(p.fallback)}<br><span style="word-break:break-all;">${esc(p.button.url)}</span></td></tr>
</table>`;
  const text = [p.heading, "", ...p.lines, "", `${p.button.label}: ${p.button.url}`, "", ...p.notes].join("\n");
  return { subject: p.subject, html, text };
}

export async function verifyEmailMail(locale: AppLocale, name: string, url: string) {
  const t = translatorFor(locale);
  const app = await appName();
  return render({
    app,
    subject: t("mail.verify.subject", { app }),
    heading: t("mail.verify.heading", { name }),
    lines: [t("mail.verify.body")],
    button: { label: t("mail.verify.button"), url },
    notes: [t("mail.verify.note")],
    fallback: t("mail.fallback"),
  });
}

export async function resetPasswordMail(locale: AppLocale, url: string, providers: string[]) {
  const t = translatorFor(locale);
  const app = await appName();
  return render({
    app,
    subject: t("mail.reset.subject", { app }),
    heading: t("mail.reset.heading"),
    lines: [t("mail.reset.body")],
    button: { label: t("mail.reset.button"), url },
    notes: [
      t("mail.reset.note"),
      ...(providers.length ? [t("mail.reset.providers", { providers: providers.join(", ") })] : []),
    ],
    fallback: t("mail.fallback"),
  });
}

/** 관리자가 보내는 가입 초대 */
export async function inviteMail(locale: AppLocale, inviterName: string, url: string) {
  const t = translatorFor(locale);
  const app = await appName();
  return render({
    app,
    subject: t("mail.invite.subject", { app }),
    heading: t("mail.invite.heading", { app }),
    lines: [t("mail.invite.body", { name: inviterName, app })],
    button: { label: t("mail.invite.button"), url },
    notes: [t("mail.invite.note")],
    fallback: t("mail.fallback"),
  });
}

/** 이미 계정이 있는 주소로 가입을 시도했을 때 — 화면은 "메일을 확인하세요" 로 같게 두고 메일로만 알린다. */
export async function accountExistsMail(locale: AppLocale, loginUrl: string) {
  const t = translatorFor(locale);
  const app = await appName();
  return render({
    app,
    subject: t("mail.existing.subject", { app }),
    heading: t("mail.existing.heading"),
    lines: [t("mail.existing.body")],
    button: { label: t("mail.existing.button"), url: loginUrl },
    notes: [t("mail.existing.note")],
    fallback: t("mail.fallback"),
  });
}

/**
 * 응답을 보낸 뒤에 보낸다 — 메일 서버를 기다리는 시간으로 "있는 계정인지" 가 새지 않게.
 * 요청 밖(시험)에서는 바로 보낸다.
 */
export async function sendAfterResponse(to: string, mail: Omit<MailMessage, "to">, userId?: string): Promise<void> {
  const job = async () => {
    try {
      const res = await getMailProvider().send({ to: [to], ...mail }, userId);
      if (!res.ok) console.error(`[mail] account mail failed: ${res.error}`);
    } catch (e) {
      console.error("[mail] account mail failed:", e);
    }
  };
  try {
    after(job);
  } catch {
    await job();
  }
}
