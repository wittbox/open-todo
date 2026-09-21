"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { NewProjectDialog } from "@/components/project/NewProjectDialog";

export function NewProjectButton() {
  const t = useTranslations("projects");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-[30px] items-center gap-1.5 rounded bg-link px-3 text-[13px] text-white hover:brightness-95"
      >
        <Icon name="plus" size={14} />
        {t("newProject")}
      </button>
      {open && <NewProjectDialog onClose={() => setOpen(false)} />}
    </>
  );
}
