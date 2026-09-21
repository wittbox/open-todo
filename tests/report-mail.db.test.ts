import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MailMessage } from "@/lib/mail";

/**
 * 보고서 메일의 보낸 사람 — 주소는 설치 주소, 이름은 "작성자 (앱 이름)", 답장은 작성자에게.
 * 작성자 주소로 직접 보내면 받는 쪽 메일 서버가 SPF/DMARC 로 막는다.
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

const { deliverReport } = await import("@/lib/report/deliver");
const { createFixture, destroyFixture } = await import("./helpers/fixtures");

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
let f: Awaited<ReturnType<typeof createFixture>>;

beforeAll(async () => {
  if (hasDb) f = await createFixture("rmail");
});
afterAll(async () => {
  if (hasDb && f) await destroyFixture(f);
});

d("보고서 메일의 보낸 사람", () => {
  it("이름은 작성자, 답장은 작성자 주소로", async () => {
    const res = await deliverReport(
      {
        id: f.published.id,
        title: f.published.title,
        authorId: f.owner.id,
        authorName: f.owner.name,
        authorEmail: f.owner.email,
        publishedAt: f.published.publishedAt,
        contentJson: f.published.contentJson,
      },
      ["lead@partner.example"],
      false,
    );
    expect(res.ok).toBe(true);
    expect(sent[0]).toMatchObject({ to: ["lead@partner.example"], fromName: "소유자 (open-todo)", replyTo: f.owner.email });
  });
});
