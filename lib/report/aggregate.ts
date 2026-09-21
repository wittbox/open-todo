import { addDays, dateOnlyToString, dayRange } from "@/lib/date";
import { shortDayLabel } from "@/lib/format";
import { translatorFor } from "@/i18n/server";
import type { AppLocale } from "@/i18n/locales";

/**
 * 주간보고서 집계. DB에 닿지 않는 순수 함수라 주 경계와 분류 규칙을 테스트로 고정할 수 있다.
 *
 * 주 범위: 월요일 00:00 ~ 일요일 24:00 (작성자 시간대)
 *   1. 이번 주 완료 — completedAt 이 이번 주 안
 *   2. 진행 중     — 미완료이고 착수 흔적이 있는 것
 *   3. 예정        — 미완료이고 아직 착수 흔적이 없는 것
 *
 * 기한만으로는 가를 수 없다. 다음 달 마감이어도 이번 주에 붙잡고 있으면 진행
 * 중이고, 오늘 만든 일이라도 손을 안 댔으면 예정이다. 그래서 '손댔는가' 를 본다.
 *
 * updatedAt 은 쓰지 않는다. 드래그로 순서만 바꿔도, 담당자만 지정해도 올라가서
 * "건드렸다"와 "일했다"를 구분하지 못한다.
 */

export type SourceTask = {
  id: string;
  seq: number;
  title: string;
  listId: string;
  listName: string;
  groupName: string | null;
  /** 집계 범위 필터용. 그룹 없는 목록은 null. */
  groupId?: string | null;
  /**
   * 목록을 가진 사람. 보고서를 쓰는 사람 본인이면 null.
   * "누구 목록인지"는 남의 목록일 때만 궁금하므로 그 판단은 쿼리에서 끝내고
   * 여기서는 표시할 이름만 받는다.
   */
  ownerName?: string | null;
  /** 작업을 만든 사람. 보고서를 쓰는 사람 본인이면 null. */
  assigneeName?: string | null;
  isCompleted: boolean;
  /** 세부 단계를 하나라도 끝냈는지 — 착수했다는 가장 분명한 흔적 */
  hasStepProgress?: boolean;
  /** 보고서 작성자가 나의 하루에 올려 둔 작업인지 */
  inMyDay?: boolean;
  /** ISO 타임스탬프 */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** "YYYY-MM-DD" */
  dueDate: string | null;
  steps: { title: string; isCompleted: boolean }[];
};

export type ReportTask = {
  id: string;
  seq: number;
  title: string;
  listId: string;
  path: string;
  stepDone: number;
  stepTotal: number;
  dueDate: string | null;
  dueLabel: string | null;
  steps: string[];
  comment: string | null;
  /** 작업을 만든 사람. 보고서 작성자 본인이면 null — 자기 이름을 줄마다 적을 이유는 없다. */
  assignee: string | null;
  /** 왜 이 구간에 들어왔는지. 편집 화면에서만 보여 준다. */
  reason: SectionReason;
};

/** 자동 분류가 틀렸을 때 이유를 알아야 옮길지 판단할 수 있다. */
export type SectionReason = "step" | "myday" | "due" | "future" | "overdue" | "new" | "manual";

/** 묶음은 "그룹 › 목록"이되, 남의 목록이면 그 사람 이름까지가 한 묶음이다. */
export type ReportGroup = { path: string; owner: string | null; tasks: ReportTask[] };
export type SectionKey = "done" | "inProgress" | "upcoming";
export type ReportSection = { key: SectionKey; label: string; groups: ReportGroup[] };

export type ReportContent = {
  /** 발행 시점에 굳은 언어. 구간 이름·기한 표기가 이 언어로 들어 있다. */
  locale?: AppLocale;
  weekStart: string;
  weekEnd: string;
  rangeLabel: string;
  title: string;
  summary: string;
  sections: ReportSection[];
  taskCount: number;
};

export type ReportEdits = {
  /** 주 범위(월 00:00 ~ 일 24:00)를 자를 작성자 시간대. 없으면 서울. */
  timeZone?: string;
  /** 구간 이름·기한을 적을 작성자 언어. 없으면 한국어. */
  locale?: AppLocale;
  title: string;
  summary: string;
  /** 보고서에서 빼기로 한 작업 */
  excludedTaskIds: string[];
  /** 작업별 코멘트 */
  comments: Record<string, string>;
  /**
   * 사람이 직접 옮긴 구간. 자동 분류는 초안일 뿐이라 마지막 판단은 사람이 한다.
   * 그 보고서에만 저장되고 작업 자체는 건드리지 않는다.
   */
  sections?: Record<string, Exclude<SectionKey, "done">>;
};

/**
 * 그룹에 속하지 않은 목록(공유만 받은 목록 포함)을 집계 범위에서 가리키는 값.
 * 서버 쿼리와 편집 화면이 같은 규칙을 쓰도록 DB에 닿지 않는 이 파일에 둔다 —
 * lib/queries/report.ts 에 두면 클라이언트 번들이 prisma 를 끌어온다.
 */
export const UNGROUPED_SCOPE_ID = "__ungrouped__";

/** 구간 순서. 이름은 발행 시점의 작성자 언어로 굳혀 스냅샷에 담는다(`reports.sections.<구간>`). */
export const SECTION_KEYS: SectionKey[] = ["done", "inProgress", "upcoming"];

function within(iso: string | null, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

function dueWithin(due: string | null, startDateOnly: Date, days: number): boolean {
  if (!due) return false;
  const start = dateOnlyToString(startDateOnly);
  const end = dateOnlyToString(addDays(startDateOnly, days));
  return due >= start && due < end;
}

export function classify(
  task: SourceTask,
  weekStart: Date,
  timeZone?: string,
): { key: SectionKey; reason: SectionReason } | null {
  const thisWeek = dayRange(weekStart, 7, timeZone);

  if (task.isCompleted) {
    return within(task.completedAt, thisWeek.from, thisWeek.to)
      ? { key: "done", reason: "step" }
      : null;
  }

  // 착수 흔적 — 손을 댔다는 증거.
  if (task.hasStepProgress) return { key: "inProgress", reason: "step" };
  if (task.inMyDay) return { key: "inProgress", reason: "myday" };

  if (task.dueDate) {
    // 이미 지난 기한은 늦은 일이다. '예정' 으로 밀어내면 안 된다.
    if (task.dueDate < dateOnlyToString(weekStart)) return { key: "inProgress", reason: "overdue" };
    if (dueWithin(task.dueDate, weekStart, 7)) return { key: "inProgress", reason: "due" };
    return { key: "upcoming", reason: "future" };
  }

  // 기한도 흔적도 없다면, 이번 주에 새로 적어 둔 것만 예정으로 싣는다.
  // 아무도 건드리지 않은 옛 작업까지 담으면 보고서가 할 일 목록 복사본이 된다.
  if (within(task.createdAt, thisWeek.from, thisWeek.to)) return { key: "upcoming", reason: "new" };
  return null;
}

/**
 * 줄을 손으로 옮겼을 때 저장할 값.
 *
 * 자동 분류와 같은 자리로 되돌리면 표시를 지운다 — 남겨 두면 '직접 옮김' 딱지가
 * 계속 붙어서, 왜 그 구간에 있는지 설명이 사실과 어긋난다.
 */
export function nextSectionOverride(
  task: SourceTask,
  weekStart: Date,
  to: Exclude<SectionKey, "done">,
  current: Record<string, Exclude<SectionKey, "done">>,
  timeZone?: string,
): Record<string, Exclude<SectionKey, "done">> {
  const next = { ...current };
  if (classify(task, weekStart, timeZone)?.key === to) delete next[task.id];
  else next[task.id] = to;
  return next;
}

function toReportTask(t: SourceTask, edits: ReportEdits, reason: SectionReason): ReportTask {
  const due = t.dueDate;
  return {
    id: t.id,
    seq: t.seq,
    title: t.title,
    listId: t.listId,
    path: t.groupName ? `${t.groupName} › ${t.listName}` : t.listName,
    stepDone: t.steps.filter((s) => s.isCompleted).length,
    stepTotal: t.steps.length,
    dueDate: due,
    dueLabel: due ? shortDayLabel(new Date(`${due}T00:00:00.000Z`), edits.locale ?? "ko") : null,
    steps: t.steps.map((s) => s.title),
    comment: edits.comments[t.id]?.trim() ? edits.comments[t.id].trim() : null,
    assignee: t.assigneeName ?? null,
    reason,
  };
}

export function buildReport(
  tasks: SourceTask[],
  weekStart: Date,
  edits: ReportEdits,
): ReportContent {
  const excluded = new Set(edits.excludedTaskIds);
  const moved = edits.sections ?? {};
  const buckets: Record<SectionKey, { task: SourceTask; reason: SectionReason }[]> = {
    done: [], inProgress: [], upcoming: [],
  };

  for (const t of tasks) {
    if (excluded.has(t.id)) continue;
    const auto = classify(t, weekStart, edits.timeZone);
    if (!auto) continue;

    // 완료는 사실이라 옮기지 않는다. 나머지만 사람의 판단을 따른다.
    const override = auto.key === "done" ? undefined : moved[t.id];
    buckets[override ?? auto.key].push({ task: t, reason: override ? "manual" : auto.reason });
  }

  const locale = edits.locale ?? "ko";
  const t = translatorFor(locale);
  let taskCount = 0;

  const sections = SECTION_KEYS.map((key) => {
    // 그룹 › 목록 단위로 묶고, 묶음과 작업 모두 이름/번호로 안정 정렬한다.
    // 이름이 같은 목록을 두 사람이 각각 가지고 있을 수 있으므로 소유자까지가 묶음 키다.
    const byPath = new Map<string, ReportGroup>();
    for (const { task: t, reason } of buckets[key]) {
      const item = toReportTask(t, edits, reason);
      const owner = t.ownerName ?? null;
      const mapKey = `${owner ?? ""}\u0000${item.path}`;
      const g = byPath.get(mapKey) ?? { path: item.path, owner, tasks: [] };
      g.tasks.push(item);
      byPath.set(mapKey, g);
      taskCount += 1;
    }
    // 내 목록이 먼저, 그다음 공유해 준 사람 이름 순.
    const groups: ReportGroup[] = [...byPath.values()]
      .sort(
        (a, b) =>
          (a.owner ?? "").localeCompare(b.owner ?? "", "ko") || a.path.localeCompare(b.path, "ko"),
      )
      .map((g) => ({ ...g, tasks: g.tasks.sort((x, y) => x.seq - y.seq) }));
    return { key, label: t(`reports.sections.${key}`), groups };
  });

  const weekEnd = addDays(weekStart, 6);
  return {
    locale,
    weekStart: dateOnlyToString(weekStart),
    weekEnd: dateOnlyToString(weekEnd),
    // 제목에 이미 날짜가 있으므로 여기서는 근무주를 요일과 함께 보여 준다.
    // 주말은 표시하지 않는다 — 업무 보고가 담는 범위가 월~금이다.
    rangeLabel: `${shortDayLabel(weekStart, locale)} ~ ${shortDayLabel(addDays(weekStart, 4), locale)}`,
    title: edits.title,
    summary: edits.summary,
    sections,
    taskCount,
  };
}
