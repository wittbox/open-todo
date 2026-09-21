import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getListRole } from "@/lib/permissions";
import { getListMembers } from "@/lib/queries/members";

/**
 * 담당자 후보. 그 목록을 볼 수 있는 사람들이다.
 *
 * 목록을 볼 수 없는 사람에게는 구성원 명단도 주지 않는다 — 누가 어느 목록을
 * 공유받았는지가 그 자체로 조직 정보다. 없는 목록과 권한 없는 목록은 같은 응답.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/lists/[listId]/members">) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ members: [] }, { status: 401 });

  const { listId } = await ctx.params;
  if (!(await getListRole(userId, listId))) {
    return NextResponse.json({ members: [] }, { status: 404 });
  }

  return NextResponse.json({ members: await getListMembers(listId) });
}
