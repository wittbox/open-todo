"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { PRIMARY_CLASS } from "@/components/project/Dialog";
import { joinProject } from "@/lib/actions/project";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";

/** 공개 프로젝트를 멤버가 아닌 사람이 열었을 때. 이름·목적·멤버 수만 보이고 참여해야 대화가 보인다. */
export function JoinPane({ project }: { project: { id: string; name: string; purpose: string; memberCount: number } }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <main className="grid flex-1 place-items-center bg-pane-bg px-6">
      <div className="w-full max-w-md rounded-lg border border-side-border bg-white p-7 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#eff4fc] text-link">
          <Icon name="hash" size={22} />
        </div>
        <h1 className="text-lg font-semibold">{project.name}</h1>
        {project.purpose && <p className="mt-1 text-sm text-ink-2">{project.purpose}</p>}
        <p className="mt-3 text-xs text-ink-3">{t("join.summary", { count: project.memberCount })}</p>
        <p className="mt-4 text-sm leading-relaxed text-ink-2">{t("join.intro")}</p>
        {error && <p className="mt-3 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await runAction(() => joinProject(project.id));
              if (!res.ok) {
                if (!handledAuthFailure(res)) setError(res.error);
                return;
              }
              router.refresh();
            })
          }
          className={`${PRIMARY_CLASS} mt-5 !h-9`}
        >
          {t("join.action")}
        </button>
      </div>
    </main>
  );
}
