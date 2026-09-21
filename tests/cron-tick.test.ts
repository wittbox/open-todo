import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * cron 이 두드리는 자리.
 *
 * 로그인 없이 열리는 주소다. 열쇠가 새거나 설정을 빠뜨리면 누구든 남의 알림을
 * 대신 태우고 하루치 메일을 소진시킬 수 있어, 여기서 문을 확실히 잠근다.
 */
const runTick = vi.fn(async () => ({ reminders: 0, dueToday: 0, digests: 0, cleaned: 0 }));
vi.mock("@/lib/notify-tick", () => ({ runTick }));

const { POST } = await import("@/app/api/cron/tick/route");

const req = (key?: string) =>
  new NextRequest("https://todo.example.com/api/cron/tick", {
    method: "POST",
    headers: key ? { "x-cron-key": key } : {},
  });

afterEach(() => {
  delete process.env.CRON_KEY;
  runTick.mockClear();
});

describe("cron 문", () => {
  it("열쇠를 설정하지 않은 서버에서는 아예 닫힌다", async () => {
    const res = await POST(req("anything"));
    expect(res.status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("열쇠가 없으면 돌지 않는다", async () => {
    process.env.CRON_KEY = "secret";
    expect((await POST(req())).status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("열쇠가 틀리면 돌지 않는다", async () => {
    process.env.CRON_KEY = "secret";
    expect((await POST(req("wrong-key"))).status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("틀렸을 때와 설정이 없을 때를 같은 응답으로 돌려준다", async () => {
    process.env.CRON_KEY = "secret";
    const wrong = await POST(req("wrong-key"));
    delete process.env.CRON_KEY;
    const unset = await POST(req("wrong-key"));
    expect(wrong.status).toBe(unset.status);
  });

  it("열쇠가 맞으면 돌고 결과를 돌려준다", async () => {
    process.env.CRON_KEY = "secret";
    const res = await POST(req("secret"));
    expect(res.status).toBe(200);
    expect(runTick).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ reminders: 0, dueToday: 0, digests: 0, cleaned: 0 });
  });

  it("안에서 터져도 내부 사정을 흘리지 않는다", async () => {
    process.env.CRON_KEY = "secret";
    runTick.mockRejectedValueOnce(new Error("DB 주소가 postgres://user:pw@host 입니다"));

    const res = await POST(req("secret"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("postgres://");
  });
});
