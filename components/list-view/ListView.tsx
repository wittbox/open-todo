"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Icon } from "@/components/icons";
import { ContextMenu, type MenuAnchor, type MenuItem } from "@/components/ui/menu";
import { ShareDialog } from "@/components/share/ShareDialog";
import { PaneButton, ThemedPane } from "@/components/list-view/ThemedPane";
import { TaskRow } from "@/components/list-view/TaskRow";
import { THEMES, getTheme } from "@/lib/theme";
import { SORT_KEYS, sortTasks } from "@/lib/task-sort";
import { createTask, reorderTask, updateTask } from "@/lib/actions/task";
import { updateListSettings } from "@/lib/actions/list";
import type { ListView as ListViewData, TaskItem } from "@/lib/queries/list";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import { openPanel } from "@/components/shell/shell";
import { useTranslations } from "next-intl";

export function ListView({ view }: { view: ListViewData }) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("task");
  const [, startTransition] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; view: "main" | "sort" } | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(true);
  const addRef = useRef<HTMLInputElement>(null);

  // 체크·별표는 서버 왕복을 기다리지 않고 즉시 반영한다.
  const [tasks, applyOptimistic] = useOptimistic(
    view.tasks,
    (prev: TaskItem[], patch: { id: string; changes: Partial<TaskItem> }) =>
      prev.map((t) => (t.id === patch.id ? { ...t, ...patch.changes } : t)),
  );

  const act = (fn: () => Promise<ActionResult<unknown>>) => {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      router.refresh();
    });
  };

  const open = useMemo(() => sortTasks(tasks.filter((t) => !t.isCompleted), view.sortBy), [tasks, view.sortBy]);
  const done = useMemo(
    () => tasks.filter((t) => t.isCompleted).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    [tasks],
  );

  const theme = getTheme(view.themeKey);
  const manualOrder = view.sortBy === "MANUAL";
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // 손가락은 0.3초 누르고 있어야 끈다 — 그냥 밀면 목록이 스크롤된다.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function select(id: string | null) {
    const q = new URLSearchParams(params.toString());
    if (id) q.set("task", id);
    else q.delete("task");
    const href = `${pathname}${q.size ? `?${q}` : ""}`;
    if (id) openPanel(router, href);
    else router.replace(href, { scroll: false });
  }

  function toggleComplete(t: TaskItem) {
    startTransition(async () => {
      applyOptimistic({ id: t.id, changes: { isCompleted: !t.isCompleted } });
      const res = await runAction(() => updateTask(t.id, { isCompleted: !t.isCompleted }));
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      router.refresh();
    });
  }

  function toggleImportant(t: TaskItem) {
    startTransition(async () => {
      applyOptimistic({ id: t.id, changes: { isImportant: !t.isImportant } });
      const res = await runAction(() => updateTask(t.id, { isImportant: !t.isImportant }));
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      router.refresh();
    });
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = open.map((t) => t.id);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const i = ids.indexOf(String(e.active.id));
    act(() => reorderTask(String(e.active.id), ids[i - 1] ?? null, ids[i + 1] ?? null));
  }

  const menuItems: MenuItem[] =
    menu?.view === "sort"
      ? SORT_KEYS.map((k) => ({
          icon: view.sortBy === k ? "check" : undefined,
          label: t(`sort.${k}`),
          onSelect: () => act(() => updateListSettings(view.id, { sortBy: k })),
        }))
      : [
          {
            icon: "list",
            label: t("menu.sortBy", { name: t(`sort.${view.sortBy}`) }),
            submenu: true,
            pending: view.canWrite ? undefined : t("noPermission"),
            onSelect: () => setMenu((m) => (m ? { ...m, view: "sort" } : m)),
          },
          {
            icon: "check",
            label: view.showCompleted ? t("menu.hideCompleted") : t("menu.showCompleted"),
            pending: view.canWrite ? undefined : t("noPermission"),
            onSelect: () => act(() => updateListSettings(view.id, { showCompleted: !view.showCompleted })),
          },
          {
            icon: "jump",
            label: view.showSeq ? t("menu.hideSeq") : t("menu.showSeq"),
            pending: view.canWrite ? undefined : t("noPermission"),
            onSelect: () => act(() => updateListSettings(view.id, { showSeq: !view.showSeq })),
          },
          { kind: "separator" },
          { icon: "print", label: t("menu.print"), pending: t("menu.phase7") },
          { icon: "mail", label: t("menu.mail"), pending: t("menu.phase7") },
        ];

  const subtitle = [view.groupName, view.shareCount > 0 ? t("sharedWith", { count: view.shareCount }) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <ThemedPane
      colors={theme}
      title={view.name}
      subtitle={subtitle || undefined}
      actions={
        <>
          <span onClick={() => setShareOpen(true)}>
            <PaneButton title={t("shareList")}><Icon name="share" /></PaneButton>
          </span>
          <span className="relative">
            <span onClick={() => view.canWrite && setThemeOpen((v) => !v)}>
              <PaneButton title={view.canWrite ? t("changeTheme") : t("changeThemeDenied")}>
                <Icon name="image" />
              </PaneButton>
            </span>
            {themeOpen && (
              <div className="absolute right-0 top-10 z-30 w-[300px] rounded-md border border-[#e1dfdd] bg-white p-3.5 shadow-[0_6.4px_14.4px_rgba(0,0,0,.132)]">
                <p className="mb-2 text-xs text-ink-2">{t("theme.title")}</p>
                <div className="flex flex-wrap gap-2.5">
                  {Object.values(THEMES).map((c) => (
                    <button
                      key={c.key}
                      title={t(`theme.${c.key}`)}
                      aria-label={t(`theme.${c.key}`)}
                      onClick={() => {
                        setThemeOpen(false);
                        act(() => updateListSettings(view.id, { themeKey: c.key }));
                      }}
                      style={{ background: c.accent }}
                      className={`h-[34px] w-[34px] rounded-full border-2 ${
                        view.themeKey === c.key ? "border-ink" : "border-transparent"
                      }`}
                    />
                  ))}
                </div>
                <p className="mt-3.5 text-xs text-ink-3">{t("theme.hint")}</p>
              </div>
            )}
          </span>
          <span
            onClick={(e) => setMenu({ anchor: { x: e.clientX - 200, y: e.clientY + 12 }, view: "main" })}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ anchor: { x: e.clientX, y: e.clientY }, view: "main" });
            }}
          >
            <PaneButton title={t("moreOptions")}><Icon name="dots" /></PaneButton>
          </span>
        </>
      }
      footer={
        view.canWrite ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = addRef.current;
              const title = input?.value.trim();
              if (!title) return;
              input!.value = "";
              act(() => createTask(view.id, title));
            }}
            className="flex h-[52px] items-center gap-3.5 rounded bg-[var(--row-hover)] px-4"
          >
            <Icon name="plus" className="shrink-0 text-[var(--on)]" />
            <input
              ref={addRef}
              placeholder={t("addTask")}
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--on)] outline-none placeholder:text-[var(--on)] placeholder:opacity-85"
            />
          </form>
        ) : (
          <div className="flex h-[52px] items-center gap-3.5 rounded bg-[var(--row)] px-4 text-sm text-[var(--on-muted)]">
            <Icon name="circle" />
            {t("readOnlyList")}
          </div>
        )
      }
    >
      {error && (
        <div className="mb-2 flex items-start gap-2 rounded bg-white/90 px-3 py-2 text-xs text-danger">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><Icon name="x" size={13} /></button>
        </div>
      )}

      <DndContext
        id="tasks-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={open.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {open.map((t) => (
            <SortableTask
              key={t.id}
              task={t}
              draggable={manualOrder && view.canWrite}
              showSeq={view.showSeq}
              selected={selectedId === t.id}
              canWrite={view.canWrite}
              onToggleComplete={() => toggleComplete(t)}
              onToggleImportant={() => toggleImportant(t)}
              onSelect={() => select(selectedId === t.id ? null : t.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {open.length === 0 && done.length === 0 && (
        <p className="pt-10 text-center text-sm text-[var(--on-muted)]">
          {t("emptyList")}
        </p>
      )}

      {done.length > 0 && view.showCompleted && (
        <>
          <button
            onClick={() => setDoneOpen((v) => !v)}
            className="my-2.5 inline-flex h-[30px] items-center gap-2 rounded bg-[var(--row)] px-3 text-[13px] text-[var(--on)] hover:bg-[var(--row-hover)]"
          >
            <Icon name={doneOpen ? "chevronDown" : "chevronRight"} size={14} />
            {t("completedCount", { count: done.length })}
          </button>
          {doneOpen &&
            done.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                showSeq={view.showSeq}
                selected={selectedId === t.id}
                canWrite={view.canWrite}
                onToggleComplete={() => toggleComplete(t)}
                onToggleImportant={() => toggleImportant(t)}
                onSelect={() => select(selectedId === t.id ? null : t.id)}
              />
            ))}
        </>
      )}

      {menu && (
        <ContextMenu
          anchor={menu.anchor}
          items={menuItems}
          minWidth={menu.view === "sort" ? 180 : 250}
          onClose={() => setMenu(null)}
        />
      )}

      {shareOpen && (
        <ShareDialog
          subject={{ type: "LIST", id: view.id }}
          onClose={() => {
            setShareOpen(false);
            router.refresh();
          }}
        />
      )}
    </ThemedPane>
  );
}

function SortableTask({
  task,
  draggable,
  ...rest
}: {
  task: TaskItem;
  draggable: boolean;
  showSeq: boolean;
  selected: boolean;
  canWrite: boolean;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <TaskRow task={task} dragging={isDragging} dragHandle={{ ...attributes, ...listeners }} {...rest} />
    </div>
  );
}
