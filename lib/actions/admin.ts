"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { SignupPolicy, UserRole } from "@/app/generated/prisma/enums";
import { ActionError, run, type ActionResult } from "@/lib/actions/_helpers";
import { requireAdmin } from "@/lib/auth/roles";
import { normalizeDomain, normalizeEmail } from "@/lib/auth/email";
import { createInvitation, INVITATION_TTL_DAYS } from "@/lib/auth/invitations";
import { issueToken } from "@/lib/auth/tokens";
import { revokeSessions } from "@/lib/session";
import { appUrl } from "@/lib/app-url";
import { getMailProvider, mailDelivers } from "@/lib/mail";
import { inviteMail, resetPasswordMail } from "@/lib/mail/auth-mails";
import { getUserPrefs } from "@/lib/prefs";
import { PROVIDER_LABEL } from "@/lib/auth/oauth/config";
import { cleanAppName } from "@/lib/brand";

/**
 * 관리자 화면의 쓰기 — 가입 정책, 초대 링크, 사용자 권한·사용 중지·재설정 링크.
 *
 * 모든 액션의 첫 줄은 `requireAdmin()` 이다. 화면을 숨기는 것만으로는 막은 것이 아니다.
 * 링크(초대·재설정)는 만든 직후 **한 번만** 돌려준다 — DB 에는 해시만 있다.
 */

const refresh = () => revalidatePath("/admin");

/* ── 가입 정책 ─────────────────────────────────────────── */

const POLICIES: SignupPolicy[] = ["INVITE_ONLY", "DOMAIN", "OPEN"];

export async function setSignupPolicy(policy: string, domainsRaw: string): Promise<ActionResult> {
  return run(async () => {
    await requireAdmin();
    if (!POLICIES.includes(policy as SignupPolicy)) throw ActionError.key("admin.errors.badPolicy");
    const domains = [...new Set(domainsRaw.split(/[\s,]+/).filter(Boolean).map(normalizeDomain))];
    if (domains.some((d) => d === null)) throw ActionError.key("admin.errors.badDomain");
    const allowedDomains = domains as string[];
    if (policy === "DOMAIN" && allowedDomains.length === 0) throw ActionError.key("admin.errors.noDomains");

    await prisma.instanceSettings.upsert({
      where: { id: "singleton" },
      create: { signupPolicy: policy as SignupPolicy, allowedDomains },
      update: { signupPolicy: policy as SignupPolicy, allowedDomains },
    });
    refresh();
  });
}

/* ── 설치 이름 ─────────────────────────────────────────── */

/**
 * 이 설치의 이름. 비우면 `APP_NAME` 환경 변수, 그것도 없으면 기본 이름으로 돌아간다.
 * 제목·메일에 그대로 들어가는 글이라 길이를 자르고 줄바꿈을 지운다(lib/brand.ts).
 */
export async function setAppName(raw: string): Promise<ActionResult> {
  return run(async () => {
    await requireAdmin();
    const appName = cleanAppName(raw);
    await prisma.instanceSettings.upsert({
      where: { id: "singleton" },
      create: { appName },
      update: { appName },
    });
    // 이름은 모든 화면의 제목 줄에 있다.
    revalidatePath("/", "layout");
  });
}

/* ── 초대 ──────────────────────────────────────────────── */

const TTL_CHOICES = [1, 7, 30];

export type NewInvite = { link: string; email: string | null; mailed: boolean };

/** 초대를 만든다. 링크는 여기서 한 번만 돌려준다. 주소를 정했고 메일 서버가 있으면 보내 줄 수도 있다. */
export async function createInvite(emailRaw: string, days: number, sendMail: boolean): Promise<ActionResult<NewInvite>> {
  return run(async () => {
    const adminId = await requireAdmin();
    const email = emailRaw.trim() ? normalizeEmail(emailRaw) : null;
    if (emailRaw.trim() && !email) throw ActionError.key("admin.errors.badEmail");
    const ttlDays = TTL_CHOICES.includes(days) ? days : INVITATION_TTL_DAYS;

    if (email && (await prisma.user.findUnique({ where: { email }, select: { id: true } }))) {
      throw ActionError.key("admin.errors.alreadyMember");
    }

    const { token } = await createInvitation({ createdById: adminId, email, ttlDays });
    const link = appUrl(`/join/${token}`);

    let mailed = false;
    if (email && sendMail && mailDelivers()) {
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminId }, select: { name: true, email: true } });
      const { locale } = await getUserPrefs(adminId);
      const res = await getMailProvider().send({ to: [email], replyTo: admin.email, ...(await inviteMail(locale, admin.name, link)) }, adminId);
      if (!res.ok) throw ActionError.key("admin.errors.mailFailed", { detail: res.error });
      mailed = true;
    }
    refresh();
    return { link, email, mailed };
  });
}

export async function revokeInvite(id: string): Promise<ActionResult> {
  return run(async () => {
    await requireAdmin();
    // 쓴 초대는 이력으로 남긴다 — 아직 안 쓴 것만 지운다.
    await prisma.invitation.deleteMany({ where: { id, usedAt: null } });
    refresh();
  });
}

/* ── 사용자 ────────────────────────────────────────────── */

export async function setUserRole(userId: string, role: UserRole): Promise<ActionResult> {
  return run(async () => {
    const adminId = await requireAdmin();
    // 자기 권한은 스스로 떼지 못한다 — 관리자가 한 명도 없는 설치가 되는 길을 막는다.
    if (userId === adminId) throw ActionError.key("admin.errors.notYourself");
    if (role !== "ADMIN" && role !== "USER") throw ActionError.key("admin.errors.badRole");

    await prisma.user.update({ where: { id: userId }, data: { role } });
    // 권한이 바뀌면 그 사람의 세션을 끊는다 — 관리자 화면이 열린 채로 남지 않게.
    await revokeSessions(userId);
    refresh();
  });
}

export async function setUserDisabled(userId: string, disabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const adminId = await requireAdmin();
    if (userId === adminId) throw ActionError.key("admin.errors.notYourself");

    await prisma.user.update({ where: { id: userId }, data: { disabledAt: disabled ? new Date() : null } });
    if (disabled) await revokeSessions(userId);
    refresh();
  });
}

export type ResetLink = { link: string | null; mailed: boolean };

/**
 * 비밀번호를 잊은 사람을 위해 관리자가 재설정 링크를 낸다. 관리자가 남의 비밀번호를 직접 정하지는 못한다 —
 * 새 비밀번호는 본인만 안다.
 */
export async function issueResetLink(userId: string): Promise<ActionResult<ResetLink>> {
  return run(async () => {
    await requireAdmin();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, disabledAt: true, accounts: { select: { provider: true } } },
    });
    if (user.disabledAt) throw ActionError.key("admin.errors.disabledUser");

    const token = await issueToken({ purpose: "RESET_PASSWORD", email: user.email, userId: user.id });
    const link = appUrl(`/reset-password?token=${token}`);

    if (mailDelivers()) {
      const { locale } = await getUserPrefs(user.id);
      const providers = user.accounts.map((a) => PROVIDER_LABEL[a.provider]);
      const res = await getMailProvider().send({ to: [user.email], ...(await resetPasswordMail(locale, link, providers)) }, user.id);
      if (res.ok) return { link: null, mailed: true };
    }
    // 메일 서버가 없거나 실패했다 — 관리자가 직접 전달한다.
    return { link, mailed: false };
  });
}
