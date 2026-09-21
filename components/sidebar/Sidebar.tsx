"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";

import { Icon, type IconName } from "@/components/icons";
import { ContextMenu, RowMenuButton, type MenuAnchor, type MenuItem } from "@/components/ui/menu";
import { ShareDialog } from "@/components/share/ShareDialog";
import type { ShareSubjectType } from "@/app/generated/prisma/enums";
import type { SidebarData, SidebarGroup, SidebarList } from "@/lib/queries/sidebar";
import type { SearchHit, SearchResult } from "@/lib/queries/tasks";
import { createGroup, renameGroup, reorderGroup, ungroupGroup } from "@/lib/actions/group";
import {
  createList,
  deleteList,
  duplicateList,
  moveListToGroup,
  renameList,
  reorderList,
} from "@/lib/actions/list";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import { ProjectSection } from "@/components/sidebar/ProjectSection";
import { useShell } from "@/components/shell/AppShell";
import { activeKeyOf } from "@/components/shell/shell";

const ROOT = "__root__";
const COLLAPSE_KEY = "todo.collapsedGroups";

/**
 * 그룹 접힘 상태는 사용자마다 다르고 서버에 저장할 값이 아니라 브라우저에만 둔다.
 * useSyncExternalStore 로 읽으면 서버 렌더(모두 펼침)와 어긋나지 않고,
 * effect 안에서 setState 하지 않아도 된다.
 */
const collapseListeners = new Set<() => void>();

function readCollapseRaw(): string {
  try {
    return localStorage.getItem(COLLAPSE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function writeCollapse(ids: string[]) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(ids));
  } catch {
    /* 시크릿 모드 등에서 저장이 막혀도 화면 동작은 유지한다 */
  }
  for (const fn of collapseListeners) fn();
}

function subscribeCollapse(cb: () => void) {
  collapseListeners.add(cb);
  return () => {
    collapseListeners.delete(cb);
  };
}

/** 계정 메뉴는 버튼 오른쪽 끝에 맞춰 연다. */
const ACCOUNT_MENU_WIDTH = 180;

/**
 * 터치 기기의 줄: 손가락 크기(44px), 길게 눌러도 iOS 링크 미리보기가 뜨지 않게 한다 —
 * 길게 누르기는 끌기(0.3초)에 쓴다. 그냥 밀면 스크롤이다.
 */
const TOUCH_ROW = "touch-manipulation pointer-coarse:h-11 [-webkit-touch-callout:none]";

type MenuState =
  | { kind: "list"; id: string; anchor: MenuAnchor; view: "main" | "move" }
  | { kind: "group"; id: string; anchor: MenuAnchor; view: "main" }
  | null;

export function Sidebar({ data }: { data: SidebarData }) {
  const t = useTranslations("nav");
  const titles = useTranslations("nav.titles");
  const router = useRouter();
  const activeKey = activeKeyOf(usePathname());
  const shell = useShell();
  const [, startTransition] = useTransition();

  /* ── 서버 데이터 → 로컬 배치 상태 (드래그 중 낙관적 반영) ── */
  const listsById = useMemo(() => {
    const m = new Map<string, SidebarList>();
    for (const g of data.groups) for (const l of g.lists) m.set(l.id, l);
    for (const l of data.ungrouped) m.set(l.id, l);
    for (const l of data.shared) m.set(l.id, l);
    return m;
  }, [data]);

  const serverLayout = useMemo(() => {
    const containers: Record<string, string[]> = { [ROOT]: data.ungrouped.map((l) => l.id) };
    for (const g of data.groups) containers[g.id] = g.lists.map((l) => l.id);
    return { containers, groupOrder: data.groups.map((g) => g.id) };
  }, [data]);

  // 드래그 중에만 서버 데이터를 덮어쓰는 로컬 배치.
  // 새 서버 데이터가 오면 렌더 도중 초기화한다(effect 안에서 setState 하면 렌더가 한 번 더 돈다).
  const [layout, setLayout] = useState(serverLayout);
  const [syncedWith, setSyncedWith] = useState(serverLayout);
  if (syncedWith !== serverLayout) {
    setSyncedWith(serverLayout);
    setLayout(serverLayout);
  }
  const { containers, groupOrder } = layout;
  const setContainers = (fn: (prev: Record<string, string[]>) => Record<string, string[]>) =>
    setLayout((prev) => ({ ...prev, containers: fn(prev.containers) }));
  const setGroupOrder = (next: string[]) => setLayout((prev) => ({ ...prev, groupOrder: next }));

  const groupsById = useMemo(() => new Map(data.groups.map((g) => [g.id, g])), [data.groups]);

  /* ── 접힘 상태 ── */
  const collapsedRaw = useSyncExternalStore(subscribeCollapse, readCollapseRaw, () => "[]");
  const collapsed = useMemo(() => {
    try {
      return new Set(JSON.parse(collapsedRaw) as string[]);
    } catch {
      return new Set<string>();
    }
  }, [collapsedRaw]);

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeCollapse([...next]);
  };
  const expandGroup = (id: string) => {
    if (!collapsed.has(id)) return;
    const next = new Set(collapsed);
    next.delete(id);
    writeCollapse([...next]);
  };

  /* ── Ctrl+G 번호로 이동 ── */
  const [jumpOpen, setJumpOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setJumpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ── 메뉴 · 이름 편집 · 새 항목 입력 ── */
  const [menu, setMenu] = useState<MenuState>(null);
  const [accountMenu, setAccountMenu] = useState<MenuAnchor | null>(null);
  const logoutForm = useRef<HTMLFormElement>(null);
  const [renaming, setRenaming] = useState<{ kind: "list" | "group"; id: string } | null>(null);
  const [creating, setCreating] = useState<{ groupId: string | null } | null>(null);
  const [sharing, setSharing] = useState<{ type: ShareSubjectType; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function act(fn: () => Promise<ActionResult<unknown>>) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      router.refresh();
    });
  }

  /* ── 드래그 ── */
  const [dragging, setDragging] = useState<string | null>(null);
  // 키보드로도 순서를 바꿀 수 있게 한다 (Space 로 들고 ↑↓ 이동, 다시 Space 로 놓기).
  // 손가락은 0.3초 누르고 있어야 끈다 — 서랍 목록을 밀어 스크롤하는 것과 겹치지 않게.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = useCallback(
    (listId: string) => Object.keys(containers).find((c) => containers[c].includes(listId)) ?? null,
    [containers],
  );

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const activeId = String(e.active.id);
    if (!activeId.startsWith("L:") || !e.over) return;

    const listId = activeId.slice(2);
    const overId = String(e.over.id);
    const from = findContainer(listId);
    const to = overId.startsWith("C:")
      ? overId.slice(2)
      : overId.startsWith("L:")
        ? findContainer(overId.slice(2))
        : null;
    if (!from || !to || from === to) return;

    setContainers((prev) => {
      const next = { ...prev };
      next[from] = next[from].filter((x) => x !== listId);
      const overIndex = overId.startsWith("L:") ? next[to].indexOf(overId.slice(2)) : next[to].length;
      next[to] = [...next[to]];
      next[to].splice(overIndex < 0 ? next[to].length : overIndex, 0, listId);
      return next;
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    setDragging(null);
    if (!e.over) return;
    const overId = String(e.over.id);

    if (activeId.startsWith("G:")) {
      if (!overId.startsWith("G:")) return;
      const id = activeId.slice(2);
      const overGroupId = overId.slice(2);
      if (id === overGroupId) return;

      const next = [...groupOrder];
      next.splice(next.indexOf(id), 1);
      next.splice(next.indexOf(overGroupId), 0, id);
      setGroupOrder(next);

      const i = next.indexOf(id);
      act(() => reorderGroup(id, next[i - 1] ?? null, next[i + 1] ?? null));
      return;
    }

    if (!activeId.startsWith("L:")) return;
    const listId = activeId.slice(2);
    const container = findContainer(listId);
    if (!container) return;

    let items = containers[container];
    if (overId.startsWith("L:")) {
      const overListId = overId.slice(2);
      if (overListId !== listId && items.includes(overListId)) {
        items = [...items];
        items.splice(items.indexOf(listId), 1);
        items.splice(items.indexOf(overListId), 0, listId);
        setContainers((prev) => ({ ...prev, [container]: items }));
      }
    }

    const i = items.indexOf(listId);
    act(() =>
      reorderList(listId, container === ROOT ? null : container, items[i - 1] ?? null, items[i + 1] ?? null),
    );
  }

  /* ── 메뉴 구성 ── */
  function listMenuItems(list: SidebarList): MenuItem[] {
    const manage = list.role === "ADMIN";
    if (menu?.kind === "list" && menu.view === "move") {
      const targets: MenuItem[] = data.groups
        .filter((g) => g.role === "ADMIN" && g.id !== list.groupId)
        .map((g) => ({
          icon: "group" as IconName,
          label: g.name,
          onSelect: () => act(() => moveListToGroup(list.id, g.id)),
        }));
      return [
        ...(list.groupId
          ? [
              {
                icon: "out" as IconName,
                label: t("listMenu.outOfGroup"),
                onSelect: () => act(() => moveListToGroup(list.id, null)),
              },
            ]
          : []),
        ...(targets.length ? [{ kind: "separator" as const }, ...targets] : []),
        ...(targets.length === 0 && !list.groupId
          ? [{ label: t("listMenu.noTargetGroup"), pending: t("pendingNone") } as MenuItem]
          : []),
      ];
    }
    return [
      {
        icon: "edit",
        label: t("listMenu.rename"),
        shortcut: "F2",
        pending: manage ? undefined : t("noPermission"),
        onSelect: () => setRenaming({ kind: "list", id: list.id }),
      },
      {
        icon: "share",
        label: t("listMenu.share"),
        onSelect: () => setSharing({ type: "LIST", id: list.id }),
      },
      {
        icon: "move",
        label: t("listMenu.move"),
        submenu: true,
        pending: manage ? undefined : t("noPermission"),
        onSelect: () => setMenu((m) => (m && m.kind === "list" ? { ...m, view: "move" } : m)),
      },
      ...(list.groupId
        ? [
            {
              icon: "out" as IconName,
              label: t("listMenu.removeFromGroup"),
              pending: manage ? undefined : t("noPermission"),
              onSelect: () => act(() => moveListToGroup(list.id, null)),
            },
          ]
        : []),
      { kind: "separator" },
      { icon: "print", label: t("listMenu.print"), pending: t("pendingPhase7") },
      { icon: "mail", label: t("listMenu.mail"), pending: t("pendingPhase7") },
      { icon: "copy", label: t("listMenu.duplicate"), onSelect: () => act(() => duplicateList(list.id)) },
      { kind: "separator" },
      {
        icon: "trash",
        label: t("listMenu.delete"),
        shortcut: "Delete",
        danger: true,
        pending: manage ? undefined : t("noPermission"),
        onSelect: () => confirmDeleteList(list),
      },
    ];
  }

  function confirmDeleteList(list: SidebarList) {
    if (window.confirm(t("listMenu.confirmDelete", { name: list.name }))) {
      act(() => deleteList(list.id));
    }
  }

  function groupMenuItems(group: SidebarGroup): MenuItem[] {
    const manage = group.role === "ADMIN";
    return [
      {
        icon: "edit",
        label: t("groupMenu.rename"),
        pending: manage ? undefined : t("noPermission"),
        onSelect: () => setRenaming({ kind: "group", id: group.id }),
      },
      {
        icon: "plus",
        label: t("newList"),
        pending: manage ? undefined : t("noPermission"),
        onSelect: () => {
          expandGroup(group.id);
          setCreating({ groupId: group.id });
        },
      },
      {
        icon: "share",
        label: t("groupMenu.share"),
        onSelect: () => setSharing({ type: "GROUP", id: group.id }),
      },
      { kind: "separator" },
      {
        icon: "ungroup",
        label: t("groupMenu.ungroup"),
        pending: manage ? undefined : t("noPermission"),
        onSelect: () => {
          if (window.confirm(t("groupMenu.confirmUngroup", { name: group.name }))) {
            act(() => ungroupGroup(group.id));
          }
        },
      },
    ];
  }

  const menuItems: MenuItem[] =
    menu?.kind === "list"
      ? listMenuItems(listsById.get(menu.id)!)
      : menu?.kind === "group"
        ? groupMenuItems(groupsById.get(menu.id)!)
        : [];

  const draggingList = dragging?.startsWith("L:") ? listsById.get(dragging.slice(2)) : null;
  const draggingGroup = dragging?.startsWith("G:") ? groupsById.get(dragging.slice(2)) : null;

  return (
    // select-none: 드래그할 때 글자가 선택되어 끌리는 것을 막는다.
    // touch-none 은 두지 않는다 — 폰·태블릿 서랍에서 목록을 손가락으로 스크롤해야 한다.
    // 폭은 셸의 틀(components/shell/AppShell.tsx)이 정한다.
    <aside className="flex w-full shrink-0 select-none flex-col border-r border-side-border bg-side-bg">
      {/* 사용자. 로그아웃은 계정 메뉴 안에 둔다 —
          사이드바 구석의 아이콘 전용 버튼으로 두면 하단의 '새 그룹' 버튼과 생김새가
          겹쳐서, 어느 쪽이 무엇인지 눌러 보기 전에는 알 수 없다. */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white"
          style={{ background: data.user.avatarColor }}
        >
          {data.user.name.slice(0, 2)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{data.user.name}</div>
          <div className="truncate text-xs text-ink-2">{data.user.email}</div>
        </div>
        <form ref={logoutForm} action="/auth/signout" method="post" className="hidden" />
        <button
          title={t("account")}
          aria-haspopup="menu"
          aria-expanded={accountMenu != null}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAccountMenu(accountMenu ? null : { x: r.right - ACCOUNT_MENU_WIDTH, y: r.bottom + 4 });
          }}
          className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded text-ink-2 hover:bg-side-hover"
        >
          <Icon name="chevronDown" size={16} />
        </button>
        {/* 1024px 부터 메뉴를 붙였다 뗐다 할 수 있다. 뗀 메뉴는 좁은 화면처럼 서랍이 된다. */}
        <button
          type="button"
          onClick={shell.toggleCollapsed}
          title={shell.collapsed ? t("dockMenu") : t("collapseMenu")}
          aria-label={shell.collapsed ? t("dockMenu") : t("collapseMenu")}
          className="hidden h-7 w-7 shrink-0 place-items-center rounded text-ink-2 hover:bg-side-hover lg:grid"
        >
          <Icon name="sidebar" size={16} />
        </button>
        <button
          type="button"
          onClick={shell.close}
          aria-label={t("closeMenu")}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-side-hover ${shell.collapsed ? "" : "lg:hidden"}`}
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      <SearchBox />

      {jumpOpen && <JumpDialog onClose={() => setJumpOpen(false)} />}

      {sharing && (
        <ShareDialog
          subject={sharing}
          onClose={() => {
            setSharing(null);
            router.refresh();
          }}
        />
      )}

      <nav className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-1">
        {/* 오늘 할 일 · 중요 · 계획된 일정은 2026-09-16 에 달력으로 합쳤다(옛 주소는 next.config 가 넘긴다). */}
        <SmartRow
          href="/calendar"
          icon="calendarMonth"
          label={titles("calendar")}
          color="#a4373a"
          active={activeKey === "calendar"}
        />
        <SmartRow
          href="/assigned"
          icon="person"
          label={titles("assigned")}
          color="#0f7b6c"
          count={data.assignedCount}
          active={activeKey === "assigned"}
        />
        <SmartRow
          href="/tasks"
          icon="home"
          label={titles("tasks")}
          color="#2564cf"
          count={data.inboxOpenCount}
          active={activeKey === "tasks" || (data.inboxListId != null && activeKey === `list:${data.inboxListId}`)}
        />

        <SmartRow
          href="/notifications"
          icon="bell"
          label={titles("notifications")}
          color="#2564cf"
          count={data.unreadCount}
          active={activeKey === "notifications"}
        />
        <SmartRow
          href="/reports"
          icon="note"
          label={titles("reports")}
          color="#0f7b6c"
          active={activeKey.startsWith("reports")}
        />

        <ProjectSection
          projects={data.projects}
          activeKey={activeKey}
          collapsed={collapsed.has("__projects__")}
          onToggle={() => toggleCollapse("__projects__")}
        />

        <div className="mx-4 my-1.5 h-px bg-side-border" />

        <DndContext
          // id를 고정하지 않으면 dnd-kit이 서버와 클라이언트에서 다른 aria-describedby를
          // 만들어 hydration 불일치가 난다.
          id="sidebar-dnd"
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <SortableContext items={groupOrder.map((id) => `G:${id}`)} strategy={verticalListSortingStrategy}>
            {groupOrder.map((gid) => {
              const g = groupsById.get(gid);
              if (!g) return null;
              const open = !collapsed.has(gid);
              return (
                <div key={gid}>
                  <GroupRow
                    group={g}
                    open={open}
                    renaming={renaming?.kind === "group" && renaming.id === gid}
                    onToggle={() => toggleCollapse(gid)}
                    onMenu={(anchor) => setMenu({ kind: "group", id: gid, anchor, view: "main" })}
                    onRename={(name) => {
                      setRenaming(null);
                      if (name !== g.name) act(() => renameGroup(gid, name));
                    }}
                    onCancelRename={() => setRenaming(null)}
                  />
                  {open && (
                    <ListContainer id={gid} listIds={containers[gid] ?? []}>
                      {(containers[gid] ?? []).map((lid) => {
                        const l = listsById.get(lid);
                        return l ? renderList(l, true) : null;
                      })}
                      {creating?.groupId === gid && (
                        <NewItemInput
                          indent
                          placeholder={t("listName")}
                          onCancel={() => setCreating(null)}
                          onCommit={(name) => {
                            setCreating(null);
                            act(() => createList(name, gid));
                          }}
                        />
                      )}
                      {(containers[gid] ?? []).length === 0 && creating?.groupId !== gid && (
                        <p className="py-1.5 pl-[44px] pr-4 text-xs text-ink-3">{t("dropListsHere")}</p>
                      )}
                    </ListContainer>
                  )}
                </div>
              );
            })}
          </SortableContext>

          <ListContainer id={ROOT} listIds={containers[ROOT] ?? []}>
            {(containers[ROOT] ?? []).map((lid) => {
              const l = listsById.get(lid);
              return l ? renderList(l, false) : null;
            })}
          </ListContainer>

          {data.shared.length > 0 && (
            <>
              <div className="mx-4 my-1.5 h-px bg-side-border" />
              <div className="flex items-center gap-2 px-4 pb-1 pt-1.5 text-[11px] text-ink-3">
                <Icon name="share" size={13} />
                {t("sharedLists")}
              </div>
              {data.sharedTree.groups.map((g) => {
                const open = !collapsed.has(g.id);
                return (
                  <div key={g.id}>
                    <SharedGroupRow group={g} open={open} onToggle={() => toggleCollapse(g.id)} />
                    {open &&
                      g.lists.map((l) => (
                        <SharedListRow
                          key={l.id}
                          list={l}
                          inGroup
                          active={activeKey === `list:${l.id}`}
                          onMenu={(anchor) => setMenu({ kind: "list", id: l.id, anchor, view: "main" })}
                        />
                      ))}
                  </div>
                );
              })}
              {data.sharedTree.lists.map((l) => (
                <SharedListRow
                  key={l.id}
                  list={l}
                  inGroup={false}
                  active={activeKey === `list:${l.id}`}
                  onMenu={(anchor) => setMenu({ kind: "list", id: l.id, anchor, view: "main" })}
                />
              ))}
            </>
          )}

          <DragOverlay>
            {draggingList && (
              <div className="flex items-center gap-3 rounded bg-white px-4 py-2 text-sm shadow-md">
                <Icon name="list" size={17} className="text-ink-2" />
                {draggingList.name}
              </div>
            )}
            {draggingGroup && (
              <div className="flex items-center gap-3 rounded bg-white px-4 py-2 text-sm shadow-md">
                <Icon name="group" size={17} className="text-ink-2" />
                {draggingGroup.name}
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {creating?.groupId === null && (
          <NewItemInput
            placeholder={t("listName")}
            onCancel={() => setCreating(null)}
            onCommit={(name) => {
              setCreating(null);
              act(() => createList(name, null));
            }}
          />
        )}
      </nav>

      {error && (
        <div className="flex items-start gap-2 border-t border-side-border bg-[#fdf3f4] px-4 py-2 text-xs text-danger">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      <div className="flex h-11 shrink-0 items-center border-t border-side-border">
        <button
          onClick={() => setCreating({ groupId: null })}
          className="flex h-full flex-1 items-center gap-3 px-4 text-sm hover:bg-side-hover"
        >
          <Icon name="plus" size={17} />
          {t("newList")}
        </button>
        {/* 아이콘만 두면 무슨 버튼인지 눌러 봐야 안다. 이름을 붙이고 세로선으로 갈라 둔다. */}
        <button
          onClick={() => act(async () => createGroup(t("untitledGroup")))}
          className="flex h-full items-center gap-2 border-l border-side-border px-3.5 text-sm text-ink-2 hover:bg-side-hover"
        >
          <Icon name="groupPlus" size={17} />
          {t("newGroup")}
        </button>
      </div>

      {menu && (
        <ContextMenu
          anchor={menu.anchor}
          items={menuItems}
          title={menu.kind === "list" ? listsById.get(menu.id)?.name : groupsById.get(menu.id)?.name}
          minWidth={menu.kind === "list" && menu.view === "move" ? 200 : 250}
          onClose={() => setMenu(null)}
        />
      )}

      {accountMenu && (
        <ContextMenu
          anchor={accountMenu}
          minWidth={ACCOUNT_MENU_WIDTH}
          items={[
            { icon: "gear", label: t("settings"), onSelect: () => router.push("/settings") },
            ...(data.user.isAdmin
              ? ([{ icon: "lock", label: t("admin"), onSelect: () => router.push("/admin") }] as const)
              : []),
            { kind: "separator" as const },
            { icon: "out", label: t("signOut"), onSelect: () => logoutForm.current?.requestSubmit() },
          ]}
          onClose={() => setAccountMenu(null)}
        />
      )}
    </aside>
  );

  function renderList(l: SidebarList, inGroup: boolean) {
    return (
      <ListRow
        key={l.id}
        list={l}
        inGroup={inGroup}
        active={activeKey === `list:${l.id}`}
        renaming={renaming?.kind === "list" && renaming.id === l.id}
        onMenu={(anchor) => setMenu({ kind: "list", id: l.id, anchor, view: "main" })}
        onRename={(name) => {
          setRenaming(null);
          if (name !== l.name) act(() => renameList(l.id, name));
        }}
        onCancelRename={() => setRenaming(null)}
        onRequestRename={() => setRenaming({ kind: "list", id: l.id })}
        onRequestDelete={() => confirmDeleteList(l)}
      />
    );
  }
}

/* ── 하위 컴포넌트 ─────────────────────────────────────────────── */

function SmartRow({
  href, icon, label, color, count, active,
}: {
  href: string; icon: IconName; label: string; color: string; count?: number; active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`relative flex h-9 items-center gap-3 px-4 text-sm pointer-coarse:h-11 ${active ? "bg-side-active" : "hover:bg-side-hover"}`}
    >
      {active && <span className="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-sm bg-[#2564cf]" />}
      <span className="grid w-[18px] place-items-center" style={{ color }}>
        <Icon name={icon} size={17} />
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="text-xs text-ink-2">{count}</span> : null}
    </Link>
  );
}

function ListContainer({
  id, listIds, children,
}: {
  id: string; listIds: string[]; children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: `C:${id}` });
  return (
    <div ref={setNodeRef}>
      <SortableContext items={listIds.map((l) => `L:${l}`)} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

function GroupRow({
  group, open, renaming, onToggle, onMenu, onRename, onCancelRename,
}: {
  group: SidebarGroup;
  open: boolean;
  renaming: boolean;
  onToggle: () => void;
  onMenu: (a: MenuAnchor) => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  const t = useTranslations("nav");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `G:${group.id}`,
    disabled: group.role !== "ADMIN" || renaming,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      className={`group relative flex h-9 items-center gap-3 px-4 text-sm hover:bg-side-hover ${TOUCH_ROW}`}
    >
      <span className="grid w-[18px] place-items-center text-ink-2">
        <Icon name="group" size={17} />
      </span>
      {renaming ? (
        <InlineEdit initial={group.name} onCommit={onRename} onCancel={onCancelRename} />
      ) : (
        <>
          <span className="flex-1 truncate">{group.name}</span>
          {group.isReceived && <Icon name="share" size={14} className="text-ink-2" />}
          <RowMenuButton label={t("rowMenu", { name: group.name })} onOpen={onMenu} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="grid place-items-center text-ink-2"
            title={open ? t("collapse") : t("expand")}
          >
            <Icon name={open ? "chevronUp" : "chevronDown"} size={16} />
          </button>
        </>
      )}
    </div>
  );
}

function ListRow({
  list, inGroup, active, renaming, onMenu, onRename, onCancelRename, onRequestRename, onRequestDelete,
}: {
  list: SidebarList;
  /** 그룹 안의 목록인지. 왼쪽 여백 한 단이 소속을 나타내는 유일한 신호다. */
  inGroup: boolean;
  active: boolean;
  renaming: boolean;
  onMenu: (a: MenuAnchor) => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onRequestRename: () => void;
  onRequestDelete: () => void;
}) {
  const t = useTranslations("nav");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `L:${list.id}`,
    disabled: list.role !== "ADMIN" || renaming,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      tabIndex={0}
      onKeyDown={(e) => {
        if (list.role !== "ADMIN") return;
        if (e.key === "F2") {
          e.preventDefault();
          onRequestRename();
        }
        if (e.key === "Delete") {
          e.preventDefault();
          onRequestDelete();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      className={`group relative flex h-9 items-center gap-3 pr-4 text-sm outline-none focus:bg-side-hover ${
        inGroup ? "pl-[44px]" : "pl-4"
      } ${active ? "bg-side-active" : "hover:bg-side-hover"} ${TOUCH_ROW}`}
    >
      {active && <span className="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-sm bg-[#2564cf]" />}
      <span className="grid w-[18px] shrink-0 place-items-center text-ink-2">
        <Icon name="list" size={17} />
      </span>
      {renaming ? (
        <InlineEdit initial={list.name} onCommit={onRename} onCancel={onCancelRename} />
      ) : (
        <>
          <Link href={`/list/${list.id}`} className="min-w-0 flex-1 truncate" draggable={false}>
            {list.name}
          </Link>
          {list.isShared && <Icon name="share" size={14} className="shrink-0 text-[#4f52b2]" />}
          {list.openTaskCount > 0 && <span className="shrink-0 text-xs text-ink-2">{list.openTaskCount}</span>}
          <RowMenuButton label={t("rowMenu", { name: list.name })} onOpen={onMenu} />
        </>
      )}
    </div>
  );
}

/** 사이드바 검색. 번호를 넣으면 결과 맨 위에 "바로 이동"이 뜬다. */
function SearchBox() {
  const t = useTranslations("nav.search");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) return; // 지우는 순간은 입력 핸들러가 결과를 비운다
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ac.signal });
        if (res.ok) setResult((await res.json()) as SearchResult);
      } catch {
        /* 입력이 바뀌어 취소된 요청은 무시한다 */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    router.push(`/list/${hit.listId}?task=${hit.id}`);
  }

  const rows: { hit: SearchHit; jump: boolean }[] = [
    ...(result?.jump ? [{ hit: result.jump, jump: true }] : []),
    ...(result?.hits ?? []).map((hit) => ({ hit, jump: false })),
  ];

  return (
    <div className="relative mx-4 mb-2.5">
      <div className="flex h-8 items-center gap-2 rounded border border-[#d6d4d2] bg-white px-2.5 text-[13px]">
        <input
          value={q}
          placeholder={t("placeholder")}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value.trim()) setResult(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && rows[0]) go(rows[0].hit);
          }}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
        />
        {q ? (
          <button onClick={() => { setQ(""); setResult(null); }} aria-label={t("clear")} className="text-ink-2">
            <Icon name="x" size={14} />
          </button>
        ) : (
          <Icon name="search" size={16} className="text-ink-3" />
        )}
      </div>

      {open && q.trim() && (
        <div className="thin-scroll absolute left-0 right-0 top-9 z-30 max-h-[420px] overflow-y-auto rounded border border-[#e1dfdd] bg-white py-1 shadow-[0_6.4px_14.4px_rgba(0,0,0,.132)]">
          {rows.length === 0 && <p className="px-3 py-2.5 text-[13px] text-ink-3">{t("empty")}</p>}
          {rows.map(({ hit, jump }, i) => (
            <div key={hit.id}>
              {i === 0 && jump && <p className="px-3 pb-1 pt-1.5 text-[11px] text-ink-3">{t("jump")}</p>}
              {i === (result?.jump ? 1 : 0) && rows.length > (result?.jump ? 1 : 0) && (
                <p className="px-3 pb-1 pt-1.5 text-[11px] text-ink-3">{t("results")}</p>
              )}
              <button
                onClick={() => go(hit)}
                className={`flex w-full items-start gap-2.5 px-3 py-2 text-left text-[13px] ${
                  jump ? "bg-[#eff6fc]" : "hover:bg-side-hover"
                }`}
              >
                <span className={`mt-0.5 shrink-0 ${jump ? "text-link" : "text-ink-2"}`}>
                  <Icon name={jump ? "jump" : hit.isCompleted ? "check" : "circle"} size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate">
                    {jump && <span className="font-mono font-semibold text-link">#{hit.seq} </span>}
                    {jump ? t("goTo", { title: hit.title }) : hit.title}
                  </span>
                  <span className="block truncate text-[11px] text-ink-2">{hit.listName}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ctrl+G — 일련번호로 바로 이동 */
function JumpDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("nav.jump");
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-[380px] max-w-[calc(100vw-24px)] rounded-lg bg-white p-5 shadow-[0_25.6px_57.6px_rgba(0,0,0,.22)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">{t("title")}</h3>
        <p className="mt-1 text-xs text-ink-2">{t("hint")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = ref.current?.value.replace(/[^0-9]/g, "");
            if (!n) return;
            onClose();
            router.push(`/t/${n}`);
          }}
          className="mt-4 flex gap-2"
        >
          <input
            ref={ref}
            inputMode="numeric"
            placeholder="1042"
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="h-9 flex-1 rounded border border-[#8a8886] px-2.5 font-mono text-sm outline-none focus:border-link focus:shadow-[0_0_0_1px_#2564cf]"
          />
          <button className="h-9 rounded bg-link px-4 text-sm text-white">{t("go")}</button>
        </form>
      </div>
    </div>
  );
}

/**
 * 공유받은 그룹 한 줄. 내 그룹처럼 접고 펴며(이 컴퓨터에 기억, 내 그룹과 같은 저장소)
 * 주인 이름을 오른쪽에 작게 붙인다. 내 것이 아니라 옮기기·이름 바꾸기·지우기는 없다.
 */
function SharedGroupRow({
  group,
  open,
  onToggle,
}: {
  group: SidebarData["sharedTree"]["groups"][number];
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("nav");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? t("collapse") : t("expand")}
      className="relative flex h-9 w-full items-center gap-3 px-4 text-left text-sm hover:bg-side-hover"
    >
      <span className="grid w-[18px] shrink-0 place-items-center text-ink-2">
        <Icon name="group" size={17} />
      </span>
      <span className="min-w-0 flex-1 truncate">{group.name}</span>
      <span className="shrink-0 text-[11.5px] text-ink-3">{group.ownerName}</span>
      <span className="grid shrink-0 place-items-center text-ink-2">
        <Icon name={open ? "chevronUp" : "chevronDown"} size={16} />
      </span>
    </button>
  );
}

/**
 * 공유받은 목록 한 줄. 내 목록과 달리 끌어 옮길 수 없다.
 *
 * 예전에는 두 줄(목록 / 주인 · 그룹)에 가나다순이라 같은 그룹의 목록이 흩어졌다(2026-09-14 요청).
 * 이제 주인의 그룹 아래에 모이므로(SharedGroupRow) 한 줄로 두고, 그룹 밖 목록에만 주인 이름을
 * 오른쪽에 작게 붙인다. 읽기 전용은 자물쇠로 알린다.
 */
function SharedListRow({
  list,
  inGroup,
  active,
  onMenu,
}: {
  list: SidebarList;
  /** 공유받은 그룹 안의 목록인지. 그러면 한 단 들여 쓰고 주인 이름은 그룹 줄에만 둔다. */
  inGroup: boolean;
  active: boolean;
  onMenu: (a: MenuAnchor) => void;
}) {
  const t = useTranslations("nav");
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      className={`group relative flex h-9 items-center gap-3 pr-4 text-sm ${inGroup ? "pl-[44px]" : "pl-4"} ${
        active ? "bg-side-active" : "hover:bg-side-hover"
      } ${TOUCH_ROW}`}
    >
      {active && <span className="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-sm bg-[#2564cf]" />}
      <span className="grid w-[18px] shrink-0 place-items-center text-ink-2">
        <Icon name="list" size={17} />
      </span>
      <Link href={`/list/${list.id}`} className="min-w-0 flex-1 truncate" draggable={false}>
        {list.name}
      </Link>
      {!inGroup && list.ownerName && <span className="shrink-0 text-[11.5px] text-ink-3">{list.ownerName}</span>}
      {list.role === "VIEWER" && (
        <span title={t("readOnly")} aria-label={t("readOnly")} className="grid shrink-0 place-items-center text-ink-3">
          <Icon name="lock" size={13} />
        </span>
      )}
      {list.openTaskCount > 0 && <span className="shrink-0 text-xs text-ink-2">{list.openTaskCount}</span>}
      <RowMenuButton label={t("rowMenu", { name: list.name })} onOpen={onMenu} />
    </div>
  );
}

function InlineEdit({
  initial, onCommit, onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.currentTarget.value.trim() || initial)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(e.currentTarget.value.trim() || initial);
        if (e.key === "Escape") onCancel();
      }}
      className="min-w-0 flex-1 rounded border border-[#2564cf] bg-white px-1.5 py-0.5 text-sm outline-none"
    />
  );
}

function NewItemInput({
  placeholder, indent, onCommit, onCancel,
}: {
  placeholder: string;
  indent?: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commitOrCancel = (raw: string) => {
    const v = raw.trim();
    if (v) onCommit(v);
    else onCancel();
  };

  return (
    <div className={`flex h-9 items-center gap-3 pr-4 ${indent ? "pl-[44px]" : "pl-4"}`}>
      <span className="grid w-[18px] shrink-0 place-items-center text-ink-2">
        <Icon name="list" size={17} />
      </span>
      <input
        ref={ref}
        placeholder={placeholder}
        onBlur={(e) => commitOrCancel(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitOrCancel(e.currentTarget.value);
          if (e.key === "Escape") onCancel();
        }}
        className="min-w-0 flex-1 rounded border border-[#2564cf] bg-white px-1.5 py-0.5 text-sm outline-none"
      />
    </div>
  );
}
