import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getUnreadByProject } from "@/lib/queries/project";

/**
 * 내 프로젝트별 안 읽은 원글 수. 사이드바가 프로젝트 화면 밖에서도 30초마다 물어 배지를 맞춘다
 * (프로젝트 화면 안에서는 메시지 폴링 응답에 실려 온다). 멤버십을 조인하므로 남의 프로젝트는 나오지 않는다.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({}, { status: 401 });
  return NextResponse.json(Object.fromEntries(await getUnreadByProject(userId)));
}
