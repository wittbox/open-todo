import { cache } from "react";
import { prisma } from "@/lib/db";
import { PermissionError } from "@/lib/permissions";
import { requireUserId } from "@/lib/session";

/**
 * 이 설치의 관리자인지. 목록·프로젝트 권한(lib/permissions.ts)과는 다른 축이다 —
 * 여기서 보는 것은 "설치를 관리하는 사람" 이고, 그쪽은 "이 목록을 볼 수 있는 사람" 이다.
 */

export const isAdmin = cache(async (userId: string): Promise<boolean> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === "ADMIN";
});

/** 관리자 화면·액션의 첫 줄. 관리자가 아니면 화면 자체를 없는 것으로 본다. */
export async function requireAdmin(): Promise<string> {
  const userId = await requireUserId();
  if (!(await isAdmin(userId))) throw new PermissionError();
  return userId;
}
