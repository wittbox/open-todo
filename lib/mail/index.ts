import { mockMailProvider, type MailMessage, type MailProvider } from "@/lib/mail/provider";
import { createSmtpProvider, smtpConfig } from "@/lib/mail/smtp";

/**
 * 메일 보내는 곳을 고른다.
 *
 * 1. `MOCK_MAIL=1` → 보내지 않고 `tmp/mail` 에 HTML 로 떨어뜨린다(개발).
 * 2. `SMTP_HOST` 가 있으면 SMTP.
 * 3. 둘 다 없으면 — 개발에서는 1번처럼, 운영에서는 "메일 서버가 없습니다" 로 실패한다.
 *    운영에서 조용히 파일로 떨어뜨리면 가입 확인 메일이 영영 안 가는데 아무도 모른다.
 */

const g = globalThis as unknown as { __smtpProvider?: MailProvider };

const notConfigured: MailProvider = {
  name: "none",
  async send() {
    console.error("[mail] No mail server configured (SMTP_HOST). The message was not sent.");
    return { ok: false, error: "No mail server is configured." };
  },
};

export function getMailProvider(): MailProvider {
  if (process.env.MOCK_MAIL === "1") return mockMailProvider;
  const cfg = smtpConfig();
  if (cfg) return (g.__smtpProvider ??= createSmtpProvider(cfg));
  return process.env.NODE_ENV === "production" ? notConfigured : mockMailProvider;
}

/** 실제로 메일이 나가는 설치인가 — 관리자 화면에서 "메일 없이 링크를 직접 전달" 안내를 띄울 때. */
export function mailDelivers(): boolean {
  return process.env.MOCK_MAIL !== "1" && smtpConfig() != null;
}

export type { MailMessage };
