import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { getListRole, getProjectRole } from "@/lib/permissions";
import { isInlineImage } from "@/lib/files/policy";
import { readFileBytes } from "@/lib/files/storage";

/**
 * 첨부 내려주기.
 *
 * 정적 폴더로 열지 않는 이유가 이 라우트 전부다. 주소만 알면 누구나 받아 가는
 * 경로를 만들면 공유 권한이 무의미해진다. 요청마다 그 목록(또는 프로젝트)을
 * 볼 수 있는 사람인지 확인한다.
 */

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse(null, { status: 401 });

  const { id } = await ctx.params;
  const file = await prisma.attachment.findUnique({
    where: { id },
    select: {
      name: true, mimeType: true, storageKey: true, size: true,
      task: { select: { listId: true } },
      message: { select: { projectId: true } },
    },
  });
  // 없는 파일과 권한 없는 파일을 구분하지 않는다 — id 를 훑어 존재를 알아낼 수 없게.
  if (!file) return new NextResponse(null, { status: 404 });
  const role = file.task
    ? await getListRole(userId, file.task.listId)
    : file.message
      ? await getProjectRole(userId, file.message.projectId)
      : null;
  if (!role) return new NextResponse(null, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFileBytes(file.storageKey);
  } catch {
    // DB 에는 있는데 디스크에 없다. 백업에서 복원했을 때 생길 수 있다.
    return new NextResponse(null, { status: 410 });
  }

  // 그림 몇 가지만 펼쳐 보여 준다. 나머지는 받게 한다 —
  // HTML·SVG 가 우리 주소에서 페이지로 실행되면 세션을 건드릴 수 있다.
  const inline = isInlineImage(file.mimeType);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": inline ? file.mimeType : "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      // 브라우저가 내용을 보고 형식을 마음대로 정하지 못하게 한다.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
