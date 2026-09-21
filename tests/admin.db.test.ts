import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { MailMessage } from "@/lib/mail";
import type { SignupPolicy } from "@/app/generated/prisma/enums";

/**
 * 관리자 화면의 쓰기 (DB).
 *
 * 관리자만 · 초대는 링크를 한 번만 · 권한/사용 중지는 그 사람의 세션을 끊는다 · 자기 계정에는 못 한다.
 * 그리고 "누구나" 설치에서 사람 찾기가 좁아지는지.
 */
let currentUser: string | null = null;
vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return {
    ...actual,
    getSessionUserId: async () => currentUser,
    requireUserId: async () => {
      if (!currentUser) throw new actual.UnauthenticatedError();
      return currentUser;
    },
    revokeSessions: async (userId: string) => {
      await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
const { sent } = vi.hoisted(() => ({ sent: [] as MailMessage[] }));
vi.mock("@/lib/mail", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mail")>("@/lib/mail");
  return {
    ...actual,
    getMailProvider: () => ({
      name: "test",
      async send(msg: MailMessage) {
        sent.push(msg);
        return { ok: true };
      },
    }),
  };
});

const admin = await import("@/lib/actions/admin");
const { listInvitations, listUsers } = await import("@/lib/queries/admin");
const { searchUsers } = await import("@/lib/queries/share");
const { hashToken } = await import("@/lib/auth/tokens");
const { firstAdminWindowOpen } = await import("@/lib/auth/instance");

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
const tag = `adm-${process.pid}`;
const addr = (k: string) => `${k}-${tag}@example.com`;

let bossId = "";
let memberId = "";
let savedPolicy: { signupPolicy: SignupPolicy; allowedDomains: string[] } | null = null;

const setPolicy = (signupPolicy: SignupPolicy, allowedDomains: string[] = []) =>
  prisma.instanceSettings.upsert({
    where: { id: "singleton" },
    create: { signupPolicy, allowedDomains, setupCompletedAt: new Date() },
    update: { signupPolicy, allowedDomains },
  });

beforeAll(async () => {
  if (!hasDb) return;
  savedPolicy = await prisma.instanceSettings.findUnique({ where: { id: "singleton" }, select: { signupPolicy: true, allowedDomains: true } });
  bossId = (await prisma.user.create({ data: { email: addr("boss"), name: "김관리", role: "ADMIN", emailVerifiedAt: new Date() } })).id;
  memberId = (await prisma.user.create({ data: { email: addr("member"), name: "김철수", emailVerifiedAt: new Date() } })).id;
});
afterAll(async () => {
  if (!hasDb) return;
  await prisma.invitation.deleteMany({ where: { OR: [{ createdById: bossId }, { email: { contains: tag } }] } });
  await prisma.verificationToken.deleteMany({ where: { email: { contains: tag } } });
  await prisma.user.deleteMany({ where: { email: { contains: tag } } });
  // 행이 없던 DB(새로 만든 CI DB)면 지워서 되돌린다 — 남겨 두면 뒤따르는 파일이 바뀐 정책으로 돈다.
  if (savedPolicy) await setPolicy(savedPolicy.signupPolicy, savedPolicy.allowedDomains);
  else await prisma.instanceSettings.deleteMany({ where: { id: "singleton" } });
});
beforeEach(() => {
  sent.length = 0;
  currentUser = bossId;
});

d("관리자만", () => {
  it("일반 사용자는 관리자 액션을 부르지 못한다", async () => {
    currentUser = memberId;
    for (const call of [
      () => admin.setSignupPolicy("OPEN", ""),
      () => admin.createInvite("", 7, false),
      () => admin.setUserRole(bossId, "USER"),
      () => admin.setUserDisabled(bossId, true),
      () => admin.issueResetLink(bossId),
    ]) {
      expect((await call()).ok, call.toString()).toBe(false);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bossId } })).role).toBe("ADMIN");
  });

  it("로그인하지 않았으면 더더욱", async () => {
    currentUser = null;
    expect(await admin.createInvite("", 7, false)).toMatchObject({ ok: false, code: "unauthenticated" });
  });
});

d("가입 정책", () => {
  it("도메인 정책은 도메인이 있어야 하고, 모양도 본다", async () => {
    expect((await admin.setSignupPolicy("DOMAIN", "")).ok).toBe(false);
    expect((await admin.setSignupPolicy("DOMAIN", "도메인 아님")).ok).toBe(false);
    expect((await admin.setSignupPolicy("NOPE", "")).ok).toBe(false);
  });

  it("저장하면 곧바로 적용된다", async () => {
    expect((await admin.setSignupPolicy("DOMAIN", "@Example.com, team.example.com")).ok).toBe(true);
    expect(await prisma.instanceSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { signupPolicy: true, allowedDomains: true } })).toEqual({
      signupPolicy: "DOMAIN",
      allowedDomains: ["example.com", "team.example.com"],
    });
    await setPolicy("INVITE_ONLY");
  });
});

d("초대", () => {
  it("링크를 만들고, DB 에는 해시만 둔다", async () => {
    const res = await admin.createInvite(addr("invitee"), 7, false);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const token = /\/join\/([A-Za-z0-9_-]+)/.exec(res.data.link)?.[1] ?? "";
    const row = await prisma.invitation.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(row.email).toBe(addr("invitee"));
    expect(row.createdById).toBe(bossId);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(sent).toHaveLength(0);
  });

  it("메일로도 보낸다", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.MAIL_FROM = "open-todo <todo@example.test>";
    const res = await admin.createInvite(addr("mailed"), 1, true);
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    expect(res.ok && res.data.mailed).toBe(true);
    expect(sent[0].to).toEqual([addr("mailed")]);
    expect(sent[0].subject).toContain("초대");
  });

  it("이미 가입한 주소는 초대하지 않는다", async () => {
    expect(await admin.createInvite(addr("member"), 7, false)).toMatchObject({ ok: false });
  });

  it("아직 안 쓴 초대만 취소된다", async () => {
    const made = await admin.createInvite("", 7, false);
    const list = await listInvitations();
    const row = list.find((r) => r.email === null && !r.usedAt);
    expect(made.ok && row).toBeTruthy();
    if (!row) return;
    expect((await admin.revokeInvite(row.id)).ok).toBe(true);
    expect(await prisma.invitation.findUnique({ where: { id: row.id } })).toBeNull();
  });
});

d("사용자", () => {
  it("권한을 주면 그 사람의 세션이 끊긴다", async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: memberId } })).sessionVersion;
    expect((await admin.setUserRole(memberId, "ADMIN")).ok).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
    expect(after.role).toBe("ADMIN");
    expect(after.sessionVersion).toBe(before + 1);
    await admin.setUserRole(memberId, "USER");
  });

  it("자기 계정에는 하지 못한다 — 관리자가 없는 설치가 되지 않게", async () => {
    expect(await admin.setUserRole(bossId, "USER")).toMatchObject({ ok: false });
    expect(await admin.setUserDisabled(bossId, true)).toMatchObject({ ok: false });
  });

  it("사용 중지하면 즉시 로그아웃되고, 목록·검색에서 빠진다", async () => {
    expect((await admin.setUserDisabled(memberId, true)).ok).toBe(true);
    const off = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
    expect(off.disabledAt).not.toBeNull();
    expect(await searchUsers(bossId, addr("member"), [])).toEqual([]);
    expect((await listUsers()).find((u) => u.id === memberId)?.disabledAt).not.toBeNull();

    expect((await admin.setUserDisabled(memberId, false)).ok).toBe(true);
    expect((await searchUsers(bossId, addr("member"), [])).some((u) => u.id === memberId)).toBe(true);
  });

  it("재설정 링크 — 메일 서버가 있으면 보내고, 없으면 링크를 돌려준다", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.MAIL_FROM = "open-todo <todo@example.test>";
    const mailed = await admin.issueResetLink(memberId);
    expect(mailed.ok && mailed.data).toMatchObject({ mailed: true, link: null });
    expect(sent[0].to).toEqual([addr("member")]);

    // 메일이 안 나가는 설치 — 관리자가 링크를 직접 전달한다.
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    const copied = await admin.issueResetLink(memberId);
    expect(copied.ok && copied.data.mailed).toBe(false);
    expect(copied.ok && copied.data.link).toContain("/reset-password?token=");
  });
});

d("누구나 설치에서는 사람 찾기가 좁아진다", () => {
  it("이름 일부로는 못 찾고, 정확한 주소로만 찾는다", async () => {
    await setPolicy("OPEN");
    expect(await searchUsers(bossId, "김철", [])).toEqual([]);
    expect((await searchUsers(bossId, addr("member").toUpperCase(), [])).map((u) => u.id)).toEqual([memberId]);

    await setPolicy("INVITE_ONLY");
    expect((await searchUsers(bossId, "김철", [])).some((u) => u.id === memberId)).toBe(true);
  });
});

d("첫 관리자 창", () => {
  it("사람이 있는 설치에서는 닫혀 있다", async () => {
    expect(await firstAdminWindowOpen()).toBe(false);
  });
});
