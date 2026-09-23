import { afterEach, describe, expect, it, vi } from "vitest";
import { isHourlySlot, nextSlotDelay, startJobScheduler } from "@/lib/jobs/scheduler";

/**
 * 예약 작업을 앱 안에서 도는 스케줄러. 벽시계 눈금에 맞춰 깨어나는지, 앞 회차가 남아 있으면 건너뛰는지,
 * 한 번 실패해도 다음 회차가 오는지 — 컨테이너 없이 여기서 본다.
 */

const MIN = 60_000;
const at = (iso: string) => new Date(iso).getTime();

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("눈금 계산", () => {
  it("다음 5분 눈금까지 남은 시간", () => {
    expect(nextSlotDelay(at("2026-09-23T10:00:00Z"))).toBe(5 * MIN);
    expect(nextSlotDelay(at("2026-09-23T10:00:01Z"))).toBe(5 * MIN - 1000);
    expect(nextSlotDelay(at("2026-09-23T10:04:59Z"))).toBe(1000);
    expect(nextSlotDelay(at("2026-09-23T10:57:30Z"))).toBe(2 * MIN + 30_000);
  });

  it("밀리지 않는다 — 한 시간을 돌아도 눈금은 그대로", () => {
    let now = at("2026-09-23T10:02:13Z");
    for (let i = 0; i < 12; i++) now += nextSlotDelay(now) + 1_500; // 회차마다 1.5초씩 일한다고 치고
    expect(new Date(now).getUTCMinutes() % 5).toBe(0);
  });

  it("매시 작업은 정시 눈금에서만", () => {
    expect(isHourlySlot(new Date("2026-09-23T10:00:00Z"))).toBe(true);
    expect(isHourlySlot(new Date("2026-09-23T10:05:00Z"))).toBe(false);
    expect(isHourlySlot(new Date("2026-09-23T10:55:00Z"))).toBe(false);
  });
});

describe("스케줄러", () => {
  const jobs = (sends: () => Promise<unknown>, tick: () => Promise<unknown>) => ({
    sends: { name: "sends", run: sends },
    tick: { name: "tick", run: tick },
  });

  it("5분 눈금마다 예약 발송, 정시에는 tick 까지", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-23T09:58:00Z") });
    const sends = vi.fn(async () => ({ sent: 0, retried: 0, failed: 0, canceled: 0 }));
    const tick = vi.fn(async () => ({ reminders: 0, dueToday: 0, digests: 0, cleaned: 0 }));
    const scheduler = startJobScheduler(jobs(sends, tick), () => Date.now());

    await vi.advanceTimersByTimeAsync(2 * MIN); // 10:00 — 정시
    expect(sends).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * MIN); // 10:05
    expect(sends).toHaveBeenCalledTimes(2);
    expect(tick).toHaveBeenCalledTimes(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it("앞 회차가 안 끝났으면 건너뛴다", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-23T10:00:00Z") });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending: { release?: () => void } = {};
    const sends = vi.fn(() => new Promise<void>((resolve) => (pending.release = resolve)));
    const tick = vi.fn(async () => ({}));
    const scheduler = startJobScheduler(jobs(sends, tick), () => Date.now());

    await vi.advanceTimersByTimeAsync(5 * MIN); // 첫 회차 시작 — 끝나지 않는다
    expect(sends).toHaveBeenCalledTimes(1);
    // 첫 회차가 매달려 있으므로 다음 회차는 예약되지 않는다. 풀어 주면 다시 흐른다.
    pending.release?.();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(sends).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("한 번 실패해도 다음 회차가 온다", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-23T10:00:00Z") });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sends = vi.fn().mockRejectedValueOnce(new Error("메일 서버가 죽었다")).mockResolvedValue({ sent: 1 });
    const tick = vi.fn(async () => ({}));
    const scheduler = startJobScheduler(jobs(sends, tick), () => Date.now());

    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(error).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(sends).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
