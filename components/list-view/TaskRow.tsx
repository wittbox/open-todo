"use client";

import { Icon } from "@/components/icons";
import { dateOnlyFromString, isOverdue } from "@/lib/date";
import { DATE_ONLY } from "@/lib/format";
import { listPath } from "@/lib/list-path";
import type { TaskItem } from "@/lib/queries/list";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";

/**
 * 목록 한 줄. 스마트 뷰에서도 그대로 쓰므로 목록 이름을 함께 보여줄 수 있게 해 둔다.
 */
export function TaskRow({
  task,
  showSeq,
  showListName,
  meId,
  selected,
  canWrite,
  onToggleComplete,
  onToggleImportant,
  onSelect,
  dragHandle,
  dragging,
}: {
  task: TaskItem;
  showSeq: boolean;
  showListName?: boolean;
  /** 보고 있는 사람. 담당자가 본인이면 굳이 이름을 붙이지 않는다. */
  meId?: string;
  selected: boolean;
  canWrite: boolean;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onSelect: () => void;
  dragHandle?: React.HTMLAttributes<HTMLElement>;
  dragging?: boolean;
}) {
  const t = useTranslations("tasks");
  const tz = useTimeZone();
  const format = useFormatter();
  const due = task.dueDate ? dateOnlyFromString(task.dueDate) : null;
  const overdue = due != null && !task.isCompleted && isOverdue(due, new Date(), tz);
  const meta: React.ReactNode[] = [];

  if (showListName) meta.push(<span key="l">{listPath(task.groupName, task.listName)}</span>);
  // 남이 맡은 일만 표시한다. 내 것에까지 내 이름을 붙이면 줄만 길어진다.
  if (task.assignee && task.assignee.id !== meId) {
    meta.push(
      <span key="a" className="inline-flex items-center gap-1">
        <span
          className="grid h-[15px] w-[15px] place-items-center rounded-full text-[8px] font-semibold text-white"
          style={{ background: task.assignee.avatarColor }}
        >
          {task.assignee.name.slice(0, 2)}
        </span>
        {task.assignee.name}
      </span>,
    );
  }
  if (task.stepCount > 0) meta.push(<span key="s">{task.stepDoneCount}/{task.stepCount}</span>);
  if (due) {
    meta.push(
      <span key="d" className={overdue ? "text-[var(--overdue)]" : undefined}>
        <Icon name="calendar" size={13} className="mr-1 inline align-[-2px]" />
        {format.dateTime(due, DATE_ONLY)}
      </span>,
    );
  }
  if (task.remindAt) {
    meta.push(
      <Icon
        key="b"
        name="bell"
        size={13}
        className={new Date(task.remindAt) < new Date() ? "opacity-50" : undefined}
      />,
    );
  }
  if (task.repeat) meta.push(<Icon key="r" name="repeat" size={13} />);
  if (task.attachmentCount > 0) {
    meta.push(
      <span key="f" className="inline-flex items-center gap-0.5">
        <Icon name="clip" size={13} />
        {task.attachmentCount}
      </span>,
    );
  }
  if (task.note) meta.push(<Icon key="n" name="note" size={13} />);

  return (
    <div
      className={[
        "group mb-1 flex touch-manipulation items-start gap-3.5 rounded px-4 py-3 transition-opacity [-webkit-touch-callout:none]",
        selected ? "bg-[var(--row-hover)] ring-1 ring-white/35" : "bg-[var(--row)] hover:bg-[var(--row-hover)]",
        dragging ? "opacity-40" : "",
      ].join(" ")}
      {...dragHandle}
    >
      <button
        type="button"
        disabled={!canWrite}
        onClick={onToggleComplete}
        aria-label={task.isCompleted ? t("row.uncomplete") : t("row.complete")}
        className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-[var(--on)] ${
          task.isCompleted ? "bg-[var(--on)]" : ""
        } ${canWrite ? "" : "cursor-default opacity-70"}`}
      >
        {task.isCompleted && <Icon name="check" size={13} className="text-[var(--row-hover)]" />}
      </button>

      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span
          className={`block text-sm ${
            task.isCompleted ? "text-[var(--on-muted)] line-through" : "text-[var(--on)]"
          }`}
        >
          {showSeq && <span className="mr-1.5 font-mono text-xs text-[var(--on-muted)]">#{task.seq}</span>}
          {task.title}
        </span>
        {meta.length > 0 && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--on-muted)]">
            {meta.map((m, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">·</span>}
                {m}
              </span>
            ))}
          </span>
        )}
      </button>

      <button
        type="button"
        disabled={!canWrite}
        onClick={onToggleImportant}
        aria-label={task.isImportant ? t("row.unimportant") : t("row.important")}
        className={`shrink-0 ${task.isImportant ? "text-[var(--on)]" : "text-[var(--on-muted)]"} ${
          canWrite ? "" : "cursor-default opacity-70"
        }`}
      >
        <Icon name={task.isImportant ? "starFilled" : "star"} />
      </button>
    </div>
  );
}
