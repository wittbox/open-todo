import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { getListRole } from "@/lib/permissions";
import { redirectTo } from "@/lib/http";

/**
 * 작업 일련번호 딥링크. /t/1042 → /list/{listId}?task={id}
 *
 * 없는 번호와 권한 없는 번호를 구분해서 알려주지 않는다.
 * 구분하면 번호를 1부터 훑어 남의 작업이 존재하는지 알아낼 수 있다.
 *
 * 리다이렉트는 상대 경로다 — 절대 URL 을 요청에서 만들면 프록시 뒤에서
 * 컨테이너 바인드 주소(0.0.0.0:3000)가 새어 나온다. lib/http.ts 참고.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/t/[seq]">) {
  const { seq } = await ctx.params;
  const n = Number(seq);
  const here = `/t/${seq}`;

  const userId = await getSessionUserId();
  if (!userId) {
    return redirectTo(`/login?returnTo=${encodeURIComponent(here)}`);
  }

  if (!Number.isInteger(n) || n <= 0) {
    return redirectTo("/t/not-found");
  }

  const task = await prisma.task.findUnique({
    where: { seq: n },
    select: { id: true, listId: true },
  });

  const role = task ? await getListRole(userId, task.listId) : null;
  if (!task || !role) {
    return redirectTo("/t/not-found");
  }

  return redirectTo(`/list/${task.listId}?task=${task.id}`);
}
