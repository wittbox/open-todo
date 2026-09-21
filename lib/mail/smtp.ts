import nodemailer, { type Transporter } from "nodemailer";
import { DEFAULT_APP_NAME, envAppName } from "@/lib/brand";
import type { MailProvider } from "@/lib/mail/provider";

/**
 * SMTP 로 보내기(nodemailer). 회사 메일 서버, Gmail 앱 비밀번호, SES·Mailgun 등 어떤 SMTP 든.
 *
 * 설정은 환경 변수로만 받는다:
 *   SMTP_HOST, SMTP_PORT(기본 587), SMTP_SECURE(465 면 자동으로 켜짐), SMTP_USER, SMTP_PASS, MAIL_FROM
 *
 * 보낸 사람 주소는 늘 MAIL_FROM 이다. 대부분의 메일 서버는 로그인한 계정의 주소로만 보내게 하고,
 * 받는 쪽은 SPF/DMARC 로 다른 주소를 막는다 — 그래서 작성자 이름은 표시 이름으로, 답장은 Reply-To 로 돌린다.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  /** 보낸 사람 주소 */
  fromAddress: string;
  /** 보낸 사람 이름(기본은 앱 이름) */
  fromName: string;
};

/** 환경 변수에서 SMTP 설정을 읽는다. SMTP_HOST 가 없으면 null(SMTP 를 쓰지 않는 설치). */
export function smtpConfig(env: Record<string, string | undefined> = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT?.trim() || 587);
  const secureRaw = env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureRaw ? secureRaw === "1" || secureRaw === "true" : port === 465;
  const user = env.SMTP_USER?.trim() || null;
  const from = parseFrom(env.MAIL_FROM?.trim() || user || "");
  if (!from) throw new Error('MAIL_FROM is missing or not an email address, e.g. MAIL_FROM="open-todo <todo@example.com>"');
  if (!Number.isInteger(port) || port <= 0) throw new Error("SMTP_PORT is not a number.");
  return { host, port, secure, user, pass: env.SMTP_PASS ?? null, fromAddress: from.address, fromName: from.name ?? envAppName() ?? DEFAULT_APP_NAME };
}

/** "이름 <addr@x>" 또는 "addr@x" */
function parseFrom(raw: string): { name: string | null; address: string } | null {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s@]+@[^<>\s@]+)>\s*$/.exec(raw);
  if (m) return { name: m[1]?.trim() || null, address: m[2] };
  return /^[^\s@<>]+@[^\s@<>]+$/.test(raw) ? { name: null, address: raw } : null;
}

export function smtpTransport(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // 587 처럼 평문으로 시작하는 포트는 STARTTLS 를 반드시 쓰게 한다 — 비밀번호가 평문으로 나가지 않게.
    requireTLS: !cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

export function createSmtpProvider(cfg: SmtpConfig, transport?: Transporter): MailProvider {
  let transporter: Transporter | undefined = transport;
  const get = () => (transporter ??= smtpTransport(cfg));

  return {
    name: "smtp",
    async send(msg) {
      try {
        const info = await get().sendMail({
          from: { name: msg.fromName ?? cfg.fromName, address: cfg.fromAddress },
          to: msg.to,
          replyTo: msg.replyTo,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          attachments: msg.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.data) })),
        });
        return { ok: true, providerId: info.messageId };
      } catch (e) {
        // 메일 서버의 답만 남긴다 — 설정값(비밀번호 등)이 로그에 섞이지 않게.
        const err = e as { code?: string; responseCode?: number; response?: string };
        const detail = [err.code, err.responseCode, err.response?.split("\n")[0]?.slice(0, 200)].filter(Boolean).join(" ");
        console.error(`[mail:smtp] send failed: ${detail || "unknown"}`);
        return { ok: false, error: `The mail server refused it${detail ? ` (${detail})` : ""}.` };
      }
    },
  };
}
