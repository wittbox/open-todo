/**
 * 외부 로그인 제공자 하나가 해 주는 일 — 로그인 화면으로 보낼 주소를 만들고, 돌아온 code 로 "누구인지" 를 알아낸다.
 * 제공자의 토큰은 여기서 쓰고 버린다(저장하지 않는다).
 */

export type ProviderProfile = {
  /** 제공자 안에서 바뀌지 않는 사용자 번호 */
  providerAccountId: string;
  /** 소문자로 정리 전의 주소. 없을 수 있다(카카오 비즈 앱이 아닐 때, 네이버에서 제공 동의를 안 했을 때). */
  email: string | null;
  /** 제공자가 "이 주소는 이 사람 것" 이라고 확인해 준 경우만 true */
  emailVerified: boolean;
  name: string | null;
};

export type AuthorizeInput = {
  clientId: string;
  redirectUri: string;
  state: string;
  /** PKCE(S256) — 지원하는 제공자만 */
  codeChallenge: string;
  /** OpenID Connect nonce — 지원하는 제공자만 */
  nonce: string;
};

export type ExchangeInput = {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  nonce: string;
};

export interface OAuthProvider {
  authorizeUrl(input: AuthorizeInput): string;
  exchange(input: ExchangeInput): Promise<ProviderProfile>;
}

/** 제공자 응답이 예상과 다를 때. 사용자에게는 "로그인하지 못했습니다" 로만 보인다. */
export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

/** JSON 을 받는다. 실패 응답의 본문은 로그에 남길 만큼만 자른다(토큰이 섞여 있을 수 있어 길게 남기지 않는다). */
export async function fetchJson(url: string, init: RequestInit, what: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch (e) {
    throw new OAuthError(`${what}: connection failed (${e instanceof Error ? e.name : "unknown"})`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || typeof body !== "object") {
    const err = body && typeof body.error === "string" ? body.error : "";
    throw new OAuthError(`${what}: HTTP ${res.status} ${err}`.trim());
  }
  return body;
}
