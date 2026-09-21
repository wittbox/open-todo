import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * 컨테이너 헬스체크. 앱이 떠 있는지와 DB에 닿는지까지 본다.
 * 인증 없이 열려 있으므로 버전이나 설정 같은 내부 정보는 담지 않는다.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
