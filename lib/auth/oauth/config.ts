import type { AuthProvider } from "@/app/generated/prisma/enums";

/**
 * 어떤 외부 로그인이 켜져 있는가 — 서버에 열쇠(환경 변수)가 있는 제공자만.
 * 하나도 없으면 로그인 화면에는 이메일·비밀번호만 남는다.
 */

export const PROVIDERS: readonly AuthProvider[] = ["GOOGLE", "KAKAO", "NAVER"];

/**
 * 실제 서비스로 확인을 마친 제공자. 카카오·네이버는 코드는 있지만 실제 계정으로 로그인해 본 적이 없어
 * 아직 닫아 둔다 — 열쇠를 넣어도 버튼이 나오지 않고 시작·콜백 주소는 404 다. 확인하면 여기에 더한다.
 */
export const READY_PROVIDERS: readonly AuthProvider[] = ["GOOGLE"];

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
  if (!READY_PROVIDERS.includes(p)) return null;
  const clientId = process.env[`${p}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${p}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function enabledProviders(): AuthProvider[] {
  return PROVIDERS.filter((p) => providerKeys(p) != null);
}
