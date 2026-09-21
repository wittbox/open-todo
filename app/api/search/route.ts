import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { searchTasks } from "@/lib/queries/tasks";

/** 사이드바 검색. 접근 권한이 있는 목록의 작업만 돌려준다. */
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ jump: null, hits: [] }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(await searchTasks(userId, q));
}
