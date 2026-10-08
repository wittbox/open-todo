import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/session";
import { getProjectRole, PermissionError } from "@/lib/permissions";
import { createIssue } from "@/lib/issues/core";
import { issueStamp } from "@/lib/queries/issues";
import { ActionError } from "@/lib/actions/_helpers";
import { MAX_FILES_PER_MESSAGE } from "@/lib/files/policy";
import { crossSiteRejected, isCrossSiteRequest } from "@/lib/http";
import { translatorFor } from "@/i18n/server";
import { getRequestPrefs } from "@/lib/prefs";
import type { IssuePriority } from "@/app/generated/prisma/enums";

/**
 * 파일이 실린 새 이슈. 파일 없는 이슈는 서버 액션(createIssueAction)으로 온다.
 * 메시지 라우트(../messages)와 같은 모양이다 — 없는 프로젝트와 비멤버는 같은 404, 오류는 요청한 사람의 언어로.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * 이슈 화면의 자동 새로고침이 묻는 '바뀜 표시'. 달라졌으면 화면이 서버 렌더링을 다시 받는다.
 * 없는 프로젝트와 비멤버는 POST 와 같은 404.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/issues">) {
  const t = translatorFor((await getRequestPrefs()).locale) as unknown as Translate;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await getProjectRole(userId, id))) return NextResponse.json({ error: t("projects.errors.notFound") }, { status: 404 });
  return NextResponse.json({ stamp: await issueStamp(id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/issues">) {
  if (isCrossSiteRequest(req.headers)) return crossSiteRejected();
  const t = translatorFor((await getRequestPrefs()).locale) as unknown as Translate;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await getProjectRole(userId, id))) return NextResponse.json({ error: t("projects.errors.notFound") }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: t("projects.errors.badRequest") }, { status: 400 });
  const text = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length > MAX_FILES_PER_MESSAGE) {
    return NextResponse.json({ error: t("issues.errors.tooManyFiles", { max: MAX_FILES_PER_MESSAGE }) }, { status: 400 });
  }
  const files = await Promise.all(
    uploads.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()), mimeType: f.type })),
  );

  try {
    const issue = await createIssue(userId, {
      projectId: id,
      title: text("title"),
      body: text("body"),
      priority: (text("priority") || undefined) as IssuePriority | undefined,
      assigneeId: text("assigneeId") || null,
      labelIds: form.getAll("labelIds").filter((v): v is string => typeof v === "string"),
      dueDate: text("dueDate") || null,
      sourceMessageId: text("sourceMessageId") || null,
      files,
    });
    revalidatePath("/projects/[id]", "page");
    return NextResponse.json({ issue });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.key ? t(e.key, e.values) : e.message }, { status: 400 });
    if (e instanceof PermissionError) {
      return NextResponse.json({ error: e.isDefault ? t("errors.forbidden") : e.message }, { status: 403 });
    }
    throw e;
  }
}
