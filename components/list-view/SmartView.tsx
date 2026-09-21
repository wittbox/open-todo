"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { PaneButton, ThemedPane } from "@/components/list-view/ThemedPane";
import { TaskRow } from "@/components/list-view/TaskRow";
import { createTask, updateTask } from "@/lib/actions/task";
import type { PaneColors } from "@/components/list-view/ThemedPane";
import type { TaskItem } from "@/lib/queries/list";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import { openPanel } from "@/components/shell/shell";
import { useTranslations } from "next-intl";

export type Section = { label: string | null; tasks: TaskItem[] };

/**
 * 여러 목록의 작업을 모아 보는 화면 — 지금은 '나에게 할당됨' 만 쓴다
 * (오늘 할 일 · 중요 · 계획된 일정은 2026-09-16 에 달력으로 합쳤다).
 * 여러 목록의 작업이 섞이므로 행마다 목록 이름을 보여준다.
 */
export function SmartView({
  colors,
  title,
  subtitle,
  titleIcon,
  sections,
  done,
  emptyMessage,
  writableTaskIds,
  addTo,
  addOptions,
  meId,
}: {
  colors: PaneColors;
  title: string;
  subtitle?: string;
  titleIcon?: IconName;
  sections: Section[];
  done: TaskItem[];
  emptyMessage: React.ReactNode;
  /** 편집 권한이 있는 작업 id. 없으면 체크·별표가 잠긴다. */
  writableTaskIds: string[];
  /** 작업을 추가할 기본 목록. 없으면 추가 입력을 감춘다. */
  addTo: { listId: string; label: string } | null;
  addOptions?: { important?: boolean; myDay?: boolean; dueDate?: string };
  /** 담당자가 본인인 작업에는 이름을 붙이지 않기 위해 넘긴다. */
  meId?: string;
}) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("task");
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const writable = new Set(writableTaskIds);
  const all = [...sections.flatMap((s) => s.tasks), ...done];

  const [patched, applyOptimistic] = useOptimistic(
    all,
    (prev: TaskItem[], p: { id: string; changes: Partial<TaskItem> }) =>
      prev.map((t) => (t.id === p.id ? { ...t, ...p.changes } : t)),
  );
  const byId = new Map(patched.map((t) => [t.id, t]));
  const view = (t: TaskItem) => byId.get(t.id) ?? t;

  function select(id: string) {
    const q = new URLSearchParams(params.toString());
    const closing = selectedId === id;
    if (closing) q.delete("task");
    else q.set("task", id);
    const href = `${pathname}${q.size ? `?${q}` : ""}`;
    if (closing) router.replace(href, { scroll: false });
    else openPanel(router, href);
  }

  function patch(t: TaskItem, changes: Partial<TaskItem>) {
    startTransition(async () => {
      applyOptimistic({ id: t.id, changes });
      const res = await runAction(() =>
        updateTask(t.id, changes as { isCompleted?: boolean; isImportant?: boolean }),
      );
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      router.refresh();
    });
  }

  const hasAny = sections.some((s) => s.tasks.length > 0);

  function row(raw: TaskItem) {
    const t = view(raw);
    const canWrite = writable.has(t.id);
    return (
      <TaskRow
        key={t.id}
        task={t}
        showSeq={false}
        showListName
        meId={meId}
        selected={selectedId === t.id}
        canWrite={canWrite}
        onToggleComplete={() => patch(t, { isCompleted: !t.isCompleted })}
        onToggleImportant={() => patch(t, { isImportant: !t.isImportant })}
        onSelect={() => select(t.id)}
      />
    );
  }

  return (
    <ThemedPane
      colors={colors}
      title={title}
      subtitle={subtitle}
      titleIcon={titleIcon ? <Icon name={titleIcon} size={26} /> : undefined}
      actions={
        <>
          <PaneButton title={t("themeListOnly")}><Icon name="image" /></PaneButton>
          <PaneButton title={t("moreOptions")}><Icon name="dots" /></PaneButton>
        </>
      }
      footer={
        addTo ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = addRef.current?.value.trim();
              if (!v) return;
              addRef.current!.value = "";
              startTransition(async () => {
                const res = await runAction(() => createTask(addTo.listId, v, addOptions));
                if (!res.ok && !handledAuthFailure(res)) setError(res.error);
                router.refresh();
              });
            }}
            className="flex h-[52px] items-center gap-3.5 rounded bg-[var(--row-hover)] px-4"
          >
            <Icon name="plus" className="shrink-0 text-[var(--on)]" />
            <input
              ref={addRef}
              placeholder={addTo.label}
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--on)] outline-none placeholder:text-[var(--on)] placeholder:opacity-85"
            />
          </form>
        ) : undefined
      }
    >
      {error && (
        <div className="mb-2 flex items-start gap-2 rounded bg-white/90 px-3 py-2 text-xs text-danger">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><Icon name="x" size={13} /></button>
        </div>
      )}

      {!hasAny && done.length === 0 && (
        <div className="grid h-full place-items-center px-10 text-center">
          <div className="text-sm leading-relaxed text-[var(--on)]">{emptyMessage}</div>
        </div>
      )}

      {sections.map((s) =>
        s.tasks.length === 0 ? null : (
          <div key={s.label ?? "_"}>
            {s.label && (
              <div className="my-2.5 inline-flex h-[30px] items-center gap-2 rounded bg-[var(--row)] px-3 text-[13px] text-[var(--on)]">
                {s.label} <span className="text-[var(--on-muted)]">{s.tasks.length}</span>
              </div>
            )}
            {s.tasks.map(row)}
          </div>
        ),
      )}

      {done.length > 0 && (
        <>
          <button
            onClick={() => setDoneOpen((v) => !v)}
            className="my-2.5 inline-flex h-[30px] items-center gap-2 rounded bg-[var(--row)] px-3 text-[13px] text-[var(--on)] hover:bg-[var(--row-hover)]"
          >
            <Icon name={doneOpen ? "chevronDown" : "chevronRight"} size={14} />
            {t("completedCount", { count: done.length })}
          </button>
          {doneOpen && done.map(row)}
        </>
      )}
    </ThemedPane>
  );
}
