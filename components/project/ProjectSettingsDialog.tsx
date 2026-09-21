"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BTN_CLASS, Dialog, INPUT_CLASS, PRIMARY_CLASS } from "@/components/project/Dialog";
import { deleteProject, setProjectArchived, transferOwnership, updateProject } from "@/lib/actions/project";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ProjectView } from "@/lib/queries/project";

type Member = Extract<ProjectView, { kind: "member" }>;

/** 프로젝트 설정. 이름·목적·공개 범위는 관리자, 소유권·보관·삭제는 소유자만. */
export function ProjectSettingsDialog({ project, onClose }: { project: Member; onClose: () => void }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [purpose, setPurpose] = useState(project.purpose);
  const [isPublic, setIsPublic] = useState(project.isPublic);
  const [newOwner, setNewOwner] = useState(project.ownerId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const archived = project.archivedAt != null;

  function act(fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string; code: "unauthenticated" | "forbidden" | "unknown" }>, then?: () => void) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok) {
        if (!handledAuthFailure(res)) setError(res.error);
        return;
      }
      then?.();
    });
  }

  function save() {
    act(() => updateProject(project.id, { name, purpose, isPublic }), onClose);
  }

  return (
    <Dialog title={t("settings.title")} onClose={onClose}>
      <label className="block text-xs text-ink-2">{t("settings.name")}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={`${INPUT_CLASS} mt-1`} />
      <label className="mt-3 block text-xs text-ink-2">{t("settings.purpose")}</label>
      <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} className={`${INPUT_CLASS} mt-1`} />
      <div className="mt-3 text-xs text-ink-2">{t("visibility.label")}</div>
      <div className="mt-1 flex gap-4 text-sm">
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="vis" checked={isPublic} onChange={() => setIsPublic(true)} />
          {t("visibility.public")}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="vis" checked={!isPublic} onChange={() => setIsPublic(false)} />
          {t("visibility.private")}
        </label>
      </div>

      {project.isOwner && (
        <>
          <label className="mt-4 block text-xs text-ink-2">{t("settings.owner")}</label>
          <div className="mt-1 flex gap-2">
            <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="h-[34px] flex-1 rounded border border-[#8a8886] bg-white px-2 text-sm">
              {project.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.isOwner ? t("settings.ownerOption", { name: m.name }) : m.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={newOwner === project.ownerId || pending}
              onClick={() => {
                const who = project.members.find((m) => m.userId === newOwner)?.name ?? "";
                if (window.confirm(t("settings.confirmTransfer", { name: who }))) act(() => transferOwnership(project.id, newOwner), onClose);
              }}
              className={BTN_CLASS}
            >
              {t("settings.transfer")}
            </button>
          </div>

          <div className="mt-4 rounded border border-[#f0d3d4] px-3 py-2.5 text-[12.5px]">
            <b className="block text-danger">{archived ? t("settings.unarchive") : t("settings.archive")}</b>
            {archived ? t("settings.unarchiveHint") : t("settings.archiveHint")}
            <button type="button" disabled={pending} onClick={() => act(() => setProjectArchived(project.id, !archived), onClose)} className={`${BTN_CLASS} ml-2 !h-7 text-xs`}>
              {archived ? t("settings.unarchive") : t("settings.archiveAction")}
            </button>
          </div>
          <div className="mt-2 rounded border border-[#f0d3d4] px-3 py-2.5 text-[12.5px]">
            <b className="block text-danger">{t("settings.delete")}</b>
            {t("settings.deleteHint")}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(t("settings.confirmDelete", { name: project.name }))) {
                  act(() => deleteProject(project.id), () => router.push("/projects"));
                }
              }}
              className={`${BTN_CLASS} ml-2 !h-7 border-[#e0b4b6] text-xs text-danger`}
            >
              {t("settings.deleteAction")}
            </button>
          </div>
        </>
      )}

      {error && <p className="mt-3 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN_CLASS}>
          {t("cancel")}
        </button>
        <button type="button" onClick={save} disabled={!name.trim() || pending} className={PRIMARY_CLASS}>
          {t("save")}
        </button>
      </div>
    </Dialog>
  );
}
