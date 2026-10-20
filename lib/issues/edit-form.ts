import { NextResponse } from "next/server";
import { PermissionError } from "@/lib/permissions";
import { ActionError } from "@/lib/actions/_helpers";
import { MAX_FILES_PER_MESSAGE } from "@/lib/files/policy";
import { translatorFor } from "@/i18n/server";
import { getRequestPrefs } from "@/lib/prefs";
import type { FileEdit } from "@/lib/issues/core";

/**
 * 이슈 본문·댓글 고치기의 multipart 읽기(2026-10-20). 글(body), 새 파일(files), 뺄 파일 id(remove).
 * 라우트 둘(본문·댓글)이 같은 모양을 쓴다.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export async function requestTranslator(): Promise<Translate> {
  return translatorFor((await getRequestPrefs()).locale) as unknown as Translate;
}

export async function readEditForm(req: Request, t: Translate): Promise<({ body: string } & FileEdit) | NextResponse> {
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
  const removeIds = form.getAll("remove").filter((v): v is string => typeof v === "string").slice(0, 50);
  return { body, files, removeIds };
}

/** 규칙 오류는 400, 없는 것·권한 없는 것은 같은 404 */
export function editErrorResponse(e: unknown, t: Translate): NextResponse {
  if (e instanceof ActionError) return NextResponse.json({ error: e.key ? t(e.key, e.values) : e.message }, { status: 400 });
  if (e instanceof PermissionError) return NextResponse.json({ error: t("projects.errors.notFound") }, { status: 404 });
  throw e;
}
