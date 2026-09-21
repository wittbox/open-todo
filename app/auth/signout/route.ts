import { NextRequest } from "next/server";
import { destroySession, readSession } from "@/lib/session";
import { crossSiteRejected, isCrossSiteRequest, redirectTo } from "@/lib/http";
import { HOME_PATH } from "@/lib/home";

/** 로그아웃 — 사이드바의 버튼이 POST 로 부른다. */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req.headers)) return crossSiteRejected();
  await destroySession();
  return redirectTo("/login", 303);
}

/**
 * 쓸 수 없게 된 세션 쿠키를 치운다. 화면(서버 컴포넌트)은 쿠키를 지울 수 없어서, 끊긴 세션을 만나면 여기로 보낸다.
 *
 * GET 이라 남의 사이트도 부를 수 있다 — 그래서 **살아 있는 세션은 건드리지 않고** 앱으로 돌려보낸다.
 */
export async function GET() {
  const session = await readSession();
  if (session.userId) return redirectTo(HOME_PATH);
  await destroySession();
  const notice = session.problem === "revoked" || session.problem === "disabled" ? `?notice=${session.problem}` : "";
  return redirectTo(`/login${notice}`);
}
