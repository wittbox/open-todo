import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { providerFromSlug, providerKeys } from "@/lib/auth/oauth/config";
import { callbackUrl, IMPLS } from "@/lib/auth/oauth";
import { cookieOptions, pkceChallenge, randomToken, signTx, TX_COOKIE, TX_MAX_AGE, type OAuthTx } from "@/lib/auth/oauth/tx";
import { getSessionUserId } from "@/lib/session";
import { internalPath, redirectTo } from "@/lib/http";
import { HOME_PATH } from "@/lib/home";

/**
 * 제공자 로그인 시작 — state·PKCE·nonce 를 만들어 서명한 쿠키에 두고 제공자로 보낸다.
 *
 *   /auth/google/start?returnTo=/calendar     로그인·가입
 *   /auth/google/start?invite=<초대 토큰>      초대 링크로 가입
 *   /auth/google/start?intent=link            로그인한 사람이 설정에서 계정 연결
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/auth/[provider]/start">) {
  const provider = providerFromSlug((await ctx.params).provider);
  const keys = provider ? providerKeys(provider) : null;
  if (!provider || !keys) return new NextResponse("Not found", { status: 404 });

  const q = req.nextUrl.searchParams;
  const intent = q.get("intent") === "link" ? "link" : "login";
  const linkUserId = intent === "link" ? await getSessionUserId() : null;
  if (intent === "link" && !linkUserId) return redirectTo("/login");

  const invite = q.get("invite");
  const verifier = randomToken();
  const tx: OAuthTx = {
    provider,
    state: randomToken(),
    verifier,
    nonce: randomToken(),
    returnTo: internalPath(q.get("returnTo") ?? HOME_PATH),
    intent,
    ...(linkUserId ? { linkUserId } : {}),
    ...(invite && invite.length <= 200 ? { invite } : {}),
  };
  (await cookies()).set(TX_COOKIE, await signTx(tx), cookieOptions(TX_MAX_AGE));

  const url = IMPLS[provider].authorizeUrl({
    clientId: keys.clientId,
    redirectUri: callbackUrl(provider),
    state: tx.state,
    codeChallenge: pkceChallenge(verifier),
    nonce: tx.nonce,
  });
  return NextResponse.redirect(url, 303);
}
