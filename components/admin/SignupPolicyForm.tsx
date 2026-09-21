"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { SignupPolicy } from "@/app/generated/prisma/enums";
import { setSignupPolicy } from "@/lib/actions/admin";
import { runAction } from "@/lib/actions/session-guard";
import { Banner, Hint, PRIMARY } from "@/components/admin/ui";

const POLICIES: SignupPolicy[] = ["INVITE_ONLY", "DOMAIN", "OPEN"];

export function SignupPolicyForm({ policy, domains }: { policy: SignupPolicy; domains: string[] }) {
  const t = useTranslations("admin.signup");
  const [choice, setChoice] = useState<SignupPolicy>(policy);
  const [text, setText] = useState(domains.join(", "));
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setState({});
        start(async () => {
          const res = await runAction(() => setSignupPolicy(choice, text));
          setState(res.ok ? { saved: true } : { error: res.error });
        });
      }}
    >
      <p className="mb-2 text-[12.5px] text-ink-2">{t("lead")}</p>
      {POLICIES.map((p) => (
        <label key={p} className="flex items-start gap-2 py-1.5 text-sm">
          <input type="radio" name="policy" className="mt-1" checked={choice === p} onChange={() => setChoice(p)} />
          <span>
            {t(p)}
            <span className="block text-xs text-ink-2">{t(`${p}_hint`)}</span>
          </span>
        </label>
      ))}

      {choice === "DOMAIN" && (
        <div className="mt-2 pl-6">
          <label htmlFor="domains" className="mb-1 block text-xs text-ink-2">
            {t("domains")}
          </label>
          <input
            id="domains"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="example.com, team.example.com"
            className="h-9 w-full max-w-[420px] rounded border border-[#c8c6c4] px-2.5 text-sm outline-none focus:border-link"
          />
          <Hint>{t("domainsHint")}</Hint>
        </div>
      )}

      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.saved && <Banner>{t("saved")}</Banner>}
      <button type="submit" disabled={pending} className={`mt-4 ${PRIMARY}`}>
        {t("save")}
      </button>
    </form>
  );
}
