import { prisma } from "@/lib/db";
import type { AuthProvider, SignupPolicy, UserRole } from "@/app/generated/prisma/enums";
import { getInstanceSettings } from "@/lib/auth/instance";
import { mailDelivers } from "@/lib/mail";
import { appTimeZone, defaultLocale } from "@/lib/prefs";
import { holidayRegion } from "@/lib/holidays";
import { cleanAppName, DEFAULT_APP_NAME, envAppName } from "@/lib/brand";

/** 관리자 화면이 읽는 것들. 쓰기는 lib/actions/admin.ts. */

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: UserRole;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  hasPassword: boolean;
  providers: AuthProvider[];
};

export async function listUsers(query?: string): Promise<AdminUserRow[]> {
  const q = query?.trim();
  const rows = await prisma.user.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q.toLowerCase() } }] } : undefined,
    orderBy: [{ role: "asc" }, { name: "asc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      avatarColor: true,
      role: true,
      disabledAt: true,
      lastLoginAt: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
    },
  });
  return rows.map(({ passwordHash, accounts, ...u }) => ({
    ...u,
    hasPassword: Boolean(passwordHash),
    providers: accounts.map((a) => a.provider),
  }));
}

export type AdminInviteRow = {
  id: string;
  email: string | null;
  createdByName: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedByName: string | null;
  /** 만료 판정은 서버에서 한다 — 화면이 그리는 도중 시계를 읽지 않게. */
  expired: boolean;
};

export async function listInvitations(now = new Date()): Promise<AdminInviteRow[]> {
  const rows = await prisma.invitation.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
      usedById: true,
      createdBy: { select: { name: true } },
    },
  });
  // usedById 에는 FK 가 없다(정보성) — 이름은 따로 찾는다.
  const usedIds = rows.map((r) => r.usedById).filter((id): id is string => Boolean(id));
  const names = new Map(
    usedIds.length
      ? (await prisma.user.findMany({ where: { id: { in: usedIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
      : [],
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    createdByName: r.createdBy?.name ?? null,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    usedAt: r.usedAt,
    usedByName: r.usedById ? (names.get(r.usedById) ?? null) : null,
    expired: !r.usedAt && r.expiresAt.getTime() < now.getTime(),
  }));
}

export type InstanceOverview = {
  /** 관리자가 적어 둔 이름. 적지 않았으면 빈 문자열(그러면 fallback 을 쓴다). */
  appName: string;
  /** 이름을 비웠을 때 쓰이는 이름 — APP_NAME 환경 변수, 없으면 기본 이름. */
  appNameFallback: string;
  signupPolicy: SignupPolicy;
  allowedDomains: string[];
  mailConfigured: boolean;
  defaultLocale: string;
  timeZone: string;
  holidayRegion: string;
  userCount: number;
  adminCount: number;
  disabledCount: number;
};

export async function getInstanceOverview(): Promise<InstanceOverview> {
  const [settings, userCount, adminCount, disabledCount] = await Promise.all([
    getInstanceSettings(),
    prisma.user.count(),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.count({ where: { disabledAt: { not: null } } }),
  ]);
  return {
    appName: cleanAppName(settings.appName) ?? "",
    appNameFallback: envAppName() ?? DEFAULT_APP_NAME,
    signupPolicy: settings.signupPolicy,
    allowedDomains: settings.allowedDomains,
    mailConfigured: mailDelivers(),
    defaultLocale: defaultLocale(),
    timeZone: appTimeZone(),
    holidayRegion: holidayRegion(),
    userCount,
    adminCount,
    disabledCount,
  };
}
