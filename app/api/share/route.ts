import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getRequestPrefs } from "@/lib/prefs";
import { translatorFor } from "@/i18n/server";
import { getShareState, searchUsers } from "@/lib/queries/share";
import type { ShareSubjectType } from "@/app/generated/prisma/enums";

/**
 * 공유 다이얼로그가 쓰는 조회 엔드포인트.
 *   GET /api/share?type=LIST&id=...            → 현재 공유 상태
 *   GET /api/share?type=LIST&id=...&q=김        → 공유 대상 후보 검색
 */
export async function GET(req: NextRequest) {
  const t = translatorFor((await getRequestPrefs()).locale);
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: t("errors.unauthenticated") }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const type = p.get("type");
  const id = p.get("id");
  if ((type !== "GROUP" && type !== "LIST") || !id) {
    return NextResponse.json({ error: t("share.errors.badRequest") }, { status: 400 });
  }

  const state = await getShareState(userId, { type: type as ShareSubjectType, id });
  if (!state) {
    // 없는 항목과 권한 없는 항목을 구분하지 않는다.
    return NextResponse.json({ error: t("share.errors.notFound") }, { status: 404 });
  }

  const q = p.get("q");
  if (q === null) return NextResponse.json({ state });

  const candidates = state.canManage
    ? await searchUsers(userId, q, state.members.map((m) => m.userId))
    : [];
  return NextResponse.json({ state, candidates });
}
