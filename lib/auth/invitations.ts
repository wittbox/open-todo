import { prisma } from "@/lib/db";
import { hashToken, newToken } from "@/lib/auth/tokens";

/**
 * 가입 초대 링크(`/join/<token>`). 초대만 모드에서 가입하는 길이다.
 * 링크 토큰은 저장하지 않고 SHA-256 만 둔다. 한 번 쓰면 끝.
 */

const DAY = 86_400_000;
export const INVITATION_TTL_DAYS = 7;

export async function createInvitation(input: {
  createdById: string | null;
  email?: string | null;
  ttlDays?: number;
  now?: Date;
}): Promise<{ token: string; id: string }> {
  const now = input.now ?? new Date();
  const { token, tokenHash } = newToken();
  const row = await prisma.invitation.create({
    data: {
      tokenHash,
      email: input.email ?? null,
      createdById: input.createdById,
      expiresAt: new Date(now.getTime() + (input.ttlDays ?? INVITATION_TTL_DAYS) * DAY),
    },
    select: { id: true },
  });
  return { token, id: row.id };
}

export type InvitationView = {
  id: string;
  /** 정해 둔 주소(소문자). 없으면 아무 주소나. */
  email: string | null;
  expiresAt: Date;
  inviterName: string | null;
};

/** 아직 쓸 수 있는 초대(만료 전, 안 씀). */
export async function findInvitation(token: unknown, now = new Date()): Promise<InvitationView | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const row = await prisma.invitation.findFirst({
    where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: now } },
    select: { id: true, email: true, expiresAt: true, createdBy: { select: { name: true } } },
  });
  return row && { id: row.id, email: row.email, expiresAt: row.expiresAt, inviterName: row.createdBy?.name ?? null };
}

/** 초대를 쓴다. 두 사람이 동시에 눌러도 한 사람만 성공한다. */
export async function redeemInvitation(id: string, userId: string, now = new Date()): Promise<boolean> {
  const { count } = await prisma.invitation.updateMany({
    where: { id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now, usedById: userId },
  });
  return count === 1;
}
