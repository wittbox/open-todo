import { prisma } from "@/lib/db";
import { getInstanceSettings } from "@/lib/auth/instance";
import { normalizeEmail } from "@/lib/auth/email";
import { getEffectiveRole, ROLE_RANK, type Role } from "@/lib/permissions";
import type { ShareSubjectType } from "@/app/generated/prisma/enums";

export type ShareSubject = { type: ShareSubjectType; id: string };

export type ShareMember = {
  shareId: string | null; // 소유자는 Share 행이 없다
  userId: string;
  name: string;
  email: string;
  avatarColor: string;
  role: Role | "OWNER";
  /** 지금 보고 있는 사람 본인인지. 목록에서 자기를 찾기 쉽게 표시한다. */
  isMe: boolean;
};

export type InviteLink = {
  token: string;
  role: Role;
  expiresAt: string;
  usedAt: string | null;
};

export type ShareState = {
  subject: ShareSubject;
  name: string;
  /** 그룹 공유로 이미 권한이 흘러 들어오는 목록인지 */
  inheritedFromGroup: { id: string; name: string } | null;
  members: ShareMember[];
  invites: InviteLink[];
  canManage: boolean;
};

export async function getShareState(
  userId: string,
  subject: ShareSubject,
): Promise<ShareState | null> {
  const role = await getEffectiveRole(userId, {
    kind: subject.type === "GROUP" ? "group" : "list",
    id: subject.id,
  });
  if (!role) return null;

  let name: string;
  let ownerId: string;
  let inheritedFromGroup: { id: string; name: string } | null = null;

  if (subject.type === "GROUP") {
    const g = await prisma.group.findUnique({
      where: { id: subject.id },
      select: { name: true, ownerId: true },
    });
    if (!g) return null;
    name = g.name;
    ownerId = g.ownerId;
  } else {
    const l = await prisma.list.findUnique({
      where: { id: subject.id },
      select: { name: true, ownerId: true, group: { select: { id: true, name: true } } },
    });
    if (!l) return null;
    name = l.name;
    ownerId = l.ownerId;
    inheritedFromGroup = l.group;
  }

  const [owner, shares, invites] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: ownerId },
      select: { id: true, name: true, email: true, avatarColor: true },
    }),
    prisma.share.findMany({
      where: { subjectType: subject.type, subjectId: subject.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        grantee: { select: { id: true, name: true, email: true, avatarColor: true } },
      },
    }),
    prisma.shareInvite.findMany({
      where: { subjectType: subject.type, subjectId: subject.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { token: true, role: true, expiresAt: true, usedAt: true },
    }),
  ]);

  return {
    subject,
    name,
    inheritedFromGroup,
    members: [
      {
        shareId: null,
        userId: owner.id,
        name: owner.name,
        email: owner.email,
        avatarColor: owner.avatarColor,
        role: "OWNER" as const,
        isMe: owner.id === userId,
      },
      ...shares.map((s) => ({
        shareId: s.id,
        userId: s.grantee.id,
        name: s.grantee.name,
        email: s.grantee.email,
        avatarColor: s.grantee.avatarColor,
        role: s.role,
        isMe: s.grantee.id === userId,
      })),
    ],
    invites: invites.map((i) => ({
      token: i.token,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      usedAt: i.usedAt?.toISOString() ?? null,
    })),
    canManage: ROLE_RANK[role] >= ROLE_RANK.ADMIN,
  };
}

export type UserHit = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  /** 조직도에서 온 소속. 동명이인을 가르는 데 쓴다. */
  department: string | null;
};

/**
 * 사람 검색 — 공유·담당자·멘션에서 동료를 고를 때.
 *
 * **누구나 가입하는 설치에서는 정확한 이메일 전체로만 찾힌다.** 이름 몇 글자로 전체 사용자 명단을
 * 훑을 수 있으면, 모르는 사람들이 섞인 서버에서 그것만으로 사람 목록이 새어 나간다.
 * 초대·도메인 설치는 이미 같은 조직이므로 이름 일부로 찾는다.
 *
 * 사용 중지된 사람은 어느 설치에서든 나오지 않는다 — 새로 공유하거나 맡길 수 없다.
 */
export async function searchUsers(
  userId: string,
  raw: string,
  exclude: string[],
  opts: { includeSelf?: boolean } = {},
): Promise<UserHit[]> {
  const q = raw.trim();
  if (q.length < 1) return [];

  // 공유 대상 고를 때는 자기 자신이 나오면 안 되지만, 메일 받는 사람에는
  // 자기 주소를 넣는 일이 흔하다.
  const notIn = opts.includeSelf ? exclude : [userId, ...exclude];
  const openInstall = (await getInstanceSettings()).signupPolicy === "OPEN";
  let match;
  if (openInstall) {
    const exact = normalizeEmail(q);
    if (!exact) return [];
    match = [{ email: exact }];
  } else {
    match = [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }];
  }

  return prisma.user.findMany({
    where: { id: { notIn }, disabledAt: null, OR: match },
    select: { id: true, name: true, email: true, avatarColor: true, department: true },
    orderBy: { name: "asc" },
    take: 8,
  });
}
