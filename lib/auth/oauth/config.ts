import type { AuthProvider } from "@/app/generated/prisma/enums";

/**
 * 어떤 외부 로그인이 켜져 있는가 — 서버에 열쇠(환경 변수)가 있는 제공자만.
 * 하나도 없으면 로그인 화면에는 이메일·비밀번호만 남는다.
 */

export const PROVIDERS: readonly AuthProvider[] = ["GOOGLE", "KAKAO", "NAVER"];

export type ProviderSlug = "google" | "kakao" | "naver";

export const SLUG: Record<AuthProvider, ProviderSlug> = { GOOGLE: "google", KAKAO: "kakao", NAVER: "naver" };

/** 메일·기록에 쓰는 제공자 이름(번역하지 않는 고유명사) */
export const PROVIDER_LABEL: Record<AuthProvider, string> = { GOOGLE: "Google", KAKAO: "Kakao", NAVER: "NAVER" };

export function providerFromSlug(slug: string): AuthProvider | null {
  return PROVIDERS.find((p) => SLUG[p] === slug) ?? null;
}

export type ProviderKeys = { clientId: string; clientSecret: string };

/** 그 제공자의 열쇠. 둘 다 있어야 켜진다(카카오도 Client Secret 을 켜 두는 것을 전제로 한다). */
export function providerKeys(p: AuthProvider): ProviderKeys | null {
  const clientId = process.env[`${p}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${p}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function enabledProviders(): AuthProvider[] {
  return PROVIDERS.filter((p) => providerKeys(p) != null);
}
