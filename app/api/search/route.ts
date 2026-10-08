import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { searchTasks } from "@/lib/queries/tasks";
import { searchIssues, type SidebarSearchResult } from "@/lib/queries/issues";

const EMPTY: SidebarSearchResult = { jump: null, hits: [], issueJump: null, issues: [] };

/** 사이드바 검색. 접근 권한이 있는 목록의 작업과, 멤버인 프로젝트의 이슈만 돌려준다. */
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json(EMPTY, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const [tasks, issues] = await Promise.all([searchTasks(userId, q), searchIssues(userId, q)]);
  const out: SidebarSearchResult = { ...tasks, issueJump: issues.jump, issues: issues.hits };
  return NextResponse.json(out);
}
