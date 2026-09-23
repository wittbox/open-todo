/**
 * 예약 작업을 앱 안에서 돈다 — 설치가 한 대일 때(한 컨테이너 안의 DB + 앱)를 전제로 한다.
 *
 *   5분 눈금마다  → 예약해 둔 보고서 메일(runScheduledSends)
 *   정시 눈금에   → 미리 알림·기한 오늘·아침 요약·청소(runTick)
 *
 * `setInterval(5분)` 을 쓰지 않는 이유: 매 회차가 조금씩 밀려 쌓이고, 한 시간에 한 번 도는 일이
 * 어느 순간 한 시간을 통째로 건너뛴다. 매번 **다음 벽시계 눈금까지 남은 시간**을 새로 계산한다.
 *
 * 밖에서 두드리는 방식(`/api/cron/*` + CRON_KEY)도 그대로 남아 있다. `RUN_JOBS` 를 켠 설치는
 * 여기서 돌고, 그렇지 않은 설치는 예전처럼 밖의 스케줄러를 쓰면 된다.
 */

const FIVE_MIN_MS = 5 * 60 * 1000;

/** 다음 5분 눈금까지 남은 시간(ms). 눈금 위에 정확히 있으면 다음 눈금까지 기다린다. */
export function nextSlotDelay(now: number, everyMs: number = FIVE_MIN_MS): number {
  const past = now % everyMs;
  return everyMs - past;
}

/** 이 회차에 매시 작업도 같이 돌 차례인가 — 정시 눈금(분 0)에 한 번. */
export function isHourlySlot(now: Date): boolean {
  return now.getUTCMinutes() < 5;
}

type Job = { name: string; run: () => Promise<unknown> };

/** 앞 회차가 아직 안 끝났으면 건너뛴다. 실패는 로그만 남긴다 — 예약 하나 때문에 서버가 죽지 않게. */
async function runOnce(job: Job, busy: Set<string>): Promise<void> {
  if (busy.has(job.name)) {
    console.warn(`[jobs] ${job.name} is still running; skipping this round`);
    return;
  }
  busy.add(job.name);
  try {
    const result = await job.run();
    if (result && Object.values(result).some((v) => typeof v === "number" && v > 0)) {
      console.log(`[jobs] ${job.name} ${JSON.stringify(result)}`);
    }
  } catch (e) {
    console.error(`[jobs] ${job.name} failed:`, e instanceof Error ? e.message : e);
  } finally {
    busy.delete(job.name);
  }
}

export type JobScheduler = { stop: () => void };

/**
 * 스케줄러를 켠다. 돌려주는 `stop()` 은 다음 회차를 취소한다(도는 중인 회차는 끝까지 간다).
 * 타이머는 `unref()` 해서 이것 때문에 프로세스가 살아 있지 않게 한다 — 살아 있게 하는 것은 HTTP 서버다.
 */
export function startJobScheduler(
  jobs: { tick: Job; sends: Job } = {
    tick: { name: "tick", run: async () => (await import("@/lib/notify-tick")).runTick() },
    sends: { name: "sends", run: async () => (await import("@/lib/report/scheduled-sends")).runScheduledSends() },
  },
  now: () => number = Date.now,
): JobScheduler {
  const busy = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(round, nextSlotDelay(now()));
    timer.unref?.();
  };

  const round = () => {
    void (async () => {
      const at = new Date(now());
      await runOnce(jobs.sends, busy);
      if (isHourlySlot(at)) await runOnce(jobs.tick, busy);
      schedule();
    })();
  };

  schedule();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
