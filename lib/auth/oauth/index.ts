import type { AuthProvider } from "@/app/generated/prisma/enums";
import { appUrl } from "@/lib/app-url";
import { SLUG } from "@/lib/auth/oauth/config";
import { google } from "@/lib/auth/oauth/google";
import { kakao } from "@/lib/auth/oauth/kakao";
import { naver } from "@/lib/auth/oauth/naver";
import type { OAuthProvider } from "@/lib/auth/oauth/types";

export const IMPLS: Record<AuthProvider, OAuthProvider> = { GOOGLE: google, KAKAO: kakao, NAVER: naver };

/**
 * 제공자가 돌려보낼 주소 — 제공자 콘솔에 등록한 것과 글자 하나까지 같아야 한다.
 * 요청 주소가 아니라 설치 주소(APP_BASE_URL)로 만든다(프록시 뒤에서 요청 주소는 틀린다).
 */
export function callbackUrl(provider: AuthProvider): string {
  return appUrl(`/auth/${SLUG[provider]}/callback`);
}
