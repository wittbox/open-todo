"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { ProjectMembersDialog } from "@/components/project/ProjectMembersDialog";
import { ProjectSettingsDialog } from "@/components/project/ProjectSettingsDialog";
import type { ProjectView } from "@/lib/queries/project";

type Member = Extract<ProjectView, { kind: "member" }>;

/**
 * 프로젝트 머리글 — 이름·목적·멤버·설정, 그리고 이슈를 켠 프로젝트면 [메시지 | 이슈] 탭.
 * 메시지 화면(ProjectView)과 이슈 화면(IssuesView)이 함께 쓴다.
 */
export function ProjectHeader({ project, tab }: { project: Member; tab: "messages" | "issues" }) {
  const router = useRouter();
  const t = useTranslations("projects");
  const ti = useTranslations("issues");
  const [dialog, setDialog] = useState<null | "members" | "settings">(null);
  const readOnly = project.archivedAt != null;
  const tabCls = (on: boolean) =>
    `inline-flex items-center gap-1.5 px-0.5 pb-2 pt-1 text-[13.5px] ${
      on ? "font-semibold text-ink shadow-[inset_0_-2px_0_#2564cf]" : "text-ink-2 hover:text-ink"
    }`;

  return (
    <>
      <header className="border-b border-[#e1dfdd] bg-white px-4 pt-2.5 md:px-6 md:pt-3.5">
        <div className={`flex items-center gap-2.5 ${project.issues.enabled ? "pb-1.5" : "pb-2.5 md:pb-3.5"}`}>
          <Icon name={project.isPublic ? "hash" : "lock"} size={18} className="shrink-0 text-ink-2" />
          <h1 className="truncate text-[18px] font-semibold md:text-[20px]">{project.name}</h1>
          {/* 폰에서는 목적을 뺀다 — 한 줄에 이름·멤버·설정이 겨우 들어간다. */}
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
            <span className="hidden md:inline">{project.purpose}</span>
          </span>
          {readOnly && <span className="rounded-full bg-[#fff4ce] px-2 py-0.5 text-[11px] text-[#7a5a00]">{t("header.archived")}</span>}
          <button
            type="button"
            onClick={() => setDialog("members")}
            className="inline-flex h-7 items-center gap-1.5 rounded border border-[#e1dfdd] px-2.5 text-[12.5px] text-ink-2 hover:bg-side-hover"
          >
            <Icon name="person" size={14} />
            {t("header.members", { count: project.members.length })}
          </button>
          {project.myRole === "ADMIN" && (
            <button
              type="button"
              onClick={() => setDialog("settings")}
              aria-label={t("settings.title")}
              className="grid h-7 w-7 place-items-center rounded border border-[#e1dfdd] text-ink-2 hover:bg-side-hover"
            >
              <Icon name="gear" size={15} />
            </button>
          )}
        </div>
        {project.issues.enabled && (
          <nav aria-label={ti("tabs.nav")} className="flex gap-5">
            <Link href={`/projects/${project.id}`} className={tabCls(tab === "messages")} aria-current={tab === "messages" ? "page" : undefined}>
              {ti("tabs.messages")}
            </Link>
            <Link
              href={`/projects/${project.id}?tab=issues`}
              className={tabCls(tab === "issues")}
              aria-current={tab === "issues" ? "page" : undefined}
            >
              {ti("tabs.issues")}
              {project.openIssueCount > 0 && (
                <span className="rounded-full bg-pane-bg px-1.5 text-[11.5px] font-normal text-ink-2">{project.openIssueCount}</span>
              )}
            </Link>
          </nav>
        )}
      </header>

      {dialog === "members" && (
        <ProjectMembersDialog
          projectId={project.id}
          members={project.members}
          myRole={project.myRole}
          isOwner={project.isOwner}
          readOnly={readOnly}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
      {dialog === "settings" && (
        <ProjectSettingsDialog
          project={project}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
