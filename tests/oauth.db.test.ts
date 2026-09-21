import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@/lib/db";
import type { MailMessage } from "@/lib/mail";
import type { SignupPolicy } from "@/app/generated/prisma/enums";

/**
 * Google·카카오·네이버 로그인 (가짜 제공자).
 *
 * 제공자 서버 대신 fetch 를 갈아끼운다. 실제 제공자 로그인은 열쇠를 넣은 뒤 사람이 확인한다(U6).
 * 여기서 지키는 것: 제공자 응답 검증(대상·nonce·만료·확인된 이메일) · 로그인 CSRF(state) ·
 * 같은 이메일의 기존 계정에 **자동으로 붙지 않기** · 연결은 로그인한 본인에게만 · 가입 정책·초대.
 */

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (opts?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
  headers: async () => new Headers(),
}));
const { sent } = vi.hoisted(() => ({ sent: [] as MailMessage[] }));
vi.mock("@/lib/mail", () => ({
  getMailProvider: () => ({
    name: "test",
    async send(msg: MailMessage) {
      sent.push(msg);
      return { ok: true };
    },
  }),
}));

const { google } = await import("@/lib/auth/oauth/google");
const { kakao } = await import("@/lib/auth/oauth/kakao");
const { naver } = await import("@/lib/auth/oauth/naver");
const { signTx, readTx, signPending, readPending } = await import("@/lib/auth/oauth/tx");
const { resolveOAuth, startOAuthEmailSignup, completeOAuthSignup } = await import("@/lib/auth/oauth/resolve");
const { createInvitation } = await import("@/lib/auth/invitations");
const { resetRateLimits } = await import("@/lib/auth/rate-limit");
const { verifySession } = await import("@/lib/session-token");
const { GET: start } = await import("@/app/auth/[provider]/start/route");
const { GET: callback } = await import("@/app/auth/[provider]/callback/route");

const hasDb = Boolean(process.env.DATABASE_URL);
const d = describe.skipIf(!hasDb);
const tag = `oauth-${process.pid}`;
const addr = (k: string) => `${k}-${tag}@example.com`;
const CLIENT = "client-123.apps.googleusercontent.com";

/* ── 가짜 제공자 ─────────────────────────────────────── */

type Route = (url: string, init?: RequestInit) => unknown;
let routes: Record<string, Route> = {};
function fakeFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = String(url);
  const key = Object.keys(routes).find((k) => u.startsWith(k));
  if (!key) return Promise.reject(new Error(`unexpected fetch ${u}`));
  const body = routes[key](u, init);
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}

async function idToken(claims: Record<string, unknown>) {
  // 서명은 보지 않는다(TLS 로 직접 받은 토큰). 아무 열쇠로나 만든다.
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("x".repeat(32)));
}

const now = () => Math.floor(Date.now() / 1000);
function googleReturns(claims: Record<string, unknown>) {
  routes = {
    "https://oauth2.googleapis.com/token": () => ({ access_token: "at", id_token: pendingToken }),
  };
  let pendingToken = "";
  return idToken({ iss: "https://accounts.google.com", aud: CLIENT, exp: now() + 300, ...claims }).then((t) => {
    pendingToken = t;
  });
}

const exchangeInput = { code: "c", clientId: CLIENT, clientSecret: "s", redirectUri: "https://todo.example.com/auth/google/callback", state: "st", codeVerifier: "v", nonce: "n1" };

beforeAll(() => {
  vi.stubGlobal("fetch", fakeFetch);
  process.env.SESSION_SECRET ??= "test-session-secret-0123456789abcdef0123456789";
});
afterAll(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  jar.clear();
  sent.length = 0;
  resetRateLimits();
});

describe("Google 응답 검증", () => {
  it("로그인 주소에 state·PKCE(S256)·nonce 가 실린다", () => {
    const url = new URL(google.authorizeUrl({ clientId: CLIENT, redirectUri: "https://x/cb", state: "S", codeChallenge: "C", nonce: "N" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ state: "S", code_challenge: "C", code_challenge_method: "S256", nonce: "N", scope: "openid email profile" });
  });

  it("맞는 토큰이면 누구인지 알려 준다", async () => {
    await googleReturns({ sub: "g-1", email: "Kim@Example.com", email_verified: true, name: "김철수", nonce: "n1" });
    expect(await google.exchange(exchangeInput)).toEqual({ providerAccountId: "g-1", email: "Kim@Example.com", emailVerified: true, name: "김철수" });
  });

  it.each([
    ["다른 앱에 발급된 토큰", { aud: "someone-else" }],
    ["다른 로그인 시도의 토큰(nonce)", { nonce: "other" }],
    ["만료된 토큰", { exp: now() - 3600 }],
    ["다른 발급자", { iss: "https://evil.example" }],
  ])("%s 은 받지 않는다", async (_label, bad) => {
    await googleReturns({ sub: "g-1", email: "a@b.com", email_verified: true, nonce: "n1", ...bad });
    await expect(google.exchange(exchangeInput)).rejects.toThrow();
  });
});

describe("카카오·네이버 응답", () => {
  it("카카오 이메일은 '유효하고 인증됨' 일 때만 확인된 것", async () => {
    const me = (acct: object) => {
      routes = {
        "https://kauth.kakao.com/oauth/token": () => ({ access_token: "at" }),
        "https://kapi.kakao.com/v2/user/me": () => ({ id: 42, kakao_account: acct }),
      };
    };
    me({ email: "a@b.com", is_email_valid: true, is_email_verified: true, profile: { nickname: "카카오" } });
    expect(await kakao.exchange(exchangeInput)).toEqual({ providerAccountId: "42", email: "a@b.com", emailVerified: true, name: "카카오" });
    me({ email: "a@b.com", is_email_valid: true, is_email_verified: false });
    expect((await kakao.exchange(exchangeInput)).emailVerified).toBe(false);
  });

  it("카카오는 비즈 앱 설정이 없으면 이메일 동의를 묻지 않는다", () => {
    const scope = () => new URL(kakao.authorizeUrl({ clientId: "k", redirectUri: "https://x/cb", state: "S", codeChallenge: "C", nonce: "N" })).searchParams.get("scope");
    expect(scope()).toBe("profile_nickname");
    process.env.KAKAO_REQUEST_EMAIL = "1";
    expect(scope()).toBe("profile_nickname,account_email");
    delete process.env.KAKAO_REQUEST_EMAIL;
  });

  it("네이버는 200 에 담긴 오류도 실패로 보고, 이메일은 늘 확인 안 됨", async () => {
    routes = { "https://nid.naver.com/oauth2.0/token": () => ({ error: "invalid_request", error_description: "bad" }) };
    await expect(naver.exchange(exchangeInput)).rejects.toThrow(/invalid_request/);
    routes = {
      "https://nid.naver.com/oauth2.0/token": () => ({ access_token: "at" }),
      "https://openapi.naver.com/v1/nid/me": () => ({ resultcode: "00", response: { id: "nv-1", email: "a@naver.com", name: "네이버" } }),
    };
    expect(await naver.exchange(exchangeInput)).toEqual({ providerAccountId: "nv-1", email: "a@naver.com", emailVerified: false, name: "네이버" });
  });
});

describe("다녀오는 동안의 쿠키", () => {
  it("서명이 맞아야 읽히고, 서로 바꿔 끼울 수 없다", async () => {
    const tx = await signTx({ provider: "GOOGLE", state: "s", verifier: "v", nonce: "n", returnTo: "/", intent: "login" });
    expect((await readTx(tx))?.state).toBe("s");
    expect(await readTx(tx.slice(0, -2) + "xx")).toBeNull();
    expect(await readPending(tx)).toBeNull();
    const pending = await signPending({ provider: "NAVER", providerAccountId: "1", name: null, suggestedEmail: null });
    expect(await readTx(pending)).toBeNull();
    // 세션 쿠키로도 쓸 수 없다.
    expect(await verifySession(tx)).toBeNull();
  });
});

/* ── 연결 규칙 (DB) ─────────────────────────────────── */

let savedPolicy: { signupPolicy: SignupPolicy; allowedDomains: string[] } | null = null;
async function policy(signupPolicy: SignupPolicy, allowedDomains: string[] = []) {
  await prisma.instanceSettings.upsert({ where: { id: "singleton" }, create: { signupPolicy, allowedDomains }, update: { signupPolicy, allowedDomains } });
}
const txLogin = { provider: "GOOGLE" as const, state: "s", verifier: "v", nonce: "n", returnTo: "/", intent: "login" as const };
const profile = (id: string, email: string | null, verified = true) => ({ providerAccountId: `${id}-${tag}`, email, emailVerified: verified, name: "제공자 이름" });

d("연결 규칙", () => {
  beforeAll(async () => {
    savedPolicy = await prisma.instanceSettings.findUnique({ where: { id: "singleton" }, select: { signupPolicy: true, allowedDomains: true } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: tag } } });
    await prisma.verificationToken.deleteMany({ where: { email: { contains: tag } } });
    await prisma.invitation.deleteMany({ where: { email: { contains: tag } } });
    if (savedPolicy) await policy(savedPolicy.signupPolicy, savedPolicy.allowedDomains);
    else await prisma.instanceSettings.deleteMany({ where: { id: "singleton" } });
  });

  it("처음 보는 Google 계정 + 확인된 이메일 + 누구나 → 사용자를 만들고 로그인", async () => {
    await policy("OPEN");
    const out = await resolveOAuth({ provider: "GOOGLE", profile: profile("new", addr("new").toUpperCase()), tx: txLogin, sessionUserId: null, locale: "ko" });
    expect(out.kind).toBe("signIn");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: addr("new") }, select: { id: true, passwordHash: true, emailVerifiedAt: true, accounts: true } });
    expect(out.kind === "signIn" && out.userId).toBe(user.id);
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.accounts).toHaveLength(1);

    // 다음에는 그냥 로그인
    expect(await resolveOAuth({ provider: "GOOGLE", profile: profile("new", null), tx: txLogin, sessionUserId: null, locale: "ko" })).toEqual({ kind: "signIn", userId: user.id });
  });

  it("같은 이메일의 계정이 있으면 자동으로 잇지 않는다", async () => {
    await policy("OPEN");
    const victim = await prisma.user.create({ data: { email: addr("victim"), name: "원래 주인", emailVerifiedAt: new Date() } });
    const out = await resolveOAuth({ provider: "GOOGLE", profile: profile("attacker", addr("victim")), tx: txLogin, sessionUserId: null, locale: "ko" });
    expect(out).toEqual({ kind: "notice", notice: "oauthExists" });
    expect(await prisma.account.count({ where: { userId: victim.id } })).toBe(0);
  });

  it("사용 중지된 사람은 들어오지 못한다", async () => {
    const u = await prisma.user.create({ data: { email: addr("off"), name: "막힘", emailVerifiedAt: new Date(), disabledAt: new Date() } });
    await prisma.account.create({ data: { userId: u.id, provider: "GOOGLE", providerAccountId: `off-${tag}` } });
    expect(await resolveOAuth({ provider: "GOOGLE", profile: profile("off", null), tx: txLogin, sessionUserId: null, locale: "ko" })).toEqual({ kind: "notice", notice: "disabled" });
  });

  it("초대만 모드 — 초대 없이 온 새 계정은 가입하지 못하고, 이메일도 묻지 않는다", async () => {
    await policy("INVITE_ONLY");
    expect(await resolveOAuth({ provider: "GOOGLE", profile: profile("closed", addr("closed")), tx: txLogin, sessionUserId: null, locale: "ko" })).toEqual({ kind: "notice", notice: "signupClosed" });
    expect(await resolveOAuth({ provider: "NAVER", profile: profile("closed-nv", addr("closed-nv"), false), tx: { ...txLogin, provider: "NAVER" }, sessionUserId: null, locale: "ko" })).toEqual({ kind: "notice", notice: "signupClosed" });
  });

  it("허용 도메인 모드 — 다른 도메인의 확인된 주소는 거절", async () => {
    await policy("DOMAIN", ["team.example"]);
    expect(await resolveOAuth({ provider: "GOOGLE", profile: profile("dom", addr("dom")), tx: txLogin, sessionUserId: null, locale: "ko" })).toEqual({
      kind: "notice",
      notice: "domainNotAllowed",
      domains: ["team.example"],
    });
  });

  it("주소가 정해진 초대 — 같은 Google 주소면 곧바로, 다르면 초대 주소로 확인 메일", async () => {
    await policy("INVITE_ONLY");
    const same = await createInvitation({ createdById: null, email: addr("inv-same") });
    const out = await resolveOAuth({ provider: "GOOGLE", profile: profile("inv-same", addr("inv-same")), tx: { ...txLogin, invite: same.token }, sessionUserId: null, locale: "ko" });
    expect(out.kind).toBe("signIn");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: same.id } })).usedAt).not.toBeNull();

    const other = await createInvitation({ createdById: null, email: addr("inv-other") });
    const out2 = await resolveOAuth({ provider: "GOOGLE", profile: profile("inv-other", addr("personal")), tx: { ...txLogin, invite: other.token }, sessionUserId: null, locale: "ko" });
    expect(out2).toMatchObject({ kind: "needEmail", pending: { suggestedEmail: addr("inv-other"), invite: other.token } });
  });

  it("네이버(이메일 확인 안 됨) → 이메일 적기 → 확인 링크 → 사용자와 연결", async () => {
    await policy("OPEN");
    const out = await resolveOAuth({ provider: "NAVER", profile: profile("nv", addr("nv"), false), tx: { ...txLogin, provider: "NAVER" }, sessionUserId: null, locale: "ko" });
    expect(out.kind).toBe("needEmail");
    if (out.kind !== "needEmail") return;
    expect(await prisma.user.findUnique({ where: { email: addr("nv") } })).toBeNull();

    const started = await startOAuthEmailSignup({ pending: out.pending, email: addr("nv"), name: "네이버 사람", ip: null, locale: "ko" });
    expect(started).toEqual({ ok: true, sentTo: addr("nv") });
    const token = /token=([A-Za-z0-9_-]+)/.exec(sent[0].text)?.[1];
    const done = await completeOAuthSignup(token);
    expect(done.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: addr("nv") }, select: { id: true, name: true, accounts: { select: { provider: true } } } });
    expect(user.name).toBe("네이버 사람");
    expect(user.accounts).toEqual([{ provider: "NAVER" }]);
    expect(await completeOAuthSignup(token)).toMatchObject({ ok: false, error: "linkInvalid" });
  });

  it("확인 링크를 누르기 전에 그 주소의 계정이 생겼으면 네이버 계정을 붙이지 않는다", async () => {
    await policy("OPEN");
    const pending = { provider: "NAVER" as const, providerAccountId: `race-${tag}`, name: "경쟁", suggestedEmail: null };
    await startOAuthEmailSignup({ pending, email: addr("race"), name: "경쟁", ip: null, locale: "ko" });
    const token = /token=([A-Za-z0-9_-]+)/.exec(sent[0].text)?.[1];
    const owner = await prisma.user.create({ data: { email: addr("race"), name: "먼저 온 사람", emailVerifiedAt: new Date() } });
    expect(await completeOAuthSignup(token)).toMatchObject({ ok: false, error: "accountExists" });
    expect(await prisma.account.count({ where: { userId: owner.id } })).toBe(0);
  });

  describe("설정에서 시작한 연결", () => {
    let me: string;
    let someoneElse: string;
    beforeAll(async () => {
      me = (await prisma.user.create({ data: { email: addr("me"), name: "나", emailVerifiedAt: new Date() } })).id;
      someoneElse = (await prisma.user.create({ data: { email: addr("else"), name: "남", emailVerifiedAt: new Date() } })).id;
      await prisma.account.create({ data: { userId: someoneElse, provider: "KAKAO", providerAccountId: `kk-else-${tag}` } });
    });
    const txLink = (userId: string) => ({ ...txLogin, provider: "KAKAO" as const, intent: "link" as const, linkUserId: userId });

    it("시작한 사람과 지금 세션이 다르면 거절", async () => {
      expect(await resolveOAuth({ provider: "KAKAO", profile: profile("kk-me", null, false), tx: txLink(me), sessionUserId: someoneElse, locale: "ko" })).toEqual({ kind: "notice", notice: "oauthFailed" });
    });

    it("남에게 붙은 카카오 계정은 가져올 수 없다", async () => {
      const out = await resolveOAuth({ provider: "KAKAO", profile: { ...profile("x", null, false), providerAccountId: `kk-else-${tag}` }, tx: txLink(me), sessionUserId: me, locale: "ko" });
      expect(out).toEqual({ kind: "notice", notice: "accountInUse" });
    });

    it("본인에게 붙인다 — 이메일이 달라도(연결은 로그인한 본인이 한 것)", async () => {
      expect(await resolveOAuth({ provider: "KAKAO", profile: profile("kk-me", "other@kakao.example", false), tx: txLink(me), sessionUserId: me, locale: "ko" })).toEqual({ kind: "linked", userId: me });
      // 제공자마다 하나 — 두 번째 카카오 계정은 먼저 해제해야 한다.
      expect(await resolveOAuth({ provider: "KAKAO", profile: profile("kk-me-2", null, false), tx: txLink(me), sessionUserId: me, locale: "ko" })).toEqual({ kind: "notice", notice: "alreadyLinked" });
    });
  });
});

/* ── 시작 → 콜백 왕복 (라우트) ──────────────────────── */

d("시작 → 콜백 왕복", () => {
  const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) }) as never;
  const req = (path: string) => new NextRequest(`https://todo.example.com${path}`);

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT;
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.APP_BASE_URL = "https://todo.example.com";
    savedPolicy = await prisma.instanceSettings.findUnique({ where: { id: "singleton" }, select: { signupPolicy: true, allowedDomains: true } });
    await policy("OPEN");
  });
  afterAll(async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.APP_BASE_URL;
    await prisma.user.deleteMany({ where: { email: { contains: tag } } });
    if (savedPolicy) await policy(savedPolicy.signupPolicy, savedPolicy.allowedDomains);
    else await prisma.instanceSettings.deleteMany({ where: { id: "singleton" } });
  });
  afterEach(() => jar.clear());

  it("열쇠가 없는 제공자는 없는 주소", async () => {
    expect((await start(req("/auth/naver/start"), ctx("naver"))).status).toBe(404);
    expect((await start(req("/auth/github/start"), ctx("github"))).status).toBe(404);
  });

  it("로그인 → 사용자 생성 → 세션 → 원래 가려던 곳", async () => {
    const res = await start(req("/auth/google/start?returnTo=%2Fcalendar"), ctx("google"));
    const to = new URL(res.headers.get("Location")!);
    expect(to.host).toBe("accounts.google.com");
    expect(to.searchParams.get("redirect_uri")).toBe("https://todo.example.com/auth/google/callback");
    const state = to.searchParams.get("state")!;
    const tx = (await readTx(jar.get("oauth_tx")))!;

    await googleReturns({ sub: `route-${tag}`, email: addr("route"), email_verified: true, name: "왕복", nonce: tx.nonce });
    const back = await callback(req(`/auth/google/callback?code=abc&state=${state}`), ctx("google"));
    expect(back.headers.get("Location")).toBe("/calendar");
    expect(jar.has("oauth_tx")).toBe(false);
    const cookie = jar.get("__Host-todo_session");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: addr("route") } });
    expect((await verifySession(cookie!))?.sub).toBe(user.id);
  });

  it("state 가 다르면(남이 밀어 넣은 code) 로그인하지 않는다", async () => {
    await start(req("/auth/google/start"), ctx("google"));
    const back = await callback(req("/auth/google/callback?code=attacker-code&state=forged"), ctx("google"));
    expect(back.headers.get("Location")).toBe("/login?notice=oauthFailed&provider=google");
    expect([...jar.keys()].some((k) => k.includes("todo_session"))).toBe(false);
  });

  it("시작 기록(쿠키) 없이 온 콜백도 거절", async () => {
    const back = await callback(req("/auth/google/callback?code=abc&state=x"), ctx("google"));
    expect(back.headers.get("Location")).toBe("/login?notice=oauthFailed&provider=google");
  });

  it("제공자 화면에서 취소하면 안내만", async () => {
    await start(req("/auth/google/start"), ctx("google"));
    const back = await callback(req("/auth/google/callback?error=access_denied"), ctx("google"));
    expect(back.headers.get("Location")).toBe("/login?notice=oauthCanceled&provider=google");
  });

  it("외부로 나가는 returnTo 는 무시한다", async () => {
    await start(req("/auth/google/start?returnTo=%2F%2Fevil.example"), ctx("google"));
    expect((await readTx(jar.get("oauth_tx")))?.returnTo).not.toContain("evil");
  });
});
