"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import clsx from "clsx";
import { LOCALE_NAMES, LOCALES } from "@/i18n/locales";
import { setLocaleAction } from "@/lib/actions/auth";

/** 화면 언어 고르기 — 로그인 전 화면 오른쪽 위. */
export function LanguageSwitch() {
  const current = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-1.5 text-xs text-ink-2" aria-busy={pending}>
      {LOCALES.map((l, i) => (
        <span key={l} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          <button
            type="button"
            lang={l}
            aria-pressed={l === current}
            disabled={pending || l === current}
            onClick={() =>
              start(async () => {
                await setLocaleAction(l);
                router.refresh();
              })
            }
            className={clsx("rounded px-1 py-0.5", l === current ? "font-semibold text-ink" : "hover:bg-side-hover")}
          >
            {LOCALE_NAMES[l]}
          </button>
        </span>
      ))}
    </div>
  );
}
