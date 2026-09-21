"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { APP_NAME_MAX } from "@/lib/brand";
import { setAppName } from "@/lib/actions/admin";
import { runAction } from "@/lib/actions/session-guard";
import { Banner, Hint, PRIMARY } from "@/components/admin/ui";

/** 이 설치의 이름. 비우면 `.env` 의 APP_NAME, 그것도 없으면 기본 이름으로 돌아간다. */
export function InstallNameForm({ name, fallback }: { name: string; fallback: string }) {
  const t = useTranslations("admin.instance");
  const [text, setText] = useState(name);
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setState({});
        start(async () => {
          const res = await runAction(() => setAppName(text));
          setState(res.ok ? { saved: true } : { error: res.error });
        });
      }}
    >
      <label htmlFor="app-name" className="mb-1 block text-xs text-ink-2">
        {t("name")}
      </label>
      <input
        id="app-name"
        value={text}
        maxLength={APP_NAME_MAX}
        placeholder={fallback}
        onChange={(e) => setText(e.target.value)}
        className="h-9 w-full max-w-[320px] rounded border border-[#c8c6c4] px-2.5 text-sm outline-none focus:border-link"
      />
      <Hint>{t("nameHint", { fallback })}</Hint>
      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.saved && <Banner>{t("nameSaved")}</Banner>}
      <button type="submit" disabled={pending} className={`mt-3 ${PRIMARY}`}>
        {t("nameSave")}
      </button>
    </form>
  );
}
