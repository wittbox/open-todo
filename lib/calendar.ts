import { addDays, dateOnlyFromString, dateOnlyToString } from "@/lib/date";
import { nextDue, type RepeatRule } from "@/lib/repeat";

/**
 * 달력 화면의 규칙. 서버(칸 범위·반복 회차 계산)와 브라우저(칸 안 순서·설정 쿠키)가
 * 함께 쓰므로 DB 에 손대지 않는 순수 함수만 둔다.
 *
 * 날짜는 lib/date.ts 규약대로 UTC 자정 날짜 전용 값이고, 화면에는 "YYYY-MM-DD" 로 넘긴다.
 */

/** 달력에서 보는 목록 하나. 칩 왼쪽 띠 색과 추가·끌기 권한에 쓴다. */
export type CalendarList = {
  id: string;
  name: string;
  /** 목록이 든 그룹 이름(없으면 null). 이름만으로는 여러 그룹의 같은 이름 목록을 가를 수 없다. */
  groupName: string | null;
  /** 목록 테마 색 */
  color: string;
  isInbox: boolean;
  /** 편집 권한. 없으면 그 목록 작업은 체크·끌기가 잠기고 추가 대상에서 빠진다. */
  writable: boolean;
};

/** 반복 작업의 다음 회차 하나. 실제 작업이 아니라 "제때 끝내면 생길 날" 이다. */
export type Ghost = { taskId: string; date: string };

/* ── 달과 칸 ─────────────────────────────────────────────────── */

/** "2026-09" → 그 달 1일. 못 읽으면 today 가 속한 달. */
export function parseMonth(raw: unknown, today: Date): Date {
  if (typeof raw === "string") {
    const m = /^(\d{4})-(\d{2})$/.exec(raw);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12) return new Date(Date.UTC(y, mo - 1, 1));
    }
  }
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
}

/** 그 달 1일 → "2026-09" */
export function monthKey(month: Date): string {
  return dateOnlyToString(month).slice(0, 7);
}

export function shiftMonth(month: Date, by: number): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + by, 1));
}

/**
 * 그 달을 덮는 주들. 일요일에 시작한다(기한 고르는 작은 달력과 같게).
 *
 * 작은 달력은 높이를 고정하려고 늘 6주를 그리지만, 여기서는 그 달에 필요한 주만
 * 그린다(4~6주) — 칸이 높을수록 작업이 더 많이 보인다.
 * end 는 마지막 주 다음 일요일이며 범위에 들지 않는다.
 */
export function monthGrid(month: Date): { start: Date; end: Date; weeks: string[][] } {
  const start = addDays(month, -month.getUTCDay());
  const last = addDays(shiftMonth(month, 1), -1);
  const end = addDays(last, 7 - last.getUTCDay());
  const count = Math.round((end.getTime() - start.getTime()) / (7 * 86_400_000));
  const weeks = Array.from({ length: count }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => dateOnlyToString(addDays(start, w * 7 + d))),
  );
  return { start, end, weeks };
}

/* ── 반복 회차 ───────────────────────────────────────────────── */

/** 날짜 하나를 구하는 데 도는 횟수의 상한. 매일 반복을 몇 년 뒤 달에서 봐도 멈춘다. */
const MAX_STEPS = 1000;

type RepeatSource = { id: string; dueDate: string | null; isCompleted: boolean; repeat: RepeatRule | null };

/**
 * 반복 작업의 다음 회차들 — [from, end) 안의 것만.
 *
 * 실제 작업은 완료할 때 하나씩 생긴다(lib/actions/task.ts 의 spawnNextOccurrence).
 * 여기서는 아무것도 만들지 않고, 그 규칙을 그대로 따라 "제때 끝내면 생길 날" 을
 * 미리 펼쳐 보일 뿐이다.
 *
 * 첫 회차는 완료 시점의 계산과 같게 잡는다. 기한이 이미 지났으면 오늘 끝낸다고 보고
 * 오늘 뒤의 첫 날이다 — 그래서 지난날에는 회차가 생기지 않는다.
 */
export function projectRepeats(tasks: RepeatSource[], from: Date, end: Date, today: Date): Ghost[] {
  const out: Ghost[] = [];
  for (const t of tasks) {
    if (t.isCompleted || !t.repeat || !t.dueDate) continue;
    const due = dateOnlyFromString(t.dueDate);
    let next = nextDue(t.repeat, due, due.getTime() > today.getTime() ? due : today);
    for (let i = 0; i < MAX_STEPS && next.getTime() < end.getTime(); i++) {
      if (next.getTime() >= from.getTime()) out.push({ taskId: t.id, date: dateOnlyToString(next) });
      next = nextDue(t.repeat, next, next);
    }
  }
  return out;
}

/* ── 칸 안 순서 ──────────────────────────────────────────────── */

type CellEntry = { ghost: boolean; task: { isCompleted: boolean; isImportant: boolean; seq: number } };

/** 할 일(별표 먼저) → 반복 다음 회차 → 완료. 같으면 먼저 만든 것부터. */
export function compareCellEntries(a: CellEntry, b: CellEntry): number {
  const rank = (e: CellEntry) => (e.ghost ? 2 : e.task.isCompleted ? 3 : e.task.isImportant ? 0 : 1);
  return rank(a) - rank(b) || a.task.seq - b.task.seq;
}

/* ── 보기 설정 ───────────────────────────────────────────────── */

/**
 * 완료 표시·숨긴 목록·마지막으로 고른 추가 목록·'지난 기한' 줄 펼침.
 * 서버가 첫 화면부터 맞게 그리도록 쿠키에 둔다(브라우저 저장소면 첫 화면이 한 번 깜빡인다).
 * 사람마다·기기마다의 편의일 뿐이라 DB 에는 두지 않는다.
 */
export const CALENDAR_PREFS_COOKIE = "cal_prefs";

export type CalendarPrefs = { showDone: boolean; hidden: string[]; addListId: string | null; overdueOpen: boolean };

export const DEFAULT_PREFS: CalendarPrefs = { showDone: true, hidden: [], addListId: null, overdueOpen: false };

export function serializePrefs(p: CalendarPrefs): string {
  return encodeURIComponent(JSON.stringify(p));
}

/** 쿠키 값 → 설정. 모양이 이상하면 그 칸만 기본값으로 둔다. */
export function parsePrefs(raw: string | undefined): CalendarPrefs {
  if (!raw) return DEFAULT_PREFS;
  let v: unknown;
  // 쿠키를 읽는 쪽이 이미 풀어 줬을 수도, 아닐 수도 있다.
  for (const s of [raw, safeDecode(raw)]) {
    try {
      v = JSON.parse(s);
      break;
    } catch {
      v = undefined;
    }
  }
  if (!v || typeof v !== "object") return DEFAULT_PREFS;
  const o = v as Record<string, unknown>;
  return {
    showDone: typeof o.showDone === "boolean" ? o.showDone : DEFAULT_PREFS.showDone,
    hidden: Array.isArray(o.hidden)
      ? o.hidden.filter((x): x is string => typeof x === "string" && x.length <= 64).slice(0, 200)
      : [],
    addListId: typeof o.addListId === "string" && o.addListId.length <= 64 ? o.addListId : null,
    overdueOpen: typeof o.overdueOpen === "boolean" ? o.overdueOpen : DEFAULT_PREFS.overdueOpen,
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
