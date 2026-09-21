import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { getTaskRole, ROLE_RANK } from "@/lib/permissions";
import { checkFile, MAX_FILES_PER_TASK } from "@/lib/files/policy";
import { saveFile } from "@/lib/files/storage";
import { crossSiteRejected, isCrossSiteRequest } from "@/lib/http";
import { translatorFor } from "@/i18n/server";
import { getRequestPrefs } from "@/lib/prefs";

/**
 * 작업에 파일을 붙인다.
 *
 * 서버 액션이 아니라 라우트인 이유는 파일 본문 때문이다 — multipart 를 그대로
 * 받아야 브라우저의 진행률과 취소가 자연스럽게 붙는다.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tasks/[taskId]/files">) {
  if (isCrossSiteRequest(req.headers)) return crossSiteRejected();
  const t = translatorFor((await getRequestPrefs()).locale);
  // lib/files/policy.ts 는 문구 대신 번역 열쇠를 준다 — 좁은 키 타입은 여기서만 푼다.
  const tx = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });

  const { taskId } = await ctx.params;
  const role = await getTaskRole(userId, taskId);
  // 없는 작업과 권한 없는 작업을 구분하지 않는다.
  if (!role) return NextResponse.json({ error: t("tasks.errors.notFoundOrForbidden") }, { status: 404 });
  if (ROLE_RANK[role] < ROLE_RANK.EDITOR) {
    return NextResponse.json({ error: t("tasks.errors.uploadForbidden") }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: t("tasks.errors.noFile") }, { status: 400 });
  }

  const check = checkFile(file.name, file.size);
  if (!check.ok) return NextResponse.json({ error: tx(check.key, check.values) }, { status: 400 });

  const count = await prisma.attachment.count({ where: { taskId } });
  if (count >= MAX_FILES_PER_TASK) {
    return NextResponse.json(
      { error: t("tasks.errors.tooManyFiles", { max: MAX_FILES_PER_TASK }) },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // 브라우저가 알려 준 크기와 실제가 다를 수 있으니 받은 뒤 한 번 더 본다.
  const recheck = checkFile(file.name, bytes.byteLength);
  if (!recheck.ok) return NextResponse.json({ error: tx(recheck.key, recheck.values) }, { status: 400 });

  const { storageKey } = await saveFile(bytes);

  const saved = await prisma.attachment.create({
    data: {
      taskId,
      uploaderId: userId,
      name: recheck.name,
      size: bytes.byteLength,
      mimeType: file.type || "application/octet-stream",
      storageKey,
    },
    select: { id: true, name: true, size: true, mimeType: true, createdAt: true },
  });

  return NextResponse.json({ file: saved });
}
