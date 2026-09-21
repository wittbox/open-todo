import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getProjectRole, PermissionError } from "@/lib/permissions";
import { getUnreadByProject, listMessages } from "@/lib/queries/project";
import { createMessage } from "@/lib/projects/messages";
import { ActionError } from "@/lib/actions/_helpers";
import { MAX_FILES_PER_MESSAGE } from "@/lib/files/policy";
import { crossSiteRejected, isCrossSiteRequest } from "@/lib/http";
import { translatorFor } from "@/i18n/server";
import { getRequestPrefs } from "@/lib/prefs";

/**
 * 프로젝트 메시지.
 *
 * GET: 화면이 5초마다 `?since=` 로 "그 뒤로 바뀐 것"을 가져간다. 응답에 프로젝트별 안 읽음 수를 실어,
 * 열어 둔 동안 사이드바 배지가 따로 요청하지 않아도 되게 한다.
 * POST: 파일이 실린 메시지. 서버 액션이 아니라 라우트인 이유는 파일 본문 때문이다(작업 첨부와 같다).
 * 파일 없는 글은 서버 액션(postMessage)으로 온다.
 *
 * 없는 프로젝트와 비멤버(비공개 포함)는 같은 404 — id 를 훑어 존재를 알아낼 수 없게.
 *
 * 오류 문구는 요청한 사람의 언어로 만든다(서버 액션의 run() 과 같은 규칙).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 열쇠를 문자열로 받는 번역기 — 던져진 오류의 열쇠는 컴파일 때 알 수 없다. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

async function requestTranslator(): Promise<Translate> {
  const { locale } = await getRequestPrefs();
  return translatorFor(locale) as unknown as Translate;
}

export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/messages">) {
  const t = await requestTranslator();
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });

  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;

  let since: Date | undefined;
  const rawSince = q.get("since");
  if (rawSince) {
    since = new Date(rawSince);
    if (Number.isNaN(since.getTime())) return NextResponse.json({ error: "since" }, { status: 400 });
  }
  const rawBefore = q.get("before");
  const before = rawBefore ? Number(rawBefore) : undefined;
  if (before !== undefined && !Number.isInteger(before)) return NextResponse.json({ error: "before" }, { status: 400 });
  const parentId = q.get("parent") || null;

  const result = await listMessages(userId, id, { since, before, parentId });
  if (!result) return NextResponse.json({ error: t("projects.errors.notFound") }, { status: 404 });

  const unread = await getUnreadByProject(userId);
  return NextResponse.json({
    now: result.serverTime,
    messages: result.messages,
    hasMore: result.hasMore,
    unreadByProject: Object.fromEntries(unread),
  });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/messages">) {
  if (isCrossSiteRequest(req.headers)) return crossSiteRejected();
  const t = await requestTranslator();
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await getProjectRole(userId, id))) {
    return NextResponse.json({ error: t("projects.errors.notFound") }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: t("projects.errors.badRequest") }, { status: 400 });
  const body = typeof form.get("body") === "string" ? (form.get("body") as string) : "";
  const parentId = typeof form.get("parentId") === "string" ? (form.get("parentId") as string) || null : null;
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length > MAX_FILES_PER_MESSAGE) {
    return NextResponse.json(
      { error: t("files.errors.tooManyPerMessage", { max: MAX_FILES_PER_MESSAGE }) },
      { status: 400 },
    );
  }
  const files = await Promise.all(
    uploads.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()), mimeType: f.type })),
  );

  try {
    const message = await createMessage(userId, { projectId: id, body, parentId, files });
    return NextResponse.json({ message });
  } catch (e) {
    if (e instanceof ActionError) {
      return NextResponse.json({ error: e.key ? t(e.key, e.values) : e.message }, { status: 400 });
    }
    // 멤버인 것은 위에서 봤으니 여기 PermissionError 는 보관·삭제된 원글 같은 상태 거절이다.
    if (e instanceof PermissionError) {
      return NextResponse.json({ error: e.isDefault ? t("errors.forbidden") : e.message }, { status: 403 });
    }
    throw e;
  }
}
