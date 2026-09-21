import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 메일에 붙는 파일. 지금은 주간보고서 PDF 하나뿐이다. */
export type MailAttachment = {
  filename: string;
  contentType: string;
  data: Uint8Array;
};

export type MailMessage = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
  /**
   * 보낸 사람 칸에 보일 이름. 주소는 늘 설치 주소(MAIL_FROM)다 — 남의 주소로 보내면
   * 받는 쪽 메일 서버가 SPF/DMARC 로 막는다. 그래서 "홍길동 (open-todo)" 처럼 이름만 바꾼다.
   */
  fromName?: string;
  /** 답장이 갈 곳 — 보고서 메일은 작성자 */
  replyTo?: string;
};

export type MailResult = { ok: true; providerId?: string } | { ok: false; error: string };

export interface MailProvider {
  readonly name: string;
  /** userId: 보내는 일로 남길 사람(가입 전 메일은 없다) */
  send(msg: MailMessage, userId?: string): Promise<MailResult>;
}

/**
 * MOCK_MAIL=1 일 때 쓰는 provider.
 * 실제로 보내지 않고 tmp/mail 에 HTML 로 떨어뜨린다.
 * 메일 서버 없이도 개발 중에 본문을 눈으로 확인할 수 있게 하려는 것이다.
 */
export const mockMailProvider: MailProvider = {
  name: "mock",
  async send(msg) {
    const dir = join(process.cwd(), "tmp", "mail");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(dir, `${stamp}.html`);
    const header =
      `<!-- to: ${msg.to.join(", ")} -->\n` +
      `<!-- subject: ${msg.subject} -->\n` +
      (msg.fromName ? `<!-- from-name: ${msg.fromName} -->\n` : "") +
      (msg.replyTo ? `<!-- reply-to: ${msg.replyTo} -->\n` : "");
    await writeFile(file, header + msg.html, "utf8");
    // 첨부도 옆에 떨어뜨린다. 실제로 받는 사람이 열어 볼 파일을 개발 중에도 열어 봐야 한다.
    for (const a of msg.attachments ?? []) {
      await writeFile(join(dir, `${stamp}-${a.filename}`), a.data);
    }
    console.log(`[mail:mock] ${msg.to.join(", ")} → ${file}${msg.attachments?.length ? ` (+${msg.attachments.length} attachment(s))` : ""}`);
    return { ok: true, providerId: file };
  },
};
