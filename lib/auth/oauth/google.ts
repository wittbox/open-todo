import { decodeJwt } from "jose";
import { fetchJson, OAuthError, type OAuthProvider } from "@/lib/auth/oauth/types";

/**
 * Google — OpenID Connect. state + PKCE(S256) + nonce.
 *
 * ID 토큰은 우리 서버가 Google 토큰 주소에서 TLS 로 **직접** 받은 것이라 서명 대신 TLS 로 발급자를 믿는다
 * (OpenID Connect Core 3.1.3.7). 그래도 발급자·대상(client_id)·만료·nonce 는 확인한다 — 다른 앱에 발급된
 * 토큰이나 다른 로그인 시도의 토큰을 받지 않게.
 */

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const google: OAuthProvider = {
  authorizeUrl({ clientId, redirectUri, state, codeChallenge, nonce }) {
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      // 여러 Google 계정을 쓰는 사람이 고를 수 있게
      prompt: "select_account",
    });
    return `${AUTHORIZE}?${q}`;
  },

  async exchange({ code, clientId, clientSecret, redirectUri, codeVerifier, nonce }) {
    const body = await fetchJson(
      TOKEN,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      },
      "google token",
    );
    if (typeof body.id_token !== "string") throw new OAuthError("google token: no id_token");

    let claims: ReturnType<typeof decodeJwt>;
    try {
      claims = decodeJwt(body.id_token);
    } catch {
      throw new OAuthError("google: could not read the id_token");
    }
    const now = Math.floor(Date.now() / 1000);
    if (!ISSUERS.includes(String(claims.iss))) throw new OAuthError("google: wrong issuer");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(clientId)) throw new OAuthError("google: wrong audience");
    if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new OAuthError("google: expired token");
    if (claims.nonce !== nonce) throw new OAuthError("google: nonce mismatch");
    if (typeof claims.sub !== "string" || !claims.sub) throw new OAuthError("google: no sub");

    return {
      providerAccountId: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === "string" ? claims.name : null,
    };
  },
};
