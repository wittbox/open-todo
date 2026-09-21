import { afterEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { createSmtpProvider, smtpConfig } from "@/lib/mail/smtp";

/**
 * SMTP 발송 — 설정 읽기, 보낸 사람·답장 주소, 실패 때 비밀번호가 새지 않기, 어느 발송기를 고르는지.
 */

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "MOCK_MAIL", "NODE_ENV"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k]!;
  }
  vi.resetModules();
});

describe("SMTP 설정", () => {
  it("SMTP_HOST 가 없으면 SMTP 를 쓰지 않는다", () => {
    expect(smtpConfig({})).toBeNull();
  });

  it("465 는 처음부터 암호화, 그 밖은 STARTTLS", () => {
    expect(smtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", MAIL_FROM: "a@example.com" })?.secure).toBe(true);
    expect(smtpConfig({ SMTP_HOST: "smtp.example.com", MAIL_FROM: "a@example.com" })).toMatchObject({ port: 587, secure: false });
    expect(smtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "2525", SMTP_SECURE: "true", MAIL_FROM: "a@example.com" })?.secure).toBe(true);
  });

  it("보낸 사람 — '이름 <주소>' 또는 주소만, 없으면 로그인 계정", () => {
    expect(smtpConfig({ SMTP_HOST: "h.example", MAIL_FROM: '"팀 할일" <todo@example.com>' })).toMatchObject({ fromName: "팀 할일", fromAddress: "todo@example.com" });
    expect(smtpConfig({ SMTP_HOST: "h.example", MAIL_FROM: "todo@example.com" })).toMatchObject({ fromName: "open-todo", fromAddress: "todo@example.com" });
    expect(smtpConfig({ SMTP_HOST: "h.example", SMTP_USER: "bot@example.com" })?.fromAddress).toBe("bot@example.com");
    expect(() => smtpConfig({ SMTP_HOST: "h.example", MAIL_FROM: "not an address" })).toThrow(/MAIL_FROM/);
  });
});

describe("보내기", () => {
  const cfg = smtpConfig({ SMTP_HOST: "h.example", MAIL_FROM: "open-todo <todo@example.com>", SMTP_USER: "todo@example.com", SMTP_PASS: "s3cret-pass" })!;

  it("보낸 사람 주소는 늘 설치 주소, 이름만 작성자 — 답장은 작성자에게", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const spy = vi.spyOn(transport, "sendMail");
    const res = await createSmtpProvider(cfg, transport).send({
      to: ["lead@partner.example"],
      subject: "주간보고",
      html: "<p>본문</p>",
      text: "본문",
      fromName: "홍길동 (open-todo)",
      replyTo: "hong@example.com",
      attachments: [{ filename: "보고서.pdf", contentType: "application/pdf", data: new Uint8Array([37, 80, 68, 70]) }],
    });
    expect(res.ok).toBe(true);
    const sent = spy.mock.calls[0][0];
    expect(sent.from).toEqual({ name: "홍길동 (open-todo)", address: "todo@example.com" });
    expect(sent.replyTo).toBe("hong@example.com");
    expect(sent.attachments).toHaveLength(1);
  });

  it("이름을 주지 않으면 앱 이름", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const spy = vi.spyOn(transport, "sendMail");
    await createSmtpProvider(cfg, transport).send({ to: ["a@example.com"], subject: "s", html: "h", text: "t" });
    expect(spy.mock.calls[0][0].from).toEqual({ name: "open-todo", address: "todo@example.com" });
  });

  it("메일 서버가 거절하면 그 답만 돌려준다 — 설정값(비밀번호)은 섞이지 않는다", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    vi.spyOn(transport, "sendMail").mockRejectedValue(Object.assign(new Error("Invalid login: s3cret-pass"), { code: "EAUTH", responseCode: 535, response: "535 5.7.8 Authentication failed" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createSmtpProvider(cfg, transport).send({ to: ["a@example.com"], subject: "s", html: "h", text: "t" });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("535") });
    expect(JSON.stringify(res)).not.toContain("s3cret-pass");
    expect(JSON.stringify(err.mock.calls)).not.toContain("s3cret-pass");
    err.mockRestore();
  });
});

describe("발송기 고르기", () => {
  const pick = async () => (await import("@/lib/mail")).getMailProvider().name;

  it("MOCK_MAIL=1 이면 파일로", async () => {
    process.env.MOCK_MAIL = "1";
    process.env.SMTP_HOST = "h.example";
    process.env.MAIL_FROM = "a@example.com";
    expect(await pick()).toBe("mock");
  });

  it("SMTP_HOST 가 있으면 SMTP", async () => {
    delete process.env.MOCK_MAIL;
    process.env.SMTP_HOST = "h.example";
    process.env.MAIL_FROM = "a@example.com";
    (globalThis as { __smtpProvider?: unknown }).__smtpProvider = undefined;
    expect(await pick()).toBe("smtp");
  });

  it("운영에서 아무것도 없으면 보내지 못했다고 알린다 — 조용히 파일로 떨어뜨리지 않는다", async () => {
    delete process.env.MOCK_MAIL;
    delete process.env.SMTP_HOST;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { getMailProvider } = await import("@/lib/mail");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getMailProvider().name).toBe("none");
    expect((await getMailProvider().send({ to: ["a@example.com"], subject: "s", html: "h", text: "t" })).ok).toBe(false);
    err.mockRestore();
  });
});
