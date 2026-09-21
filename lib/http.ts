import { NextResponse } from "next/server";
import { HOME_PATH } from "@/lib/home";

/**
 * 앱 내부로 보내는 리다이렉트.
 *
 * NextResponse.redirect() 는 절대 URL 을 요구하는데, 그 절대 URL 을 요청에서 뽑으면
 * 프록시 뒤에서 깨진다. 컨테이너는 0.0.0.0:3000 에 바인딩되어 있어 req.nextUrl.origin
 * 이 https://0.0.0.0:3000 으로 잡히고, 브라우저는 그 주소로 따라가다 실패한다
 * (ERR_ADDRESS_INVALID). 실제로 테스트 로그인과 /t/{seq} 딥링크가 이 때문에 깨졌다.
 *
 * Location 헤더는 상대 경로를 허용한다(RFC 7231 §7.1.2). 브라우저가 자기가 요청한
 * 주소를 기준으로 풀기 때문에, 어떤 호스트명으로 들어왔든 그 호스트가 유지된다.
 * APP_BASE_URL 에 기대는 것보다 낫다 — 설정이 틀려도 리다이렉트는 맞는다.
 */
export function redirectTo(path: string, status: 303 | 307 = 307): NextResponse {
  return new NextResponse(null, {
    status,
    headers: { Location: internalPath(path) },
  });
}

/** 오픈 리다이렉트 방지 — 앱 내부 경로만 허용한다. */
export function internalPath(raw: string, fallback = HOME_PATH): string {
  if (!raw.startsWith("/")) return fallback;
  // "//evil.com" 은 스킴 상대 URL 이라 외부로 나간다.
  if (raw.startsWith("//")) return fallback;
  // 역슬래시를 슬래시로 해석하는 브라우저가 있다.
  if (raw.startsWith("/\\")) return fallback;
  return raw;
}

/**
 * 요청한 쪽 IP — 시도 횟수 제한의 열쇠.
 *
 * Next 는 소켓 주소를 주지 않으므로 리버스 프록시가 붙인 `X-Forwarded-For` 를 읽는다. 그런데 이 헤더는
 * 누구나 지어 보낼 수 있어서 **프록시 뒤라고 설정했을 때만**(`TRUST_PROXY` = 앞에 선 프록시 수, 보통 1) 믿는다.
 * 프록시는 맨 뒤에 자기가 본 주소를 덧붙이므로 오른쪽에서 그 수만큼 세어 읽는다 — 왼쪽 값은 지어낸 것일 수 있다.
 * 모르면 null(IP 제한 없이 이메일 기준 제한만 걸린다).
 */
export function clientIp(headers: Headers): string | null {
  const hops = Number(process.env.TRUST_PROXY ?? 0);
  if (!Number.isInteger(hops) || hops < 1) return null;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain[chain.length - hops] ?? headers.get("x-real-ip")?.trim();
  return ip || null;
}

/**
 * 다른 사이트가 사용자의 브라우저를 시켜 보낸 요청인가(CSRF).
 *
 * 서버 액션은 Next 가 Origin 을 확인해 주지만, 라우트 핸들러(파일 올리기·메시지·보고서 보내기·로그아웃)는
 * 직접 봐야 한다. 요즘 브라우저는 `Sec-Fetch-Site` 를 붙이므로 그것을 먼저 보고, 없으면 `Origin` 을
 * 설치 주소(`APP_BASE_URL`)와 비교한다. 둘 다 없으면 브라우저가 아닌 곳(스크립트)이라 CSRF 가 아니다.
 */
export function isCrossSiteRequest(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = headers.get("origin");
  if (!origin) return false;
  return origin !== expectedOrigin(headers);
}

function expectedOrigin(headers: Headers): string | null {
  const base = process.env.APP_BASE_URL;
  if (base) {
    try {
      return new URL(base).origin;
    } catch {
      // 설정이 틀렸으면 요청 주소로 판단한다.
    }
  }
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : null;
}

export function crossSiteRejected(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
