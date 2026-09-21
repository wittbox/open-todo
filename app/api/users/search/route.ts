import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { searchUsers } from "@/lib/queries/share";

/**
 * 이 서버의 구성원 검색. 로그인한 사람만 부를 수 있다.
 * 반환값은 이름·이메일·아바타색뿐이다.
 *
 * 기본은 자기 자신을 뺀다(공유 대상 고르기). self=1 이면 넣는다 —
 * 보고서를 자기 주소로 보내는 일이 흔하다.
 */
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json([], { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const includeSelf = req.nextUrl.searchParams.get("self") === "1";
  return NextResponse.json(await searchUsers(userId, q, [], { includeSelf }));
}
