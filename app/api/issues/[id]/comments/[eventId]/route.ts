import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/session";
import { editComment } from "@/lib/issues/core";
import { editErrorResponse, readEditForm, requestTranslator } from "@/lib/issues/edit-form";
import { crossSiteRejected, isCrossSiteRequest } from "@/lib/http";

/**
 * 댓글 고치기(2026-10-20) — 글과 함께 파일을 붙이고(files) 뺀다(remove). 쓴 사람만.
 * 없는 것과 권한 없는 것은 같은 404.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/issues/[id]/comments/[eventId]">) {
  if (isCrossSiteRequest(req.headers)) return crossSiteRejected();
  const t = await requestTranslator();
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });
  const { eventId } = await ctx.params;
  const input = await readEditForm(req, t);
  if (input instanceof NextResponse) return input;
  try {
    await editComment(userId, eventId, input.body, input);
    revalidatePath("/projects/[id]", "page");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return editErrorResponse(e, t);
  }
}
