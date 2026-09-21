import { fetchJson, OAuthError, type OAuthProvider } from "@/lib/auth/oauth/types";

/**
 * 카카오 로그인 — state, Client Secret.
 *
 * 이메일은 **비즈 앱**으로 전환해야 받을 수 있다. 전환했으면 `KAKAO_REQUEST_EMAIL=1` — 안 한 앱에서 이메일 동의를
 * 요청하면 로그인 자체가 실패하므로 기본은 묻지 않는다. 이메일을 받아도 카카오가 "유효하고 인증됨" 이라고 할 때만 믿는다.
 */

const AUTHORIZE = "https://kauth.kakao.com/oauth/authorize";
const TOKEN = "https://kauth.kakao.com/oauth/token";
const ME = "https://kapi.kakao.com/v2/user/me";

type KakaoAccount = {
  email?: string;
  is_email_valid?: boolean;
  is_email_verified?: boolean;
  profile?: { nickname?: string };
};

export const kakao: OAuthProvider = {
  authorizeUrl({ clientId, redirectUri, state }) {
    const scope = ["profile_nickname", ...(process.env.KAKAO_REQUEST_EMAIL === "1" ? ["account_email"] : [])];
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: scope.join(","),
    });
    return `${AUTHORIZE}?${q}`;
  },

  async exchange({ code, clientId, clientSecret, redirectUri }) {
    const token = await fetchJson(
      TOKEN,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
        }),
      },
      "kakao token",
    );
    if (typeof token.access_token !== "string") throw new OAuthError("kakao token: no access_token");

    const me = await fetchJson(ME, { headers: { Authorization: `Bearer ${token.access_token}` } }, "kakao me");
    if (typeof me.id !== "number" && typeof me.id !== "string") throw new OAuthError("kakao me: no id");
    const account = (me.kakao_account ?? {}) as KakaoAccount;
    const props = (me.properties ?? {}) as { nickname?: string };
    const email = typeof account.email === "string" ? account.email : null;

    return {
      providerAccountId: String(me.id),
      email,
      emailVerified: Boolean(email && account.is_email_valid === true && account.is_email_verified === true),
      name: account.profile?.nickname ?? props.nickname ?? null,
    };
  },
};
