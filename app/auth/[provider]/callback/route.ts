import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { providerFromSlug, providerKeys, SLUG } from "@/lib/auth/oauth/config";
import { callbackUrl, IMPLS } from "@/lib/auth/oauth";
import { cookieOptions, PENDING_COOKIE, PENDING_MAX_AGE, readTx, signPending, TX_COOKIE } from "@/lib/auth/oauth/tx";
import { resolveOAuth } from "@/lib/auth/oauth/resolve";
import { completeSignIn } from "@/lib/auth/users";
import { getSessionUserId } from "@/lib/session";
import { getRequestPrefs } from "@/lib/prefs";
import { redirectTo } from "@/lib/http";

/**
 * 제공자에서 돌아오는 곳. state 를 쿠키와 맞춰 보고, code 로 누구인지 알아낸 뒤 연결 규칙(lib/auth/oauth/resolve.ts)대로 보낸다.
 * 무엇이 틀렸는지는 로그에만 남기고 화면에는 "로그인하지 못했습니다" 하나로 보인다.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/auth/[provider]/callback">) {
  const provider = providerFromSlug((await ctx.params).provider);
  const keys = provider ? providerKeys(provider) : null;
  if (!provider || !keys) return new NextResponse("Not found", { status: 404 });

  const jar = await cookies();
  const tx = await readTx(jar.get(TX_COOKIE)?.value);
  // 한 번 쓰면 끝 — 뒤로 가기로 같은 콜백을 다시 열어도 쓰지 못하게.
  jar.set(TX_COOKIE, "", cookieOptions(0));

  const q = req.nextUrl.searchParams;
  const loginNotice = (notice: string) => redirectTo(`/login?${new URLSearchParams({ notice, provider: SLUG[provider] })}`);

  // 사용자가 제공자 화면에서 취소했다.
  if (q.get("error")) return loginNotice("oauthCanceled");

  const state = q.get("state") ?? "";
  const code = q.get("code");
  if (!tx || tx.provider !== provider || !code || !sameString(state, tx.state)) {
    console.warn(`[oauth] ${provider}: state mismatch or no start record`);
    return loginNotice("oauthFailed");
  }

  let profile;
  try {
    profile = await IMPLS[provider].exchange({
      code,
      clientId: keys.clientId,
      clientSecret: keys.clientSecret,
      redirectUri: callbackUrl(provider),
      state: tx.state,
      codeVerifier: tx.verifier,
      nonce: tx.nonce,
    });
  } catch (e) {
    console.error(`[oauth] ${provider}:`, e instanceof Error ? e.message : e);
    return loginNotice("oauthFailed");
  }

  const outcome = await resolveOAuth({
    provider,
    profile,
    tx,
    sessionUserId: await getSessionUserId(),
    locale: (await getRequestPrefs()).locale,
  });

  switch (outcome.kind) {
    case "signIn":
      await completeSignIn(outcome.userId);
      return redirectTo(tx.returnTo);
    case "linked":
      return redirectTo(tx.returnTo);
    case "needEmail":
      jar.set(PENDING_COOKIE, await signPending(outcome.pending), cookieOptions(PENDING_MAX_AGE));
      return redirectTo("/auth/email");
    case "notice":
      return loginNotice(outcome.notice);
  }
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
