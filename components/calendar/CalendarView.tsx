"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Icon } from "@/components/icons";
import { ThemedPane } from "@/components/list-view/ThemedPane";
import { TaskRow } from "@/components/list-view/TaskRow";
import { createTask, updateTask } from "@/lib/actions/task";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import {
  CALENDAR_PREFS_COOKIE,
  compareCellEntries,
  monthKey,
  serializePrefs,
  shiftMonth,
  type CalendarList,
  type CalendarPrefs,
  type Ghost,
} from "@/lib/calendar";
import { dateOnlyFromString } from "@/lib/date";
import { useFormatter, useTranslations } from "next-intl";
import { DATE_ONLY } from "@/lib/format";
import { holidayName, type HolidayRegion } from "@/lib/holidays";
import { listPath } from "@/lib/list-path";
import { SMART_VIEW_THEMES } from "@/lib/theme";
import type { TaskItem } from "@/lib/queries/list";
import { openPanel, PHONE_QUERY } from "@/components/shell/shell";
import { useMediaQuery } from "@/components/shell/useMediaQuery";

/**
 * 달력 화면.
 *
 * 칸마다 그날이 기한인 작업을 칩으로 올린다. 칩을 누르면 오른쪽 상세 창(?task=),
 * 동그라미를 누르면 완료, 다른 칸에 끌어 놓으면 기한이 바뀐다. 칸의 빈 곳이나 '+' 를
 * 누르면 그날 기한으로 작업을 추가한다.
 *
 * 폰(768px 미만)에서는 칸이 50px 남짓이라 이름을 못 쓴다 — 점만 찍은 월 달력과 누른 날의
 * 작업 목록으로 바꾸고, 추가는 오른쪽 아래 ＋ 로 한다(2026-09-17). 끌 칸이 없으니 폰에서는 끌지 않는다.
 * 터치 기기에서 끌기는 0.3초 길게 눌러야 시작한다 — 그냥 밀면 화면이 스크롤된다.
 *
 * 저장은 모두 목록 화면과 같은 서버 동작(createTask·updateTask)이다 — 권한도 거기서
 * 다시 본다. 여기서 막는 것(편집 권한 없는 목록의 체크·끌기)은 편의일 뿐이다.
 */

const COLORS = SMART_VIEW_THEMES.planned;
const GRID_LINE = "rgba(138,75,60,.16)";

/**
 * 날짜를 찍는 옵션. 칸의 날짜는 UTC 자정 기준 date-only 라 반드시 `timeZone: "UTC"` 다
 * (lib/format.ts 규약). 여기 있는 셋은 lib/format.ts 의 것과 달리 이 화면에서만 쓴다.
 */
/** "2026년 9월" · "September 2026" */
const MONTH_TITLE = { year: "numeric", month: "long", timeZone: "UTC" } as const;

/** "7월 28일" · "July 28" — 요일이 필요 없는 지난 기한 줄 */
const MONTH_DAY = { month: "long", day: "numeric", timeZone: "UTC" } as const;

/** 요일 머리글 — "일" · "Sun" */
const WEEKDAY = { weekday: "short", timeZone: "UTC" } as const;

/** 요일 이름을 언어에 맞춰 찍기 위한 한 주. 2026-02-01 이 일요일이다. */
const WEEK_REF = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 1, 1 + i)));

// 칸에 칩이 몇 개 들어가는지 재는 데 쓰는 높이(px)
const WEEKDAY_H = 26;
const DATE_H = 26;
const CHIP_H = 23;

type Entry = { key: string; task: TaskItem; ghost: boolean };

type Pop =
  | { kind: "add"; date: string; rect: DOMRect }
  | { kind: "day"; date: string; rect: DOMRect }
  | { kind: "filter"; rect: DOMRect };

type Changes = { isCompleted?: boolean; isImportant?: boolean; dueDate?: string };

const applyChanges = (prev: TaskItem[], p: { id: string; changes: Changes }) =>
  prev.map((t) => (t.id === p.id ? { ...t, ...p.changes } : t));

export function CalendarView({
  month,
  today,
  weeks,
  tasks,
  ghosts,
  ghostSources,
  overdue = [],
  overdueMore = false,
  lists,
  prefs: initialPrefs,
  meId,
  holidays = "kr",
}: {
  /** "2026-09" */
  month: string;
  /** 서울 기준 오늘 "YYYY-MM-DD" — 서버가 정해 준다(브라우저 시계로 기한 지남을 가르지 않는다) */
  today: string;
  weeks: string[][];
  tasks: TaskItem[];
  ghosts: Ghost[];
  /** 기한이 칸보다 앞이라 칸에는 없지만 다음 회차가 칸 안에 오는 반복 작업 */
  ghostSources: TaskItem[];
  /** 공휴일을 어느 나라 것으로 표시할지 — 설치 설정(서버가 정해 준다) */
  holidays?: HolidayRegion;
  /** 기한이 오늘 전인 미완료 작업 전부(오래된 순) — 보는 달과 상관없다 */
  overdue?: TaskItem[];
  /** 서버가 상한까지만 실었다 */
  overdueMore?: boolean;
  lists: CalendarList[];
  prefs: CalendarPrefs;
  meId: string;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("task");
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [pop, setPop] = useState<Pop | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // 칸 하나에 들어가는 칩 수. 창 높이에 따라 다시 잰다(재기 전에는 4).
  const [slots, setSlots] = useState(4);
  const gridRef = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery(PHONE_QUERY, false);
  // 폰에서 목록을 보여 줄 날. 이번 달이면 오늘, 아니면 1일(달을 넘기면 화면이 새로 붙어 다시 정한다).
  const [day, setDay] = useState(() => (today.startsWith(month) ? today : `${month}-01`));

  const [patched, applyOptimistic] = useOptimistic(tasks, applyChanges);
  // 지난 기한 줄의 작업은 대개 칸 밖(이전 달)이라 따로 고친다. 이번 달 것은 양쪽에 다 있다.
  const [overduePatched, applyOverdue] = useOptimistic(overdue, applyChanges);

  const listById = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const writableLists = useMemo(() => lists.filter((l) => l.writable), [lists]);
  // 지워진 목록의 id 가 쿠키에 남아 있어도 '숨김' 으로 세지 않는다.
  const hidden = useMemo(() => new Set(prefs.hidden.filter((id) => listById.has(id))), [prefs.hidden, listById]);

  // 방금 완료했거나 기한을 뒤로 옮긴 작업은 바로 빠진다. 숨긴 목록 것은 세지 않는다.
  const overdueShown = useMemo(
    () => overduePatched.filter((t) => !t.isCompleted && t.dueDate != null && t.dueDate < today && !hidden.has(t.listId)),
    [overduePatched, today, hidden],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>();
    const put = (date: string, e: Entry) => {
      const arr = m.get(date);
      if (arr) arr.push(e);
      else m.set(date, [e]);
    };
    for (const t of patched) {
      if (!t.dueDate || hidden.has(t.listId) || (!prefs.showDone && t.isCompleted)) continue;
      put(t.dueDate, { key: t.id, task: t, ghost: false });
    }
    // 방금 완료한 반복 작업의 회차는 곧 실제 작업으로 바뀌므로 바로 걷는다.
    const source = new Map([...ghostSources, ...patched].map((t) => [t.id, t]));
    for (const g of ghosts) {
      const t = source.get(g.taskId);
      if (!t || t.isCompleted || hidden.has(t.listId)) continue;
      put(g.date, { key: `${g.taskId}@${g.date}`, task: t, ghost: true });
    }
    for (const arr of m.values()) arr.sort(compareCellEntries);
    return m;
  }, [patched, ghosts, ghostSources, hidden, prefs.showDone]);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const row = (el.clientHeight - WEEKDAY_H) / weeks.length;
      setSlots(Math.max(1, Math.floor((row - DATE_H) / CHIP_H)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
    // 폰 ↔ 태블릿으로 돌리면 칸 달력이 새로 붙는다 — 그때 다시 잰다.
  }, [weeks.length, phone]);

  const closePop = useCallback(() => setPop(null), []);

  const canWrite = (t: TaskItem) => listById.get(t.listId)?.writable ?? false;

  function select(id: string, toggle = true) {
    const q = new URLSearchParams(params.toString());
    const closing = toggle && selectedId === id;
    if (closing) q.delete("task");
    else q.set("task", id);
    const href = `${pathname}${q.size ? `?${q}` : ""}`;
    if (closing) router.replace(href, { scroll: false });
    else openPanel(router, href);
  }

  function patch(t: TaskItem, changes: Changes) {
    startTransition(async () => {
      applyOptimistic({ id: t.id, changes });
      applyOverdue({ id: t.id, changes });
      const res = await runAction(() => updateTask(t.id, changes));
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      router.refresh();
    });
  }

  function savePrefs(next: CalendarPrefs) {
    setPrefs(next);
    try {
      document.cookie = `${CALENDAR_PREFS_COOKIE}=${serializePrefs(next)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // 쿠키를 못 쓰는 환경이면 이 화면에서만 유지된다.
    }
  }

  const addListId =
    (prefs.addListId && listById.get(prefs.addListId)?.writable ? prefs.addListId : null) ??
    writableLists.find((l) => l.isInbox)?.id ??
    writableLists[0]?.id ??
    null;
  const canAdd = addListId != null;

  async function addTask(date: string, listId: string, title: string): Promise<boolean> {
    if (prefs.addListId !== listId) savePrefs({ ...prefs, addListId: listId });
    const res = await runAction(() => createTask(listId, title, { dueDate: date }));
    if (!res.ok) {
      if (!handledAuthFailure(res)) setError(res.error);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  /* ── 끌어 놓기 ── */

  // 마우스는 6px 움직이면, 손가락은 0.3초 누르고 있어야 끈다 — 그냥 밀면 스크롤이다.
  // (칩에 touch-none 을 두면 칩 위에서 민 것이 끌기가 되어 기한이 모르게 바뀐다.)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );

  function onDragStart(e: DragStartEvent) {
    setDragId((e.active.data.current?.taskId as string | undefined) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    const taskId = e.active.data.current?.taskId as string | undefined;
    const over = e.over ? String(e.over.id) : "";
    if (!taskId || !over.startsWith("D:")) return;
    const date = over.slice(2);
    const t = findTask(taskId);
    if (!t || t.dueDate === date) return;
    setPop(null);
    patch(t, { dueDate: date });
  }

  const findTask = (id: string) => patched.find((x) => x.id === id) ?? overduePatched.find((x) => x.id === id);
  const dragTask = dragId ? (findTask(dragId) ?? null) : null;

  /* ── 그리기 ── */

  function chipProps(e: Entry): ChipProps {
    const t = e.task;
    return {
      task: t,
      color: listById.get(t.listId)?.color ?? "#8a8886",
      ghost: e.ghost,
      overdue: !e.ghost && !t.isCompleted && t.dueDate != null && t.dueDate < today,
      selected: !e.ghost && selectedId === t.id,
      canWrite: !e.ghost && canWrite(t),
      meId,
      onToggle: () => patch(t, { isCompleted: !t.isCompleted }),
      // 회차를 누르면 원래 작업을 연다. 이미 열려 있어도 닫지 않는다.
      onSelect: () => select(t.id, !e.ghost),
    };
  }

  const monthStart = dateOnlyFromString(`${month}-01`);
  const navBtn =
    "grid h-7 min-w-8 place-items-center rounded bg-[var(--row)] px-1.5 text-[var(--on)] hover:bg-[var(--row-hover)]";
  const pill =
    "inline-flex h-7 items-center gap-1.5 rounded bg-[var(--row)] px-2.5 hover:bg-[var(--row-hover)]";

  return (
    <ThemedPane colors={COLORS} title={t("title")} titleIcon={<Icon name="calendarMonth" size={26} />}>
      {/* 칸 달력은 화면 높이를 채운다. 폰은 점 달력 + 목록이 내용만큼 늘고 바깥이 스크롤한다
          (높이를 묶어 두면 flex 가 점 달력을 눌러 두 주만 보였다). */}
      <div className={phone ? "flex flex-col pb-6" : "flex h-full min-h-[520px] flex-col pb-6"}>
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <Link
            href={`/calendar?month=${monthKey(shiftMonth(monthStart, -1))}`}
            aria-label={t("prevMonth")}
            className={navBtn}
          >
            <Icon name="chevronRight" size={15} className="rotate-180" />
          </Link>
          <Link href="/calendar" className={`${navBtn} text-[13px]`}>
            {t("today")}
          </Link>
          <Link
            href={`/calendar?month=${monthKey(shiftMonth(monthStart, 1))}`}
            aria-label={t("nextMonth")}
            className={navBtn}
          >
            <Icon name="chevronRight" size={15} />
          </Link>
          <h2 className="ml-2 text-[17px] font-semibold text-[var(--on)]">
            {format.dateTime(monthStart, MONTH_TITLE)}
          </h2>

          <div className="ml-auto flex items-center gap-2 text-[12.5px] text-[var(--on-muted)]">
            <button
              type="button"
              onClick={(e) => setPop({ kind: "filter", rect: e.currentTarget.getBoundingClientRect() })}
              className={pill}
            >
              <Icon name="list" size={14} />
              {hidden.size > 0 ? t("hiddenLists", { count: hidden.size }) : t("allLists")}
              <Icon name="chevronDown" size={12} />
            </button>
            <button
              type="button"
              aria-pressed={prefs.showDone}
              onClick={() => savePrefs({ ...prefs, showDone: !prefs.showDone })}
              className={pill}
            >
              <span
                className={`grid h-3.5 w-3.5 place-items-center rounded-[3px] border-[1.3px] ${
                  prefs.showDone ? "border-[var(--on)] bg-[var(--on)] text-white" : "border-[var(--on-muted)]"
                }`}
              >
                {prefs.showDone && <Icon name="check" size={10} />}
              </span>
              {t("showDone")}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-2 flex items-start gap-2 rounded bg-white/90 px-3 py-2 text-xs text-danger">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label={t("close")}>
              <Icon name="x" size={13} />
            </button>
          </div>
        )}

        <DndContext
          id="calendar-dnd"
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragId(null)}
        >
          {overdueShown.length > 0 && (
            <OverdueStrip
              tasks={overdueShown}
              more={overdueMore}
              today={today}
              open={prefs.overdueOpen}
              onToggleOpen={() => savePrefs({ ...prefs, overdueOpen: !prefs.overdueOpen })}
              renderRow={(t) => (
                <OverdueRow
                  key={t.id}
                  task={t}
                  today={today}
                  color={listById.get(t.listId)?.color ?? "#8a8886"}
                  canWrite={canWrite(t)}
                  draggable={!phone}
                  selected={selectedId === t.id}
                  onToggle={() => patch(t, { isCompleted: true })}
                  onSelect={() => select(t.id)}
                />
              )}
            />
          )}

          {phone && (
            <>
              <PhoneMonth
                month={month}
                weeks={weeks}
                today={today}
                selected={day}
                entriesOf={(date) => byDate.get(date) ?? []}
                colorOf={(t) => listById.get(t.listId)?.color ?? "#8a8886"}
                onPick={setDay}
                holidays={holidays}
              />
              <PhoneDay date={day} today={today} count={(byDate.get(day) ?? []).length}>
                {(byDate.get(day) ?? []).map((e) =>
                  e.ghost ? (
                    <GhostRow
                      key={e.key}
                      task={e.task}
                      where={listPath(e.task.groupName, e.task.listName)}
                      onOpen={() => select(e.task.id, false)}
                    />
                  ) : (
                    <DayRow
                      key={e.key}
                      task={e.task}
                      canWrite={canWrite(e.task)}
                      draggable={false}
                      selected={selectedId === e.task.id}
                      meId={meId}
                      onToggleComplete={() => patch(e.task, { isCompleted: !e.task.isCompleted })}
                      onToggleImportant={() => patch(e.task, { isImportant: !e.task.isImportant })}
                      onSelect={() => select(e.task.id)}
                    />
                  ),
                )}
              </PhoneDay>
              {canAdd && (
                <button
                  type="button"
                  aria-label={t("add.on", { date: format.dateTime(dateOnlyFromString(day), DATE_ONLY) })}
                  onClick={(e) => setPop({ kind: "add", date: day, rect: e.currentTarget.getBoundingClientRect() })}
                  className="fixed bottom-5 right-5 z-20 grid h-14 w-14 place-items-center rounded-full bg-[var(--on)] text-white shadow-[0_6px_16px_rgba(0,0,0,.25)]"
                >
                  <Icon name="plus" size={24} />
                </button>
              )}
            </>
          )}

          {/* 폰에서는 그리지 않는다. 붙기 전(서버 그림)에도 폰에서 칸 달력이 번쩍 보이지 않게 md 미만은 숨긴다. */}
          {!phone && (
          <div
            ref={gridRef}
            className="hidden min-h-0 flex-1 overflow-hidden rounded border-l border-t md:grid"
            style={{
              borderColor: GRID_LINE,
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gridTemplateRows: `${WEEKDAY_H}px repeat(${weeks.length}, minmax(0, 1fr))`,
            }}
          >
            {WEEK_REF.map((w, i) => (
              <div
                key={w.getUTCDay()}
                className={`grid place-items-center border-b border-r bg-white/40 text-xs ${
                  i === 0 ? "text-danger" : i === 6 ? "text-link" : "text-[var(--on-muted)]"
                }`}
                style={{ borderColor: GRID_LINE }}
              >
                {format.dateTime(w, WEEKDAY)}
              </div>
            ))}

            {weeks.flat().map((date) => (
              <DayCell
                key={date}
                date={date}
                inMonth={date.startsWith(month)}
                isToday={date === today}
                entries={byDate.get(date) ?? []}
                slots={slots}
                canAdd={canAdd}
                onAdd={(rect) => setPop({ kind: "add", date, rect })}
                onMore={(rect) => setPop({ kind: "day", date, rect })}
                holidays={holidays}
                renderChip={(e) =>
                  e.ghost ? <ChipFace key={e.key} {...chipProps(e)} /> : <DraggableChip key={e.key} {...chipProps(e)} />
                }
              />
            ))}
          </div>
          )}

          {pop?.kind === "day" && (
            <DayPopover
              date={pop.date}
              today={today}
              rect={pop.rect}
              canAdd={canAdd}
              onClose={closePop}
              onAdd={() => setPop({ kind: "add", date: pop.date, rect: pop.rect })}
            >
              {(byDate.get(pop.date) ?? []).map((e) =>
                e.ghost ? (
                  <GhostRow
                    key={e.key}
                    task={e.task}
                    where={listPath(e.task.groupName, e.task.listName)}
                    onOpen={() => select(e.task.id, false)}
                  />
                ) : (
                  <DayRow
                    key={e.key}
                    task={e.task}
                    canWrite={canWrite(e.task)}
                    selected={selectedId === e.task.id}
                    meId={meId}
                    onToggleComplete={() => patch(e.task, { isCompleted: !e.task.isCompleted })}
                    onToggleImportant={() => patch(e.task, { isImportant: !e.task.isImportant })}
                    onSelect={() => select(e.task.id)}
                  />
                ),
              )}
            </DayPopover>
          )}

          <DragOverlay dropAnimation={null}>
            {dragTask ? (
              <ChipFace
                {...chipProps({ key: dragTask.id, task: dragTask, ghost: false })}
                selected={false}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        {pop?.kind === "add" && addListId && (
          <AddPopover
            date={pop.date}
            rect={pop.rect}
            lists={writableLists}
            defaultListId={addListId}
            onClose={closePop}
            onSubmit={(listId, title) => addTask(pop.date, listId, title)}
          />
        )}

        {pop?.kind === "filter" && (
          <FilterPopover
            rect={pop.rect}
            lists={lists}
            hidden={hidden}
            onClose={closePop}
            onToggle={(id) =>
              savePrefs({
                ...prefs,
                hidden: hidden.has(id) ? [...hidden].filter((x) => x !== id) : [...hidden, id],
              })
            }
            onShowAll={() => savePrefs({ ...prefs, hidden: [] })}
          />
        )}
      </div>
    </ThemedPane>
  );
}

/* ── 칸 ─────────────────────────────────────────────────────── */

function DayCell({
  date,
  inMonth,
  isToday,
  entries,
  slots,
  canAdd,
  onAdd,
  onMore,
  renderChip,
  holidays,
}: {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  entries: Entry[];
  slots: number;
  canAdd: boolean;
  onAdd: (rect: DOMRect) => void;
  onMore: (rect: DOMRect) => void;
  renderChip: (e: Entry) => React.ReactNode;
  holidays: HolidayRegion;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const { setNodeRef, isOver } = useDroppable({ id: `D:${date}` });
  const ref = useRef<HTMLDivElement | null>(null);
  const d = dateOnlyFromString(date);
  const weekday = d.getUTCDay();
  const holidayKey = holidayName(date, holidays);
  const holiday = holidayKey ? t(`holidays.${holidayKey}`) : null;
  const dateLabel = format.dateTime(d, DATE_ONLY);
  const day = d.getUTCDate();

  // 넘치면 '+N개' 한 줄을 칩 한 칸 자리에 둔다.
  const shown = entries.length > slots ? entries.slice(0, Math.max(1, slots - 1)) : entries;
  const rest = entries.length - shown.length;
  const rect = () => ref.current!.getBoundingClientRect();

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        ref.current = el;
      }}
      data-date={date}
      aria-label={holiday ? t("dayWithHoliday", { date: dateLabel, holiday }) : dateLabel}
      onClick={(e) => {
        // 칩·버튼을 누른 것은 제 할 일을 한다. 빈 곳만 '추가' 다.
        if (!canAdd || (e.target as HTMLElement).closest("[data-chip],button")) return;
        onAdd(rect());
      }}
      className={[
        "group relative min-w-0 overflow-hidden border-b border-r pb-1",
        isOver
          ? "bg-[rgba(37,100,207,.08)] outline-2 -outline-offset-[3px] outline-dashed outline-link"
          : isToday
            ? "bg-white/70"
            : inMonth
              ? "bg-white/40"
              : "bg-white/15",
      ].join(" ")}
      style={{ borderColor: GRID_LINE }}
    >
      <div className="flex h-[26px] items-center gap-1.5 px-1.5 pt-0.5">
        <span
          className={[
            "grid h-[22px] min-w-[22px] place-items-center rounded-full px-1 text-xs",
            isToday
              ? "bg-[var(--on)] font-semibold text-white"
              : weekday === 0 || holiday
                ? "text-danger"
                : weekday === 6
                  ? "text-link"
                  : "text-ink",
            !inMonth && !isToday ? "opacity-45" : "",
          ].join(" ")}
        >
          {day === 1 ? `${d.getUTCMonth() + 1}/1` : day}
        </span>
        {holiday && <span className="truncate text-[11px] text-danger">{holiday}</span>}
      </div>

      {shown.map(renderChip)}

      {rest > 0 && (
        <button
          type="button"
          onClick={() => onMore(rect())}
          className="px-2 pt-0.5 text-[11.5px] font-semibold text-[var(--on-muted)] hover:underline"
        >
          {t("more", { count: rest })}
        </button>
      )}

      {canAdd && (
        <button
          type="button"
          aria-label={t("add.on", { date: dateLabel })}
          onClick={() => onAdd(rect())}
          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded bg-white/90 text-[var(--on)] opacity-0 shadow-[0_0_0_1px_rgba(164,55,58,.25)] transition-opacity group-hover:opacity-100 focus:opacity-100"
        >
          <Icon name="plus" size={13} />
        </button>
      )}
    </div>
  );
}

/* ── 폰: 점 달력 + 그날 목록 ─────────────────────────────────── */

/**
 * 폰의 월 달력. 칸에는 날짜와 점(작업마다 하나, 셋까지)만. 점 색은 목록 색이고
 * 기한 지난 미완료는 빨강, 완료는 회색, 반복 다음 회차는 테두리만.
 */
function PhoneMonth({
  month,
  weeks,
  today,
  selected,
  entriesOf,
  colorOf,
  onPick,
  holidays,
}: {
  month: string;
  weeks: string[][];
  today: string;
  selected: string;
  entriesOf: (date: string) => Entry[];
  colorOf: (t: TaskItem) => string;
  onPick: (date: string) => void;
  holidays: HolidayRegion;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  return (
    <div className="mb-3 shrink-0 overflow-hidden rounded-md bg-white/55">
      <div className="grid grid-cols-7 py-1 text-center text-[11px]">
        {WEEK_REF.map((w, i) => (
          <span
            key={w.getUTCDay()}
            className={i === 0 ? "text-danger" : i === 6 ? "text-link" : "text-[var(--on-muted)]"}
          >
            {format.dateTime(w, WEEKDAY)}
          </span>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-t" style={{ borderColor: GRID_LINE }}>
          {week.map((date) => {
            const d = dateOnlyFromString(date);
            const weekday = d.getUTCDay();
            const holidayKey = holidayName(date, holidays);
            const holiday = holidayKey ? t(`holidays.${holidayKey}`) : null;
            const entries = entriesOf(date);
            const isToday = date === today;
            const isSelected = date === selected;
            const dateLabel = format.dateTime(d, DATE_ONLY);
            const dayLabel = holiday ? t("dayWithHoliday", { date: dateLabel, holiday }) : dateLabel;
            return (
              <button
                key={date}
                type="button"
                data-day={date}
                aria-pressed={isSelected}
                aria-label={
                  entries.length ? t("dayWithTasks", { day: dayLabel, count: entries.length }) : dayLabel
                }
                onClick={() => onPick(date)}
                className={`flex h-12 flex-col items-center gap-0.5 pt-1 ${date.startsWith(month) ? "" : "opacity-40"}`}
              >
                <span
                  className={[
                    "grid h-7 w-7 place-items-center rounded-full text-[13px]",
                    isToday
                      ? "bg-[var(--on)] font-semibold text-white"
                      : weekday === 0 || holiday
                        ? "text-danger"
                        : weekday === 6
                          ? "text-link"
                          : "text-ink",
                    isSelected ? "ring-2 ring-link ring-offset-1" : "",
                  ].join(" ")}
                >
                  {d.getUTCDate()}
                </span>
                <span className="flex h-[5px] gap-[3px]" aria-hidden="true">
                  {entries.slice(0, 3).map((e) => {
                    const t = e.task;
                    const late = !e.ghost && !t.isCompleted && t.dueDate != null && t.dueDate < today;
                    const color = t.isCompleted ? "#c8c6c4" : late ? "var(--overdue)" : colorOf(t);
                    return (
                      <i
                        key={e.key}
                        data-dot=""
                        className="h-[5px] w-[5px] rounded-full"
                        style={e.ghost ? { boxShadow: `inset 0 0 0 1px ${color}` } : { background: color }}
                      />
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** 폰에서 고른 날의 작업 목록. 아래 ＋ 버튼에 가리지 않게 밑을 비워 둔다. */
function PhoneDay({
  date,
  today,
  count,
  children,
}: {
  date: string;
  today: string;
  count: number;
  children: React.ReactNode;
}) {
  const t = useTranslations("calendar");
  const label = useFormatter().dateTime(dateOnlyFromString(date), DATE_ONLY);
  return (
    <section aria-label={t("dayTasks", { date: label })} className="pb-20">
      <h3 className="flex items-center gap-1.5 px-1 pb-1.5 text-[13px] font-semibold text-[var(--on)]">
        {label}
        {date === today && <span className="font-normal text-[var(--on-muted)]">{t("today")}</span>}
        <span className="ml-auto font-normal text-[var(--on-muted)]">{t("taskCount", { count })}</span>
      </h3>
      {count === 0 ? (
        <p className="rounded bg-white/60 px-4 py-6 text-center text-sm text-[var(--on-muted)]">{t("emptyDay")}</p>
      ) : (
        children
      )}
    </section>
  );
}

/* ── 칩 ─────────────────────────────────────────────────────── */

type ChipProps = {
  task: TaskItem;
  color: string;
  /** 반복 다음 회차. 점선, 체크·끌기 없음. */
  ghost: boolean;
  overdue: boolean;
  selected: boolean;
  canWrite: boolean;
  meId: string;
  onToggle: () => void;
  onSelect: () => void;
  dragging?: boolean;
};

function DraggableChip(props: ChipProps) {
  const draggable = props.canWrite && !props.task.isCompleted;
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `T:${props.task.id}`,
    data: { taskId: props.task.id },
    disabled: !draggable,
  });
  return (
    <div ref={setNodeRef} {...listeners} className={draggable ? "touch-manipulation" : undefined}>
      <ChipFace {...props} dragging={isDragging} />
    </div>
  );
}

/**
 * 칩 하나.
 *
 * 칩 어디를 눌러도 연다(동그라미만 완료). 상세 창을 연 채 창이 좁으면 칸이 36px 까지
 * 줄어 제목 버튼 폭이 0 이 됐고, 제목만 누르게 해 두었더니 누를 곳이 없었다
 * (2026-09-11 확인 중 발견). 칩이 좁으면 동그라미·아이콘을 감춰 제목에 자리를 준다 —
 * 완료는 상세 창에서 하면 된다.
 */
function ChipFace({ task, color, ghost, overdue, selected, canWrite, meId, onToggle, onSelect, dragging }: ChipProps) {
  const t = useTranslations("calendar");
  const other = task.assignee && task.assignee.id !== meId ? task.assignee : null;
  const narrowHide = "@max-[72px]:hidden";
  const where = listPath(task.groupName, task.listName);
  return (
    <div
      data-chip=""
      data-ghost={ghost || undefined}
      data-overdue={overdue || undefined}
      onClick={onSelect}
      className={[
        "@container mx-1 mt-0.5 cursor-pointer rounded-[3px]",
        ghost
          ? "border border-dashed border-[#c9a99b] bg-transparent opacity-75"
          : "bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.045)]",
        task.isCompleted ? "opacity-55" : "",
        selected ? "ring-2 ring-link" : "",
        dragging ? "opacity-30" : "",
      ].join(" ")}
      style={{ borderLeftColor: color, borderLeftStyle: "solid", borderLeftWidth: 3 }}
    >
      <div className="flex h-[21px] items-center gap-1 pr-1.5 text-xs">
        {ghost ? (
          <span
            aria-hidden="true"
            className={`ml-1 h-[11px] w-[11px] shrink-0 rounded-full border border-dashed border-ink-3 ${narrowHide}`}
          />
        ) : (
          <button
            type="button"
            disabled={!canWrite}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={
              task.isCompleted ? t("uncomplete", { title: task.title }) : t("complete", { title: task.title })
            }
            className={`ml-1 grid h-[11px] w-[11px] shrink-0 place-items-center rounded-full border ${
              task.isCompleted ? "" : "border-ink-3"
            } ${canWrite ? "" : "cursor-default"} ${narrowHide}`}
            style={task.isCompleted ? { background: color, borderColor: color } : undefined}
          >
            {task.isCompleted && <Icon name="check" size={9} className="text-white" />}
          </button>
        )}
        {/* 누르면 칩으로 올라가 연다. 키보드로 칩에 닿는 자리이기도 하다. */}
        <button
          type="button"
          title={t("chipTitle", { title: task.title, where: ghost ? t("nextRepeat", { where }) : where })}
          className={[
            "min-w-0 flex-1 truncate pl-1 text-left leading-[21px]",
            task.isCompleted
              ? "text-ink-2 line-through"
              : overdue
                ? "text-[var(--overdue)]"
                : ghost
                  ? "text-ink-2"
                  : "text-ink",
          ].join(" ")}
        >
          {task.title}
        </button>
        {task.repeat && <Icon name="repeat" size={11} className={`shrink-0 text-ink-3 ${narrowHide}`} />}
        {task.isImportant && <Icon name="starFilled" size={11} className={`shrink-0 text-[var(--on)] ${narrowHide}`} />}
        {other && (
          <span
            title={other.name}
            className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full text-[8.5px] font-semibold text-white ${narrowHide}`}
            style={{ background: other.avatarColor }}
          >
            {other.name.slice(0, 1)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── 지난 기한 줄 ───────────────────────────────────────────── */

/**
 * 달력 위 '지난 기한 N개' 줄. 밀린 게 없으면 부르는 쪽이 아예 그리지 않는다.
 * 접힘이 기본이고 펼침은 쿠키에 기억한다(다른 보기 설정과 같이).
 */
function OverdueStrip({
  tasks,
  more,
  today,
  open,
  onToggleOpen,
  renderRow,
}: {
  tasks: TaskItem[];
  more: boolean;
  today: string;
  open: boolean;
  onToggleOpen: () => void;
  renderRow: (task: TaskItem) => React.ReactNode;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const oldest = tasks[0]?.dueDate;
  return (
    <section
      aria-label={t("overdue.title")}
      className="mb-2.5 shrink-0 overflow-hidden rounded bg-white/80 shadow-[inset_3px_0_0_var(--overdue)]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggleOpen}
        className="flex h-[34px] w-full items-center gap-2 pl-3.5 pr-3 text-left text-[13px] hover:bg-white/60"
      >
        <Icon name="alert" size={15} className="shrink-0 text-[var(--overdue)]" />
        <b className="font-semibold text-[var(--overdue)]">
          {more ? t("overdue.countMore", { count: tasks.length }) : t("overdue.count", { count: tasks.length })}
        </b>
        {oldest && oldest < today && (
          <span className="truncate text-xs text-ink-2">
            {t("overdue.oldest", { date: format.dateTime(dateOnlyFromString(oldest), MONTH_DAY) })}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-ink-2">
          {open ? t("collapse") : t("expand")}
          <Icon name={open ? "chevronUp" : "chevronDown"} size={12} />
        </span>
      </button>
      {open && <div className="max-h-[304px] overflow-y-auto">{tasks.map(renderRow)}</div>}
    </section>
  );
}

/** 지난 기한 줄의 한 줄. 누르면 상세 창, 동그라미는 완료, 끌어서 달력 칸에 놓으면 기한이 바뀐다. */
function OverdueRow({
  task,
  today,
  color,
  canWrite,
  draggable = true,
  selected,
  onToggle,
  onSelect,
}: {
  task: TaskItem;
  today: string;
  color: string;
  canWrite: boolean;
  /** 폰에는 놓을 칸이 없어 끌지 않는다 */
  draggable?: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `O:${task.id}`,
    data: { taskId: task.id },
    disabled: !canWrite || !draggable,
  });
  const due = task.dueDate ?? today;
  const late = Math.round((dateOnlyFromString(today).getTime() - dateOnlyFromString(due).getTime()) / 86_400_000);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-overdue-row=""
      onClick={onSelect}
      className={[
        // 폰에서는 손가락 크기(44px). 목록 경로는 빼고 제목에 자리를 준다.
        "flex h-11 cursor-pointer touch-manipulation items-center gap-2.5 border-t border-black/5 px-3.5 text-[14px] md:h-[30px] md:text-[13px]",
        selected ? "bg-[#eff4fc] shadow-[inset_0_0_0_1px_#2564cf]" : "hover:bg-white/60",
        isDragging ? "opacity-30" : "",
      ].join(" ")}
    >
      <button
        type="button"
        disabled={!canWrite}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={t("complete", { title: task.title })}
        className={`h-5 w-5 shrink-0 rounded-full border-[1.5px] border-ink-3 md:h-[15px] md:w-[15px] ${canWrite ? "hover:border-ink-2" : "cursor-default"}`}
      />
      <button type="button" className="min-w-0 flex-1 truncate text-left text-ink">
        {task.title}
      </button>
      {task.isImportant && <Icon name="starFilled" size={12} className="shrink-0 text-[var(--on)]" />}
      <span className="hidden min-w-0 max-w-[40%] shrink items-center gap-1.5 text-xs text-ink-2 md:flex">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate">{listPath(task.groupName, task.listName)}</span>
      </span>
      <span className="shrink-0 text-right text-xs text-[var(--overdue)] md:w-[118px]">
        {t("overdue.late", { date: format.dateTime(dateOnlyFromString(due), MONTH_DAY), days: late })}
      </span>
    </div>
  );
}

/* ── 떠 있는 창 ─────────────────────────────────────────────── */

/**
 * 칸 옆에 뜨는 작은 창. 칸 아래에 두되 화면 밖으로 나가면 위로 올린다. 폭은 화면을 넘지 않는다.
 * Esc · 바깥 누르기 · 바깥 스크롤 · 창 크기 바뀜으로 닫힌다. 바깥 판정은 ContextMenu 와 같은 방식이다
 * (React 위임 순서에 기대지 않고 눌린 지점이 창 안인지 직접 본다).
 *
 * 단, 창 안 입력칸에 글을 쓰는 중이면 크기·스크롤로 닫지 않고 자리만 다시 잡는다. 폰은 키보드가
 * 뜨면서 창 크기가 바뀌고(안드로이드) 입력칸을 보이게 스크롤한다(iOS) — 추가 창이 열리자마자 닫혔다.
 */
function Popover({
  rect,
  width,
  label,
  tone,
  onClose,
  children,
}: {
  rect: DOMRect;
  width: number;
  label: string;
  /** plain = 흰 바탕(입력용), pane = 화면 바탕색(작업 줄용) */
  tone: "plain" | "pane";
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 4 });

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth || width;
    const h = el.offsetHeight;
    const below = rect.bottom + 4;
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)),
      top: below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 4) : below,
    });
  }, [rect, width]);

  useLayoutEffect(place, [place]);

  useEffect(() => {
    const inside = (e: Event) => e.target instanceof Node && (ref.current?.contains(e.target) ?? false);
    const typing = () => ref.current?.contains(document.activeElement) ?? false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!inside(e)) onClose();
    };
    const onScroll = (e: Event) => {
      if (inside(e)) return;
      if (typing()) place();
      else onClose();
    };
    const onResize = () => {
      if (typing()) place();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    // 창을 연 그 클릭이 곧바로 닫지 않도록 다음 틱부터 듣는다.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose, place]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="fixed z-40 overflow-hidden rounded-lg border border-[#e1dfdd] shadow-[0_12px_32px_rgba(0,0,0,.18)]"
      style={{
        left: pos.left,
        top: pos.top,
        width: `min(${width}px, calc(100vw - 16px))`,
        background: tone === "pane" ? COLORS.accent : "#ffffff",
      }}
    >
      {children}
    </div>
  );
}

function AddPopover({
  date,
  rect,
  lists,
  defaultListId,
  onClose,
  onSubmit,
}: {
  date: string;
  rect: DOMRect;
  lists: CalendarList[];
  defaultListId: string;
  onClose: () => void;
  /** 성공하면 true. 입력칸을 비우고 열어 둔 채 다음 입력을 받는다. */
  onSubmit: (listId: string, title: string) => Promise<boolean>;
}) {
  const t = useTranslations("calendar");
  const [listId, setListId] = useState(defaultListId);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = useFormatter().dateTime(dateOnlyFromString(date), DATE_ONLY);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit() {
    const v = title.trim();
    if (!v || busy) return;
    setBusy(true);
    const ok = await onSubmit(listId, v);
    setBusy(false);
    if (ok) {
      setTitle("");
      inputRef.current?.focus();
    }
  }

  return (
    <Popover rect={rect} width={360} label={t("add.title", { date: label })} tone="plain" onClose={onClose}>
      <div className="flex items-center px-3.5 pb-1.5 pt-3 text-sm font-semibold">
        {label}
        <button type="button" onClick={onClose} aria-label={t("close")} className="ml-auto text-ink-3 hover:text-ink">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="px-3.5">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // 한글 조합을 끝내는 Enter 는 추가가 아니다.
              if (e.nativeEvent.isComposing) return;
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder={t("add.taskName")}
          aria-label={t("add.taskName")}
          maxLength={500}
          className="h-8 w-full rounded border border-link px-2.5 text-sm outline-none ring-1 ring-inset ring-link"
        />
      </div>
      {/* 목록 이름이 '그룹 › 목록' 으로 길어지자 고르기 칸이 늘어나 '목록'·'추가' 가 한 글자씩
          줄바꿈됐다(2026-09-12 신고). 글자와 버튼은 줄지 않게 두고, 고르기 칸이 남은 폭을 쓴다. */}
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="shrink-0 whitespace-nowrap text-xs text-ink-2">{t("add.list")}</span>
        <select
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          aria-label={t("add.list")}
          className="h-7 min-w-0 flex-1 truncate rounded border border-[#c8c6c4] bg-white px-2 text-[12.5px]"
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {listPath(l.groupName, l.name)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!title.trim() || busy}
          className="h-7 shrink-0 whitespace-nowrap rounded bg-link px-3.5 text-[12.5px] text-white disabled:opacity-50"
        >
          {t("add.submit")}
        </button>
      </div>
      <p className="px-3.5 pb-3 text-[11.5px] text-ink-3">{t("add.hint")}</p>
    </Popover>
  );
}

function DayPopover({
  date,
  today,
  rect,
  canAdd,
  onClose,
  onAdd,
  children,
}: {
  date: string;
  today: string;
  rect: DOMRect;
  canAdd: boolean;
  onClose: () => void;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("calendar");
  const label = useFormatter().dateTime(dateOnlyFromString(date), DATE_ONLY);
  return (
    <Popover rect={rect} width={340} label={t("dayTasks", { date: label })} tone="pane" onClose={onClose}>
      <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-3 text-sm font-semibold text-ink">
        {label}
        {date === today && <span className="text-xs font-normal text-[var(--on)]">{t("today")}</span>}
        <button type="button" onClick={onClose} aria-label={t("close")} className="ml-auto text-ink-3 hover:text-ink">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="max-h-[360px] overflow-y-auto px-2 pb-1">{children}</div>
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center gap-2.5 border-t border-black/5 px-4 py-2.5 text-sm text-link hover:bg-white/50"
        >
          <Icon name="plus" size={16} />
          {t("add.onThisDay")}
        </button>
      )}
    </Popover>
  );
}

/** '+N개' 창·폰의 그날 목록의 한 줄. 목록 화면의 줄과 같고, 끌어서 달력 칸에 놓을 수 있다. */
function DayRow({
  task,
  canWrite,
  draggable = true,
  selected,
  meId,
  onToggleComplete,
  onToggleImportant,
  onSelect,
}: {
  task: TaskItem;
  canWrite: boolean;
  /** 폰에는 놓을 칸이 없어 끌지 않는다 */
  draggable?: boolean;
  selected: boolean;
  meId: string;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onSelect: () => void;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `R:${task.id}`,
    data: { taskId: task.id },
    disabled: !canWrite || task.isCompleted || !draggable,
  });
  return (
    <div ref={setNodeRef}>
      <TaskRow
        task={task}
        showSeq={false}
        showListName
        meId={meId}
        selected={selected}
        canWrite={canWrite}
        onToggleComplete={onToggleComplete}
        onToggleImportant={onToggleImportant}
        onSelect={onSelect}
        dragHandle={listeners as React.HTMLAttributes<HTMLElement> | undefined}
        dragging={isDragging}
      />
    </div>
  );
}

function GhostRow({ task, where, onOpen }: { task: TaskItem; where: string; onOpen: () => void }) {
  const t = useTranslations("calendar");
  return (
    <button
      type="button"
      data-ghost=""
      onClick={onOpen}
      className="mb-1 flex w-full items-center gap-3.5 rounded border border-dashed border-[#c9a99b] px-4 py-2.5 text-left opacity-80 hover:bg-[var(--row)]"
    >
      <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-dashed border-[var(--on-muted)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--on-muted)]">{task.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--on-muted)]">
          <Icon name="repeat" size={12} />
          {t("nextRepeat", { where })}
        </span>
      </span>
    </button>
  );
}

function FilterPopover({
  rect,
  lists,
  hidden,
  onToggle,
  onShowAll,
  onClose,
}: {
  rect: DOMRect;
  lists: CalendarList[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("calendar");
  return (
    <Popover rect={rect} width={250} label={t("filter.title")} tone="plain" onClose={onClose}>
      <div className="px-3.5 pb-1 pt-3 text-xs font-semibold text-ink-2">{t("filter.title")}</div>
      <div className="max-h-[320px] overflow-y-auto pb-1">
        {lists.map((l) => (
          <label
            key={l.id}
            className="flex cursor-pointer items-center gap-2.5 px-3.5 py-1.5 text-sm hover:bg-side-hover"
          >
            <input
              type="checkbox"
              checked={!hidden.has(l.id)}
              onChange={() => onToggle(l.id)}
              className="accent-[#2564cf]"
            />
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
            <span className="min-w-0 flex-1 truncate">{listPath(l.groupName, l.name)}</span>
            {!l.writable && <span className="text-[11px] text-ink-3">{t("filter.viewOnly")}</span>}
          </label>
        ))}
      </div>
      {hidden.size > 0 && (
        <button
          type="button"
          onClick={onShowAll}
          className="w-full border-t border-divider px-3.5 py-2 text-left text-sm text-link hover:bg-side-hover"
        >
          {t("filter.showAll")}
        </button>
      )}
    </Popover>
  );
}
