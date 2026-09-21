import { NextRequest, NextResponse } from "next/server";
import {
  sessionCookieName,
  sessionCookieOptions,
  shouldRenew,
  signSession,
  verifySession,
} from "@/lib/session-token";

/**
 * (Next 16에서 middleware.ts 를 대체하는 파일 규칙)
 *
 * 미인증 사용자는 /login 으로 보내되 원래 가려던 경로를 returnTo 로 넘긴다.
 *
 * 여기서는 쿠키 서명만 확인한다. 끊긴 세션(세션 번호가 바뀜)·사용 중지는 lib/session.ts 가 요청마다
 * DB 로 확인하고, 실제 권한 판단은 lib/permissions.ts 가 한다.
 */

// 로그인 없이 열리는 경로.
//
// - 로그인·가입·비밀번호 찾기/재설정·가입 초대(/join)와 /auth 아래(제공자 로그인 시작·콜백, 메일 링크 확인,
//   로그아웃). /auth 아래에는 데이터를 보여 주는 화면을 두지 않는다.
// - /api/health 는 컨테이너 헬스체크가 부른다. 내부 정보를 담지 않는다.
// - /api/cron 은 서버의 cron 이 부르므로 세션이 없다. 대신 그 라우트가 열쇠를
//   요구하고, 열쇠가 설정되지 않은 서버에서는 스스로 닫힌다.
//
// 주간보고서 공개 링크(/r/...)가 여기 있었지만, 한 번 새면 회수할 수 없어 없앴다 —
// 보고서는 앱 안에서 공유하고 밖으로는 메일 본문으로만 나간다.
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/join",
  "/auth",
  "/api/health",
  "/api/cron",
];

function isPublic(pathname: string): boolean {
  // 경로 경계까지 본다 — 그냥 startsWith 면 /loginx 나 /api/authx 도 로그인 없이 열린다.
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const name = sessionCookieName();
  const token = req.cookies.get(name)?.value;
  const session = token && process.env.SESSION_SECRET ? await verifySession(token) : null;

  if (session) {
    const res = NextResponse.next();
    // 쓰는 동안에는 로그아웃되지 않는다 — 7일 만료를 뒤로 민다.
    // 세션 번호(sv)는 그대로 옮긴다. 빠뜨리면 하루 뒤 모든 사람이 로그아웃된다.
    // 끊긴 세션을 연장해도 쓸모가 없다 — lib/session.ts 가 번호를 DB 와 비교해 받지 않는다.
    if (shouldRenew(session.iat, Math.floor(Date.now() / 1000))) {
      res.cookies.set(name, await signSession(session.sub, session.sv), sessionCookieOptions());
    }
    return res;
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?returnTo=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|backgrounds/).*)"],
};
