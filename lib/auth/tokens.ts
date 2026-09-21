import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";
import type { TokenPurpose } from "@/app/generated/prisma/enums";

/**
 * 메일로 보내는 일회용 링크의 토큰.
 *
 * 링크에는 무작위 32바이트, DB 에는 그 SHA-256 만 둔다 — DB 가 새어도 링크를 만들어 낼 수 없다.
 * 한 번 쓰면 끝이고, 같은 목적으로 새 링크를 보내면 앞서 보낸 링크는 무효가 된다.
 */

export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const HOUR = 3_600_000;

/** 목적마다 유효 시간 */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  VERIFY_EMAIL: 24 * HOUR,
  RESET_PASSWORD: HOUR / 2,
  OAUTH_SIGNUP: 24 * HOUR,
};

/** 새 링크를 만든다. 같은 (목적, 주소)로 먼저 보낸 것 중 아직 안 쓴 것은 무효로 한다. */
export async function issueToken(input: {
  purpose: TokenPurpose;
  email: string;
  userId?: string | null;
  data?: Prisma.InputJsonValue;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const { token, tokenHash } = newToken();
  await prisma.$transaction([
    prisma.verificationToken.updateMany({
      where: { purpose: input.purpose, email: input.email, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.verificationToken.create({
      data: {
        purpose: input.purpose,
        tokenHash,
        email: input.email,
        userId: input.userId ?? null,
        data: input.data,
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[input.purpose]),
      },
    }),
  ]);
  return token;
}

export type UsedToken = { id: string; email: string; userId: string | null; data: Prisma.JsonValue | null };

/**
 * 링크를 쓴다 — 목적이 맞고, 만료 전이고, 아직 안 쓴 것만. 두 번 눌러도 한 번만 성공한다(원자적 갱신).
 */
export async function consumeToken(purpose: TokenPurpose, token: unknown, now = new Date()): Promise<UsedToken | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const { count } = await prisma.verificationToken.updateMany({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (count !== 1) return null;
  return prisma.verificationToken.findUnique({
    where: { tokenHash },
    select: { id: true, email: true, userId: true, data: true },
  });
}

/** 링크가 아직 쓸 수 있는지만 본다(화면을 그릴 때). 쓰지는 않는다. */
export async function peekToken(purpose: TokenPurpose, token: unknown, now = new Date()): Promise<UsedToken | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  return prisma.verificationToken.findFirst({
    where: { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { gt: now } },
    select: { id: true, email: true, userId: true, data: true },
  });
}
