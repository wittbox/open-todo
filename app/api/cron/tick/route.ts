import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/notify-tick";
import { cronConfigured, cronKeyOk } from "@/lib/cron-key";

/**
 * 서버의 cron 이 부르는 자리.
 *
 * 이 앱은 누가 접속할 때만 움직여서, 아침에 메일을 보내려면 밖에서 한 번
 * 두드려 줘야 한다.
 *
 * 로그인 없이 열리는 주소이므로 열쇠를 요구한다. 열쇠가 없으면 아예 닫는다 —
 * 설정을 빠뜨린 서버에서 이 주소가 조용히 열려 있으면, 누구든 남의 알림을
 * 대신 태우고 메일을 하루치 소진시킬 수 있다.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!cronConfigured()) return NextResponse.json({ error: "not configured" }, { status: 404 });
  if (!cronKeyOk(req.headers.get("x-cron-key"))) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const result = await runTick();
    console.log(`[tick] ${JSON.stringify(result)}`);
    return NextResponse.json(result);
  } catch (e) {
    console.error(`[tick] failed: ${e}`);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
