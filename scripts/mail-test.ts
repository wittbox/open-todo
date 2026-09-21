import "dotenv/config";
import { DEFAULT_APP_NAME, envAppName } from "../lib/brand";
import { createSmtpProvider, smtpConfig, smtpTransport } from "../lib/mail/smtp";

/**
 * 메일 설정 시험 — 메일 서버에 접속해 보고, 적은 주소로 시험 메일 한 통을 보낸다.
 *
 *   npm run mail:test -- you@example.com
 *
 * 비밀번호는 찍지 않는다. 접속 주소·포트·보낸 사람 주소만 보여 준다.
 * DB 없이도 돌아야 해서 설치 이름은 `.env` 의 APP_NAME 까지만 본다(관리자가 화면에서 적은 이름은 안 본다).
 */
async function main() {
  const app = envAppName() ?? DEFAULT_APP_NAME;
  const to = process.argv[2];
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error("Usage: npm run mail:test -- you@example.com");
    process.exit(1);
  }
  const cfg = smtpConfig();
  if (!cfg) {
    console.error("SMTP_HOST is not set. Put your mail server in .env — see .env.example.");
    process.exit(1);
  }
  console.log(
    `Mail server ${cfg.host}:${cfg.port} (${cfg.secure ? "SSL/TLS" : "STARTTLS"}), user ${cfg.user ?? "(none)"}, from ${cfg.fromAddress}`,
  );

  try {
    await smtpTransport(cfg).verify();
    console.log("Connected and signed in.");
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
    console.error(`Connection failed: ${[err.code, err.responseCode, err.response ?? err.message].filter(Boolean).join(" ")}`);
    process.exit(1);
  }

  const res = await createSmtpProvider(cfg).send({
    to: [to],
    subject: `[${app}] Mail test`,
    text: `Test message from ${app}. If you can read this, sign-up confirmation, password reset and report mail can go out.`,
    html: `<p>Test message from ${app}.</p><p>If you can read this, sign-up confirmation, password reset and report mail can go out.</p>`,
  });
  if (!res.ok) {
    console.error(`Could not send: ${res.error}`);
    process.exit(1);
  }
  console.log(`Sent to ${to}. Check the inbox — and the spam folder.`);
}

void main();
