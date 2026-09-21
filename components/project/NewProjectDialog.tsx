"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BTN_CLASS, Dialog, INPUT_CLASS, PRIMARY_CLASS } from "@/components/project/Dialog";
import { createProject } from "@/lib/actions/project";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";

/** 새 프로젝트. 만든 사람이 소유자가 되고, 만들자마자 그 프로젝트로 간다. */
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim() || pending) return;
    startTransition(async () => {
      const res = await runAction(() => createProject({ name, purpose, isPublic }));
      if (!res.ok) {
        if (!handledAuthFailure(res)) setError(res.error);
        return;
      }
      onClose();
      router.push(`/projects/${res.data.id}`);
    });
  }

  return (
    <Dialog title={t("newProject")} width={440} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block text-xs text-ink-2">{t("new.name")}</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("new.namePlaceholder")}
          maxLength={100}
          className={`${INPUT_CLASS} mt-1`}
        />
        <label className="mt-3 block text-xs text-ink-2">{t("new.purpose")}</label>
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder={t("new.purposePlaceholder")}
          maxLength={500}
          className={`${INPUT_CLASS} mt-1`}
        />
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
        {error && <p className="mt-3 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_CLASS}>
            {t("cancel")}
          </button>
          <button type="submit" disabled={!name.trim() || pending} className={PRIMARY_CLASS}>
            {t("new.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
