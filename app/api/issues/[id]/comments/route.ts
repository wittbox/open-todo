import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/session";
import { PermissionError } from "@/lib/permissions";
import { addComment } from "@/lib/issues/core";
import { ActionError } from "@/lib/actions/_helpers";
import { MAX_FILES_PER_MESSAGE } from "@/lib/files/policy";
import { crossSiteRejected, isCrossSiteRequest } from "@/lib/http";
import { translatorFor } from "@/i18n/server";
import { getRequestPrefs } from "@/lib/prefs";

/**
 * 파일이 실린 이슈 댓글. 파일 없는 댓글은 서버 액션(addCommentAction)으로 온다.
 * 없는 이슈와 권한 없는 이슈는 같은 404 — id 를 훑어 존재를 알아낼 수 없게.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/issues/[id]/comments">) {
  if (isCrossSiteRequest(req.headers)) return crossSiteRejected();
  const t = translatorFor((await getRequestPrefs()).locale) as unknown as Translate;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });

  const { id } = await ctx.params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: t("projects.errors.badRequest") }, { status: 400 });
  const body = typeof form.get("body") === "string" ? (form.get("body") as string) : "";
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length > MAX_FILES_PER_MESSAGE) {
    return NextResponse.json({ error: t("issues.errors.tooManyFiles", { max: MAX_FILES_PER_MESSAGE }) }, { status: 400 });
  }
  const files = await Promise.all(
    uploads.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()), mimeType: f.type })),
  );

  try {
    const comment = await addComment(userId, id, { body, files });
    revalidatePath("/projects/[id]", "page");
    return NextResponse.json({ comment });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.key ? t(e.key, e.values) : e.message }, { status: 400 });
    if (e instanceof PermissionError) return NextResponse.json({ error: t("projects.errors.notFound") }, { status: 404 });
    throw e;
  }
}
