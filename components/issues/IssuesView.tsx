"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTimeZone, useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { ProjectHeader } from "@/components/project/ProjectHeader";
import { NewIssueDialog } from "@/components/issues/NewIssueDialog";
import { IssueBoard } from "@/components/issues/IssueBoard";
import { useIssueRefresh } from "@/components/issues/useIssueRefresh";
import { updateIssueAction } from "@/lib/actions/issue";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import { Face, LabelChip, PriorityMark, StatusPill } from "@/components/issues/IssueBits";
import { countByState, filterIssues, PRIORITIES, type IssueFilter } from "@/lib/issues/format";
import { relativeShort, type Translate } from "@/lib/projects/format";
import type { IssueItem } from "@/lib/queries/issues";
import type { ProjectView } from "@/lib/queries/project";
import type { IssuePriority, IssueStatus } from "@/app/generated/prisma/enums";

const VIEW_KEY = "todo.issueView";
const FILTER_KEY = "todo.issueFilter";

type Member = Extract<ProjectView, { kind: "member" }>;

/**
 * 프로젝트의 이슈 목록.
 *
 * 이슈를 통째로 받아 여기서 거르고 정렬한다(filterIssues). 거르기 상태는 화면에만 둔다 —
 * 이슈를 눌러 오른쪽 창이 열려도 이 컴포넌트는 그대로라 필터가 유지된다.
 */
export function IssuesView({
  project,
  issues,
  meId,
  stamp,
}: {
  project: Member;
  issues: IssueItem[];
  meId: string;
  /** 서버가 이 화면을 그릴 때의 '바뀜 표시' — 자동 새로고침이 비교한다 */
  stamp: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("issues");
  const tp = useTranslations("projects") as unknown as Translate;
  const tz = useTimeZone();
  const readOnly = project.archivedAt != null;
  useIssueRefresh(project.id, stamp);
  const [filter, setFilter] = useState<IssueFilter>({ state: "open" });
  // 거르기는 이 탭이 열려 있는 동안 기억한다 — 이슈 페이지에 들어갔다 '← 이슈 목록' 으로 돌아와도 그대로.
  const filterKey = `${FILTER_KEY}.${project.id}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(filterKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에만 있는 값을 처음 한 번 읽는다
      if (saved) setFilter(JSON.parse(saved) as IssueFilter);
    } catch {}
  }, [filterKey]);
  useEffect(() => {
    try {
      sessionStorage.setItem(filterKey, JSON.stringify(filter));
    } catch {}
  }, [filterKey, filter]);
  const [creating, setCreating] = useState(false);
  // 목록 ↔ 보드. 사람마다 손에 익은 쪽이 달라 브라우저에 기억해 둔다(처음 그릴 때는 목록 — 서버와 같게).
  const [view, setView] = useState<"list" | "board">("list");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에만 있는 값을 처음 한 번 읽는다
      if (localStorage.getItem(VIEW_KEY) === "board") setView("board");
    } catch {}
  }, []);
  const chooseView = (v: "list" | "board") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  // 보드에서 끌어 놓은 상태는 서버가 다시 그릴 때까지 화면이 먼저 들고 있는다.
  const [moved, setMoved] = useState<Map<string, IssueStatus>>(new Map());
  const [syncedWith, setSyncedWith] = useState(issues);
  if (syncedWith !== issues) {
    setSyncedWith(issues);
    setMoved(new Map());
  }
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const shown = useMemo(
    () => issues.map((i) => (moved.has(i.id) ? { ...i, status: moved.get(i.id)! } : i)),
    [issues, moved],
  );

  function move(issue: IssueItem, to: IssueStatus) {
    setMoved((m) => new Map(m).set(issue.id, to));
    startTransition(async () => {
      const res = await runAction(() => updateIssueAction(issue.id, { status: to }));
      if (!res.ok) {
        setMoved((m) => {
          const n = new Map(m);
          n.delete(issue.id);
          return n;
        });
        if (!handledAuthFailure(res)) setError(res.error);
      }
      router.refresh();
    });
  }
  const labels = useMemo(() => new Map(project.issues.labels.map((l) => [l.id, l])), [project.issues.labels]);
  const key = project.issues.key;

  const counts = countByState(shown);
  const rows = useMemo(
    () =>
      filterIssues(
        shown,
        // 보드는 상태가 칸이라 상태 거르기를 쓰지 않는다.
        {
          ...filter,
          state: view === "board" ? "all" : filter.state,
          assignee: filter.assignee === "me" ? meId : filter.assignee,
        },
        key,
      ),
    [shown, filter, meId, key, view],
  );

  // 이슈는 페이지로 들어간다(오른쪽 창이 아니라) — 돌아오기는 브라우저 뒤로 또는 '← 이슈 목록'.
  function open(number: number) {
    router.push(`${pathname}?tab=issues&issue=${number}`);
  }

  const select = "h-7 rounded border border-[#e1dfdd] bg-white px-1.5 text-[12.5px] text-ink-2";
  const seg = (on: boolean) =>
    `px-2.5 py-0.5 ${on ? "bg-[#eff6fc] font-semibold text-link" : "text-ink-2 hover:bg-side-hover"}`;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <ProjectHeader project={project} tab="issues" />

      <div className="flex flex-wrap items-center gap-2 border-b border-[#edebe9] px-4 py-2 md:px-6">
        {view === "list" && (
          <span
            className="inline-flex overflow-hidden rounded border border-[#e1dfdd] text-[12.5px]"
            role="group"
            aria-label={t("list.stateGroup")}
          >
            <button
              type="button"
              aria-pressed={filter.state === "open"}
              onClick={() => setFilter({ ...filter, state: "open" })}
              className={seg(filter.state === "open")}
            >
              {t("list.open", { count: counts.open })}
            </button>
            <button
              type="button"
              aria-pressed={filter.state === "closed"}
              onClick={() => setFilter({ ...filter, state: "closed" })}
              className={seg(filter.state === "closed")}
            >
              {t("list.closed", { count: counts.closed })}
            </button>
            <button
              type="button"
              aria-pressed={filter.state === "all"}
              onClick={() => setFilter({ ...filter, state: "all" })}
              className={seg(filter.state === "all")}
            >
              {t("list.all")}
            </button>
          </span>
        )}
        <select
          aria-label={t("list.assignee")}
          value={filter.assignee ?? ""}
          onChange={(e) => setFilter({ ...filter, assignee: e.target.value || null })}
          className={select}
        >
          <option value="">{t("list.assigneeAll")}</option>
          <option value="me">{t("list.me")}</option>
          <option value="none">{t("list.none")}</option>
          {project.members
            .filter((m) => !m.isMe)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
        </select>
        {project.issues.labels.length > 0 && (
          <select
            aria-label={t("list.labels")}
            value={filter.labelId ?? ""}
            onChange={(e) => setFilter({ ...filter, labelId: e.target.value || null })}
            className={select}
          >
            <option value="">{t("list.labelAll")}</option>
            {project.issues.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label={t("list.priority")}
          value={filter.priority ?? ""}
          onChange={(e) =>
            setFilter({
              ...filter,
              priority: (e.target.value || null) as IssuePriority | null,
            })
          }
          className={select}
        >
          <option value="">{t("list.priorityAll")}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </select>
        <label className="inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded border border-[#e1dfdd] px-2 text-[12.5px] sm:max-w-[240px]">
          <Icon name="search" size={13} className="text-ink-3" />
          <input
            value={filter.q ?? ""}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder={t("list.searchPlaceholder", { key: key ?? "" })}
            aria-label={t("list.search")}
            className="min-w-0 flex-1 outline-none"
          />
        </label>
        <span
          className="inline-flex overflow-hidden rounded border border-[#e1dfdd] text-[12.5px]"
          role="group"
          aria-label={t("list.viewGroup")}
        >
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => chooseView("list")}
            className={seg(view === "list")}
          >
            {t("list.viewList")}
          </button>
          <button
            type="button"
            aria-pressed={view === "board"}
            onClick={() => chooseView("board")}
            className={seg(view === "board")}
          >
            {t("list.viewBoard")}
          </button>
        </span>
        <button
          type="button"
          disabled={readOnly || !project.issues.enabled}
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded bg-link px-3 text-[12.5px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
        >
          <Icon name="plus" size={13} />
          {t("list.new")}
        </button>
      </div>

      {error && <p className="mx-4 mt-2 rounded bg-[#fdf3f4] px-3 py-1.5 text-xs text-danger md:mx-6">{error}</p>}

      {view === "board" ? (
        <IssueBoard issues={rows} labels={labels} selected={null} readOnly={readOnly} onOpen={open} onMove={move} />
      ) : (
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto" role="list" aria-label={t("list.label")}>
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              role="listitem"
              data-issue={r.number}
              onClick={() => open(r.number)}
              className={`grid w-full grid-cols-[70px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-[#edebe9] px-4 py-2.5 text-left md:grid-cols-[84px_minmax(0,1fr)_72px_120px_44px_88px] md:px-6 hover:bg-side-hover`}
            >
              <span className="font-mono text-[12.5px] text-ink-2">{r.ref}</span>
              <span className="min-w-0">
                <span className={`block truncate text-[13.5px] ${r.status === "CLOSED" ? "text-ink-2" : ""}`}>
                  {r.title}
                </span>
                <span className="flex flex-wrap items-center gap-1 text-[11.5px] text-ink-3">
                  {r.labelIds.map((id) => {
                    const l = labels.get(id);
                    return l ? <LabelChip key={id} name={l.name} color={l.color} /> : null;
                  })}
                  <span>
                    {t("list.reported", {
                      name: r.reporter?.name ?? t("pane.unknown"),
                      when: relativeShort(r.updatedAt, new Date(), tz, tp),
                    })}
                  </span>
                </span>
              </span>
              <span className="hidden md:block">
                <PriorityMark priority={r.priority} />
              </span>
              <span className="hidden min-w-0 items-center gap-1.5 text-[12.5px] md:flex">
                {r.assignee ? (
                  <>
                    <Face name={r.assignee.name} color={r.assignee.avatarColor} />
                    <span className="truncate">{r.assignee.name}</span>
                  </>
                ) : (
                  <span className="text-ink-3">{t("list.none")}</span>
                )}
              </span>
              <span className="hidden text-[12px] text-ink-2 md:block">
                {r.commentCount > 0 ? `💬 ${r.commentCount}` : ""}
              </span>
              <span className="justify-self-end">
                <StatusPill status={r.status} />
              </span>
            </button>
          ))}
          {rows.length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-ink-3">
              {issues.length === 0
                ? t("list.emptyNone")
                : t("list.emptyFiltered")}
            </p>
          )}
        </div>
      )}

      {creating && (
        <NewIssueDialog
          projectId={project.id}
          projectName={project.name}
          template={project.issues.template}
          labels={project.issues.labels}
          members={project.members}
          onClose={() => setCreating(false)}
          onCreated={(number) => {
            setCreating(false);
            setFilter((f) => ({ ...f, state: "open" }));
            open(number);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
