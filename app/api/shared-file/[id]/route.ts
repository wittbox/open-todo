import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyFileLink } from "@/lib/files/share-link";
import { isInlineImage } from "@/lib/files/policy";
import { readFileBytes } from "@/lib/files/storage";

/**
 * 임시 공개 링크로 사진 내려주기(lib/files/share-link.ts). 로그인 없이 열린다 — proxy 의 공개 경로.
 *
 * 열어 주는 것: 서명·만료가 맞고, 이슈 본문에 붙은 그림(펼쳐 보여도 안전한 형식)만.
 * 그 밖은 모두 404 — 틀린 서명·만료·다른 종류의 파일을 구분하지 않는다.
 */

export const runtime = "nodejs";

export async function GET(req: Request, ctx: RouteContext<"/api/shared-file/[id]">) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  if (!verifyFileLink(id, url.searchParams.get("e"), url.searchParams.get("s"))) {
    return new NextResponse(null, { status: 404 });
  }
  const file = await prisma.attachment.findUnique({
    where: { id },
    select: { name: true, mimeType: true, storageKey: true, issueId: true },
  });
  if (!file || !file.issueId || !isInlineImage(file.mimeType)) return new NextResponse(null, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFileBytes(file.storageKey);
  } catch {
    return new NextResponse(null, { status: 410 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
      // 검색 엔진·미리보기 봇이 주워 가도 색인하지 않게
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
