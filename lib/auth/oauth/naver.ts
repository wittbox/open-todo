import { fetchJson, OAuthError, type OAuthProvider } from "@/lib/auth/oauth/types";

/**
 * 네이버 로그인 — state 필수, Client Secret.
 *
 * 토큰 주소는 실패해도 HTTP 200 에 `error` 를 담아 돌려주므로 본문을 확인한다.
 * 네이버는 이메일이 확인된 것인지 알려 주지 않는다 — 그래서 **늘 확인 메일을 한 번 거친다**.
 */

const AUTHORIZE = "https://nid.naver.com/oauth2.0/authorize";
const TOKEN = "https://nid.naver.com/oauth2.0/token";
const ME = "https://openapi.naver.com/v1/nid/me";

export const naver: OAuthProvider = {
  authorizeUrl({ clientId, redirectUri, state }) {
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state });
    return `${AUTHORIZE}?${q}`;
  },

  async exchange({ code, clientId, clientSecret, state }) {
    const token = await fetchJson(
      TOKEN,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code, state }),
      },
      "naver token",
    );
    if (typeof token.error === "string") throw new OAuthError(`naver token: ${token.error}`);
    if (typeof token.access_token !== "string") throw new OAuthError("naver token: no access_token");

    const me = await fetchJson(ME, { headers: { Authorization: `Bearer ${token.access_token}` } }, "naver me");
    if (me.resultcode !== "00") throw new OAuthError(`naver me: ${String(me.resultcode)}`);
    const r = (me.response ?? {}) as { id?: string; email?: string; name?: string; nickname?: string };
    if (!r.id) throw new OAuthError("naver me: no id");

    return {
      providerAccountId: r.id,
      email: r.email ?? null,
      emailVerified: false,
      name: r.name ?? r.nickname ?? null,
    };
  },
};
