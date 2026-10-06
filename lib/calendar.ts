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

/* ── 보이는 주들 ─────────────────────────────────────────────── */

/**
 * 달력은 달이 아니라 **5주**를 본다: 지난 1주 · 이번 주 · 앞으로 3주.
 * 달 단위로 그리면 달 끝으로 갈수록 이번 주가 맨 아래로 내려가 앞일이 잘린다.
 * 이번 주를 늘 둘째 줄에 두면 어느 날이든 3주 앞까지 보인다.
 */
export const CALENDAR_WEEKS = 5;
/** ◀ ▶ 한 번에 넘기는 주. 5보다 하나 적게 — 넘긴 뒤 맨 윗줄이 방금 보던 맨 아랫줄이다. */
export const PAGE_WEEKS = CALENDAR_WEEKS - 1;

/** 그 날이 든 주의 일요일. 주는 일요일에 시작한다(기한 고르는 작은 달력과 같게). */
export function weekStart(d: Date): Date {
  return addDays(d, -d.getUTCDay());
}

/** 처음 여는 달력의 첫 주 — 이번 주 바로 앞 주. 그래야 이번 주가 둘째 줄이다. */
export function defaultFrom(today: Date): Date {
  return addDays(weekStart(today), -7);
}

/**
 * 주소의 `?from=YYYY-MM-DD` → 첫 주의 일요일(다른 요일이면 그 주 일요일로 맞춘다).
 * 예전 `?month=YYYY-MM` 링크는 그 달 1일이 든 주를 둘째 줄에 둔다. 못 읽으면 기본값.
 */
export function parseFrom(q: { from?: unknown; month?: unknown }, today: Date): Date {
  if (typeof q.from === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.from);
    if (m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const date = new Date(Date.UTC(y, mo - 1, d));
      // 2026-02-31 같은 것은 Date 가 3월로 넘겨 버린다 — 되돌려 보아 같을 때만 받는다.
      if (y >= 2000 && y <= 2100 && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) return weekStart(date);
    }
  }
  if (typeof q.month === "string") {
    const m = /^(\d{4})-(\d{2})$/.exec(q.month);
    if (m) {
      const [y, mo] = [Number(m[1]), Number(m[2])];
      if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12) return defaultFrom(new Date(Date.UTC(y, mo - 1, 1)));
    }
  }
  return defaultFrom(today);
}

export function shiftWeeks(from: Date, by: number): Date {
  return addDays(from, by * 7);
}

/** 첫 주부터 5주. end 는 마지막 주 다음 일요일이며 범위에 들지 않는다. */
export function weekGrid(from: Date): { start: Date; end: Date; weeks: string[][] } {
  const start = weekStart(from);
  const end = addDays(start, CALENDAR_WEEKS * 7);
  const weeks = Array.from({ length: CALENDAR_WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => dateOnlyToString(addDays(start, w * 7 + d))),
  );
  return { start, end, weeks };
}

/**
 * 위 줄 제목("9월 20일 – 10월 24일")에 연도를 붙일지 — 해가 걸치거나 올해가 아닌 해를 볼 때만.
 * 글자는 화면이 Intl 의 기간 서식으로 만든다(언어마다 모양이 다르다).
 */
export function rangeNeedsYear(first: string, last: string, today: string): boolean {
  return first.slice(0, 4) !== last.slice(0, 4) || first.slice(0, 4) !== today.slice(0, 4);
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
