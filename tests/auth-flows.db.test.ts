import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { MailMessage } from "@/lib/mail";
import type { SignupPolicy } from "@/app/generated/prisma/enums";

/**
 * 이메일·비밀번호 계정 흐름 (DB).
 *
 * 가입은 확인 링크를 눌러야 사용자가 된다 · 이미 있는 주소는 새지 않는다 · 가입 정책(초대만/도메인/누구나) ·
 * 초대 링크 · 로그인 실패·사용 중지·횟수 제한 · 재설정은 모든 세션을 끊는다.
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

const flows = await import("@/lib/auth/flows");
const { createInvitation } = await import("@/lib/auth/invitations");
const { hashPassword } = await import("@/lib/auth/password");
const { resetRateLimits } = await import("@/lib/auth/rate-limit");

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
const tag = `flow-${process.pid}`;
const addr = (k: string) => `${k}-${tag}@example.com`;
const PW = "correct horse battery";
const base = { ip: "203.0.113.9", locale: "ko" as const };

const mailsTo = (email: string) => sent.filter((m) => m.to.includes(email));
const tokenIn = (m: MailMessage | undefined) => /token=([A-Za-z0-9_-]+)/.exec(m?.text ?? "")?.[1];

let savedPolicy: { signupPolicy: SignupPolicy; allowedDomains: string[] } | null = null;
async function policy(signupPolicy: SignupPolicy, allowedDomains: string[] = []) {
  await prisma.instanceSettings.upsert({
    where: { id: "singleton" },
    create: { signupPolicy, allowedDomains },
    update: { signupPolicy, allowedDomains },
  });
}

beforeAll(async () => {
  if (!hasDb) return;
  savedPolicy = await prisma.instanceSettings.findUnique({
    where: { id: "singleton" },
    select: { signupPolicy: true, allowedDomains: true },
  });
});

beforeEach(() => {
  sent.length = 0;
  resetRateLimits();
});

afterAll(async () => {
  if (!hasDb) return;
  await prisma.user.deleteMany({ where: { email: { contains: tag } } });
  await prisma.verificationToken.deleteMany({ where: { email: { contains: tag } } });
  await prisma.invitation.deleteMany({ where: { email: { contains: tag } } });
  if (savedPolicy) await policy(savedPolicy.signupPolicy, savedPolicy.allowedDomains);
  else await prisma.instanceSettings.deleteMany({ where: { id: "singleton" } });
});

d("가입 — 확인 링크를 눌러야 사용자가 된다", () => {
  it("누구나 모드: 확인 메일 → 링크 → 사용자·기본 목록 → 비밀번호로 로그인", async () => {
    await policy("OPEN");
    const email = addr("open");
    const res = await flows.startPasswordSignup({ ...base, email: email.toUpperCase(), name: " 김  철수 ", password: PW, timeZone: "America/New_York" });
    expect(res).toEqual({ ok: true, sentTo: email });
    // 링크를 누르기 전에는 사용자가 없다 — 남의 주소를 선점할 수 없다.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    const token = tokenIn(mailsTo(email)[0]);
    expect(mailsTo(email)[0].subject).toContain("이메일 주소를 확인");
    const done = await flows.completeSignup(token);
    expect(done.ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, name: true, emailVerifiedAt: true, settings: true, lists: { select: { isInbox: true } } },
    });
    expect(user.name).toBe("김 철수");
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.settings).toEqual({ locale: "ko", timeZone: "America/New_York" });
    expect(user.lists.some((l) => l.isInbox)).toBe(true);

    expect(await flows.loginWithPassword({ email, password: PW, ip: base.ip })).toEqual({ ok: true, userId: user.id });
    // 같은 링크는 두 번 쓰지 못한다.
    expect(await flows.completeSignup(token)).toMatchObject({ ok: false, error: "linkInvalid" });
  });

  it("이미 있는 주소로 가입하면 화면은 같고, 메일로만 알린다", async () => {
    await policy("OPEN");
    const email = addr("dup");
    await prisma.user.create({ data: { email, name: "원래", emailVerifiedAt: new Date() } });
    const res = await flows.startPasswordSignup({ ...base, email, name: "가로채기", password: PW });
    expect(res).toEqual({ ok: true, sentTo: email });
    expect(mailsTo(email)).toHaveLength(1);
    expect(mailsTo(email)[0].subject).toContain("이미 가입된");
    expect(tokenIn(mailsTo(email)[0])).toBeUndefined();
  });

  it("다시 보내면 앞의 링크는 무효가 된다", async () => {
    await policy("OPEN");
    const email = addr("resend");
    await flows.startPasswordSignup({ ...base, email, name: "재전송", password: PW });
    const first = tokenIn(mailsTo(email)[0]);
    resetRateLimits(); // 1분 간격 제한을 건너뛴다
    expect((await flows.resendSignupEmail({ ...base, email })).ok).toBe(true);
    const second = tokenIn(mailsTo(email)[1]);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(await flows.completeSignup(first)).toMatchObject({ ok: false, error: "linkInvalid" });
    expect((await flows.completeSignup(second)).ok).toBe(true);
  });

  it("같은 주소로 1분 안에 또 보내지 못한다", async () => {
    await policy("OPEN");
    const email = addr("burst");
    await flows.startPasswordSignup({ ...base, email, name: "연타", password: PW });
    expect(await flows.resendSignupEmail({ ...base, email })).toMatchObject({ ok: false, error: "tooManyAttempts" });
  });

  it("규칙에 안 맞는 비밀번호·이름은 거절", async () => {
    await policy("OPEN");
    const email = addr("rules");
    expect(await flows.startPasswordSignup({ ...base, email, name: "규칙", password: "short" })).toMatchObject({ error: "passwordTooShort" });
    expect(await flows.startPasswordSignup({ ...base, email, name: "규칙", password: "password123" })).toMatchObject({ error: "passwordCommon" });
    expect(await flows.startPasswordSignup({ ...base, email, name: "  ", password: PW })).toMatchObject({ error: "nameRequired" });
    expect(sent).toHaveLength(0);
  });
});

d("가입 정책", () => {
  it("초대만: 초대 없이는 가입할 수 없다", async () => {
    await policy("INVITE_ONLY");
    expect(await flows.startPasswordSignup({ ...base, email: addr("closed"), name: "닫힘", password: PW })).toMatchObject({
      ok: false,
      error: "signupClosed",
    });
  });

  it("허용 도메인: 다른 도메인은 거절하고 허용 목록을 알려 준다", async () => {
    await policy("DOMAIN", ["team.example"]);
    expect(await flows.startPasswordSignup({ ...base, email: `kim-${tag}@other.example`, name: "밖", password: PW })).toMatchObject({
      ok: false,
      error: "domainNotAllowed",
      domains: ["team.example"],
    });
  });

  it("링크를 누르기 전에 가입이 닫히면 사용자를 만들지 않는다", async () => {
    await policy("OPEN");
    const email = addr("closing");
    await flows.startPasswordSignup({ ...base, email, name: "막차", password: PW });
    await policy("INVITE_ONLY");
    expect(await flows.completeSignup(tokenIn(mailsTo(email)[0]))).toMatchObject({ ok: false, error: "signupClosed" });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });
});

d("초대 링크", () => {
  it("주소가 정해진 초대 — 그 주소로는 확인 메일 없이 곧바로, 한 번만", async () => {
    await policy("INVITE_ONLY");
    const email = addr("bound");
    const { token } = await createInvitation({ createdById: null, email });
    const res = await flows.startPasswordSignup({ ...base, email, name: "초대", password: PW, inviteToken: token });
    expect(res.ok && res.userId).toBeTruthy();
    expect(sent).toHaveLength(0);
    expect(await flows.startPasswordSignup({ ...base, email: addr("bound2"), name: "또", password: PW, inviteToken: token })).toMatchObject({
      error: "inviteInvalid",
    });
  });

  it("주소가 정해진 초대로 다른 주소는 안 된다", async () => {
    await policy("INVITE_ONLY");
    const { token } = await createInvitation({ createdById: null, email: addr("owner") });
    expect(await flows.startPasswordSignup({ ...base, email: addr("thief"), name: "남", password: PW, inviteToken: token })).toMatchObject({
      error: "inviteInvalid",
    });
  });

  it("주소를 비운 초대 — 확인 메일을 거치고, 링크를 누를 때 초대를 쓴다", async () => {
    await policy("INVITE_ONLY");
    const email = addr("open-invite");
    const { token, id } = await createInvitation({ createdById: null });
    expect(await flows.startPasswordSignup({ ...base, email, name: "열린초대", password: PW, inviteToken: token })).toEqual({ ok: true, sentTo: email });
    const done = await flows.completeSignup(tokenIn(mailsTo(email)[0]));
    expect(done.ok).toBe(true);
    const inv = await prisma.invitation.findUniqueOrThrow({ where: { id } });
    expect(inv.usedAt).not.toBeNull();
    expect(inv.usedById).toBe(done.ok ? done.userId : null);
    await prisma.invitation.delete({ where: { id } });
  });

  it("만료된 초대는 쓸 수 없다", async () => {
    const { token, id } = await createInvitation({ createdById: null, ttlDays: 7, now: new Date(Date.now() - 8 * 86_400_000) });
    expect(await flows.startPasswordSignup({ ...base, email: addr("late"), name: "늦음", password: PW, inviteToken: token })).toMatchObject({
      error: "inviteInvalid",
    });
    await prisma.invitation.delete({ where: { id } });
  });
});

d("로그인", () => {
  let email: string;
  beforeAll(async () => {
    if (!hasDb) return;
    email = addr("login");
    await prisma.user.create({ data: { email, name: "로그인", emailVerifiedAt: new Date(), passwordHash: await hashPassword(PW) } });
  });

  it("틀린 비밀번호와 없는 계정은 같은 답", async () => {
    expect(await flows.loginWithPassword({ email, password: "wrong password", ip: null })).toEqual({ ok: false, error: "invalidCredentials" });
    expect(await flows.loginWithPassword({ email: addr("nobody"), password: PW, ip: null })).toEqual({ ok: false, error: "invalidCredentials" });
  });

  it("사용 중지된 계정은 비밀번호가 맞을 때만 그 사실을 알린다", async () => {
    await prisma.user.update({ where: { email }, data: { disabledAt: new Date() } });
    expect(await flows.loginWithPassword({ email, password: "wrong password", ip: null })).toMatchObject({ error: "invalidCredentials" });
    expect(await flows.loginWithPassword({ email, password: PW, ip: null })).toMatchObject({ error: "disabled" });
    await prisma.user.update({ where: { email }, data: { disabledAt: null } });
  });

  it("같은 이메일로 10번 틀리면 잠시 막는다 — 맞는 비밀번호도", async () => {
    for (let i = 0; i < 10; i++) await flows.loginWithPassword({ email, password: `wrong ${i}`, ip: null });
    const r = await flows.loginWithPassword({ email, password: PW, ip: null });
    expect(r).toMatchObject({ ok: false, error: "tooManyAttempts" });
    expect(r.ok ? 0 : r.retryAfterSec).toBeGreaterThan(0);
  });
});

d("비밀번호 재설정", () => {
  let email: string;
  let userId: string;
  beforeAll(async () => {
    if (!hasDb) return;
    email = addr("reset");
    userId = (await prisma.user.create({ data: { email, name: "재설정", emailVerifiedAt: new Date(), passwordHash: await hashPassword(PW) } })).id;
  });

  it("없는 주소도 같은 답 — 메일만 안 간다", async () => {
    expect(await flows.requestPasswordReset({ ...base, email: addr("ghost") })).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("규칙에 안 맞으면 링크를 태우지 않는다 → 고쳐서 다시 → 모든 세션이 끊긴다", async () => {
    expect(await flows.requestPasswordReset({ ...base, email })).toEqual({ ok: true });
    const token = tokenIn(mailsTo(email)[0]);
    expect(await flows.resetLinkEmail(token)).toBe(email);

    expect(await flows.resetPassword({ token, password: "new password one", confirm: "different" })).toMatchObject({ error: "passwordMismatch" });
    expect(await flows.resetPassword({ token, password: "password1", confirm: "password1" })).toMatchObject({ error: "passwordCommon" });

    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion;
    const NEW = "new password that is long";
    expect(await flows.resetPassword({ token, password: NEW, confirm: NEW })).toEqual({ ok: true, userId });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(before + 1);

    expect((await flows.loginWithPassword({ email, password: PW, ip: null })).ok).toBe(false);
    expect((await flows.loginWithPassword({ email, password: NEW, ip: null })).ok).toBe(true);
    expect(await flows.resetPassword({ token, password: NEW, confirm: NEW })).toMatchObject({ error: "linkInvalid" });
  });

  it("외부 로그인만 쓰는 사람도 재설정 메일로 비밀번호를 만들 수 있고, 어느 제공자가 붙어 있는지 알려 준다", async () => {
    const oauthOnly = addr("oauth-only");
    const u = await prisma.user.create({ data: { email: oauthOnly, name: "구글", emailVerifiedAt: new Date() } });
    await prisma.account.create({ data: { userId: u.id, provider: "GOOGLE", providerAccountId: `g-${tag}` } });
    await flows.requestPasswordReset({ ...base, email: oauthOnly });
    expect(mailsTo(oauthOnly)[0].text).toContain("Google");
  });
});
