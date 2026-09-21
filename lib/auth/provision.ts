import { prisma } from "@/lib/db";
import { translatorFor } from "@/i18n/server";
import type { AppLocale } from "@/i18n/locales";

/**
 * 가입 경로(이메일·Google·Kakao·Naver)가 함께 쓰는 사용자 준비 도우미.
 */

/** 사이드바 아바타 색. 사람마다 고정되게 열쇠(이메일 등)로 고른다. */
const AVATAR_COLORS = ["#c2185b", "#2564cf", "#a4373a", "#0f7b6c", "#4f52b2", "#8764b8"];

export function colorFor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/**
 * "작업" 홈이 되는 기본 목록. 없으면 작업을 넣을 곳이 없다.
 * "새로 만들 때" 가 아니라 "없으면" 만든다 — 어느 경로로 들어왔든 첫 로그인에 한 번.
 */
export async function ensureInbox(userId: string, locale: AppLocale = "ko"): Promise<void> {
  const inbox = await prisma.list.findFirst({
    where: { ownerId: userId, isInbox: true },
    select: { id: true },
  });
  if (!inbox) {
    await prisma.list.create({
      data: { ownerId: userId, name: translatorFor(locale)("tasks.defaults.inbox"), themeKey: "purple", order: "a0", isInbox: true },
    });
  }
}
