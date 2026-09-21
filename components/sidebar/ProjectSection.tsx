"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { NewProjectDialog } from "@/components/project/NewProjectDialog";
import { usePoll } from "@/components/project/usePoll";
import type { SidebarProject } from "@/lib/queries/project";

/**
 * 사이드바 '프로젝트' 영역 — 스마트 뷰 바로 아래.
 *
 * 안 읽음 수는 서버가 그린 값으로 시작하고, 열린 프로젝트 화면의 폴링이 보내는
 * `todo:project-unread` 이벤트로 그 자리에서 고친다(화면을 옮기지 않아도 배지가 맞는다).
 */
export function ProjectSection({
  projects,
  activeKey,
  collapsed,
  onToggle,
}: {
  projects: SidebarProject[];
  activeKey: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("projects");
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onUnread = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, number>>).detail;
      if (detail) setUnread((prev) => ({ ...prev, ...detail }));
    };
    window.addEventListener("todo:project-unread", onUnread);
    return () => window.removeEventListener("todo:project-unread", onUnread);
  }, []);

  // 서버 값이 새로 오면(화면 이동) 그것이 기준이다. 렌더 도중 되돌린다 — Sidebar 의 layout 동기화와 같은 방식.
  const [syncedWith, setSyncedWith] = useState(projects);
  if (syncedWith !== projects) {
    setSyncedWith(projects);
    setUnread({});
  }

  // 프로젝트 화면 밖에 있을 때도 배지가 움직이게 30초마다 묻는다. 프로젝트 화면 안에서는
  // 메시지 폴링이 같은 값을 이벤트로 주므로 두 길이 겹쳐도 같은 답이다.
  usePoll(
    async () => {
      const res = await fetch("/api/projects/unread", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, number>;
      setUnread(Object.fromEntries(projects.map((p) => [p.id, data[p.id] ?? 0])));
    },
    30_000,
    projects.length > 0,
  );

  return (
    <div>
      <div className="flex items-center gap-2 px-4 pb-0.5 pt-2 text-[11px] text-ink-3">
        <Icon name="hash" size={13} />
        <span>{t("title")}</span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setCreating(true)} title={t("newProject")} aria-label={t("newProject")} className="grid h-5 w-5 place-items-center rounded text-ink-2 hover:bg-side-hover pointer-coarse:h-9 pointer-coarse:w-9">
            <Icon name="plus" size={14} />
          </button>
          <button type="button" onClick={onToggle} title={collapsed ? t("expand") : t("collapse")} aria-label={collapsed ? t("expandProjects") : t("collapseProjects")} className="grid h-5 w-5 place-items-center rounded text-ink-2 hover:bg-side-hover pointer-coarse:h-9 pointer-coarse:w-9">
            <Icon name={collapsed ? "chevronDown" : "chevronUp"} size={14} />
          </button>
        </span>
      </div>

      {!collapsed && (
        <>
          {projects.map((p) => {
            const n = unread[p.id] ?? p.unread;
            const active = activeKey === `project:${p.id}`;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className={`relative flex h-9 items-center gap-3 px-4 text-sm pointer-coarse:h-11 ${active ? "bg-side-active" : "hover:bg-side-hover"} ${n > 0 ? "font-semibold" : ""}`}
              >
                {active && <span className="absolute left-0 top-[7px] bottom-[7px] w-[3px] rounded-sm bg-[#2564cf]" />}
                <span className="grid w-[18px] place-items-center text-ink-2">
                  <Icon name={p.isPublic ? "hash" : "lock"} size={16} />
                </span>
                <span className="flex-1 truncate">{p.name}</span>
                {n > 0 && (
                  <span className="min-w-[18px] rounded-full bg-[#c2185b] px-1.5 text-center text-[11px] font-semibold text-white">{n}</span>
                )}
              </Link>
            );
          })}
          <Link
            href="/projects"
            className={`flex h-8 items-center gap-3 px-4 pl-[46px] text-[12.5px] text-link ${activeKey === "projects" ? "bg-side-active" : "hover:bg-side-hover"}`}
          >
            {t("allProjects")}
          </Link>
        </>
      )}

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
