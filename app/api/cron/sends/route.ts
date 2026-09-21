import { NextRequest, NextResponse } from "next/server";
import { runScheduledSends } from "@/lib/report/scheduled-sends";
import { cronConfigured, cronKeyOk } from "@/lib/cron-key";

/**
 * 예약 발송 처리기. 서버의 cron 이 5분마다 부른다.
 *
 * 알림용 tick(매시 정각)과 따로 둔다. 알림 쪽은 한 시간에 한 번 도는 것을 전제로
 * 짜여 있어, 예약 때문에 자주 돌리면 거기까지 흔들린다.
 *
 * 로그인 없이 열리는 주소이므로 tick 과 같은 열쇠를 요구하고, 열쇠가 없으면 닫는다.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!cronConfigured()) return NextResponse.json({ error: "not configured" }, { status: 404 });
  if (!cronKeyOk(req.headers.get("x-cron-key"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const result = await runScheduledSends();
    // 할 일이 없는 5분이 대부분이다. 한 일이 있을 때만 남긴다.
    if (result.sent + result.failed + result.retried + result.canceled > 0) {
      console.log(`[sends] ${JSON.stringify(result)}`);
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error(`[sends] failed: ${e}`);
    return NextResponse.json({ error: "sends failed" }, { status: 500 });
  }
}
