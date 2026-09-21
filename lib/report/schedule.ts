/**
 * 보고서 예약 발송의 시각 규칙.
 *
 * 메일 서버에 예약을 맡기지 않고 우리 서버가 정한 시각에 대신 보낸다 —
 * 서버의 cron 이 5분마다 "보낼 때가 된 예약"을 찾는다. 이 파일은 그 시각을 고르고
 * 따지는 규칙만 담는다. 보내기 창(브라우저)과 발송 라우트(서버)가 같이 쓰므로
 * 서버 전용 모듈을 끌어오지 않는다. 시각은 모두 사용자 시간대(`tz`)의 벽시계로 고르고 따진다.
 */

import { DEFAULT_TZ, zonedParts, zonedToInstant } from "@/lib/tz";

/** 고를 수 있는 시각의 간격(분). cron 이 5분마다 도므로 그보다 잘게 나눌 이유가 없다. */
export const SCHEDULE_STEP_MIN = 10;
/** 지금부터 이만큼 뒤부터 예약된다. 누르자마자 나가는 예약은 예약이 아니다. */
export const SCHEDULE_MIN_LEAD_MIN = 10;
/** 이보다 먼 예약은 받지 않는다. 한 달 넘게 묵은 예약은 대개 잊힌 예약이다. */
export const SCHEDULE_MAX_DAYS = 30;
/** 예약 발송은 이만큼 시도하고 멈춘다. */
export const MAX_ATTEMPTS = 3;
/** 실패하면 이만큼 뒤에 다시 시도한다. */
export const RETRY_AFTER_MIN = 10;

const MIN = 60_000;

/** 오류는 번역 열쇠로 돌려준다 — 부르는 쪽이 보는 사람의 언어로 바꾼다. */
export type ScheduleCheck = { ok: true; at: Date } | { ok: false; key: string; values?: Record<string, number> };

/**
 * 요청에 실려 온 예약 시각을 따진다. 10분 눈금은 **사용자 시간대의 벽시계**로 본다 —
 * UTC 로 보면 +5:45(카트만두) 같은 곳에서 사용자가 고른 17:00 이 눈금 밖이 된다.
 */
export function checkScheduleAt(raw: unknown, now: Date, tz: string = DEFAULT_TZ): ScheduleCheck {
  if (typeof raw !== "string" || !raw) return { ok: false, key: "reports.errors.scheduleInvalid" };
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return { ok: false, key: "reports.errors.scheduleInvalid" };

  if (at.getUTCSeconds() !== 0 || at.getUTCMilliseconds() !== 0 || zonedParts(at, tz).minute % SCHEDULE_STEP_MIN !== 0) {
    return { ok: false, key: "reports.errors.scheduleStep", values: { step: SCHEDULE_STEP_MIN } };
  }
  if (at.getTime() < now.getTime() + SCHEDULE_MIN_LEAD_MIN * MIN) {
    return { ok: false, key: "reports.errors.scheduleLead", values: { minutes: SCHEDULE_MIN_LEAD_MIN } };
  }
  if (at.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 24 * 60 * MIN) {
    return { ok: false, key: "reports.errors.scheduleTooFar", values: { days: SCHEDULE_MAX_DAYS } };
  }
  return { ok: true, at };
}

/**
 * 달력이 고른 날(UTC 자정으로 표현된 날짜)과 "HH:MM"(사용자 시간대)을 실제 시각으로.
 * 달력은 이 앱의 날짜 규칙대로 UTC 자정을 돌려준다.
 */
export function slotToInstant(day: Date, hhmm: string, tz: string = DEFAULT_TZ): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedToInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m, tz);
}

/** 하루치 시각 목록("00:00" ~ "23:50"). */
export function timeSlots(): string[] {
  const out: string[] = [];
  for (let t = 0; t < 24 * 60; t += SCHEDULE_STEP_MIN) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 지금 기준으로 가장 이른 예약 가능 시각(사용자 시간대의 날짜와 "HH:MM"). 눈금은 현지 벽시계 기준. */
export function earliestSlot(now: Date, tz: string = DEFAULT_TZ): { day: Date; hhmm: string } {
  const lead = new Date(now.getTime() + SCHEDULE_MIN_LEAD_MIN * MIN);
  const p = zonedParts(lead, tz);
  // 초·밀리초가 남았으면 다음 분으로 올린 뒤 눈금에 맞춘다.
  const exact = lead.getUTCSeconds() === 0 && lead.getUTCMilliseconds() === 0;
  const minute = p.minute + (exact ? 0 : 1);
  const up = Math.ceil(minute / SCHEDULE_STEP_MIN) * SCHEDULE_STEP_MIN;
  const at = zonedToInstant(p.year, p.month, p.day, p.hour, up, tz);
  const q = zonedParts(at, tz);
  return { day: new Date(Date.UTC(q.year, q.month - 1, q.day)), hhmm: `${pad2(q.hour)}:${pad2(q.minute)}` };
}

/** "9/12(금) 17:00" · "9/12 (Fri) 17:00" — 버튼과 발송 이력에 쓰는 사용자 시간대 표기. */
export function scheduleLabel(at: Date, tz: string = DEFAULT_TZ, locale: string = "ko"): string {
  const p = zonedParts(at, tz);
  // 요일 이름은 Intl 에서 가져온다 — 언어마다 다르고, 번역 파일에 또 적을 이유가 없다.
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(p.year, p.month - 1, p.day)),
  );
  return `${p.month}/${p.day}(${weekday}) ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** 실패한 예약을 다시 시도할 시각. 없으면 그만둔다. */
export function nextAttemptAt(attemptsSoFar: number, now: Date): Date | null {
  return attemptsSoFar >= MAX_ATTEMPTS ? null : new Date(now.getTime() + RETRY_AFTER_MIN * MIN);
}
