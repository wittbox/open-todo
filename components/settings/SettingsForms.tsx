"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { AuthProvider } from "@/app/generated/prisma/enums";
import { changePassword, saveProfile, signOutEverywhere, unlinkProvider } from "@/lib/actions/settings";
import { runAction } from "@/lib/actions/session-guard";
import { LOCALE_NAMES, LOCALES } from "@/i18n/locales";
import { PROVIDER_LABEL, SLUG } from "@/lib/auth/oauth/config";
import { Banner, BUTTON, FIELD, Hint, PRIMARY } from "@/components/admin/ui";
import { ProviderLogo } from "@/components/auth/ProviderButtons";

/* ── 내 정보 ───────────────────────────────────────────── */

export function ProfileForm({
  initial,
  timeZones,
}: {
  initial: { name: string; department: string; locale: string; timeZone: string; dailyMail: boolean };
  timeZones: string[];
}) {
  const t = useTranslations("settings.profile");
  const [form, setForm] = useState(initial);
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="max-w-[420px]"
      onSubmit={(e) => {
        e.preventDefault();
        setState({});
        start(async () => {
          const res = await runAction(() => saveProfile(form));
          setState(res.ok ? { saved: true } : { error: res.error });
        });
      }}
    >
      <Field label={t("name")} id="s-name">
        <input id="s-name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={50} className={FIELD} />
      </Field>
      <Field label={t("department")} id="s-dept" hint={t("departmentHint")}>
        <input id="s-dept" value={form.department} onChange={(e) => set("department", e.target.value)} maxLength={50} className={FIELD} />
      </Field>
      <Field label={t("locale")} id="s-locale">
        <select id="s-locale" value={form.locale} onChange={(e) => set("locale", e.target.value)} className={FIELD}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("timeZone")} id="s-tz">
        <select id="s-tz" value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} className={FIELD}>
          {timeZones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </Field>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={form.dailyMail} onChange={(e) => set("dailyMail", e.target.checked)} />
        <span>
          {t("dailyMail")}
          <span className="block text-xs text-ink-2">{t("dailyMailHint")}</span>
        </span>
      </label>

      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.saved && <Banner>{t("saved")}</Banner>}
      <button type="submit" disabled={pending} className={`mt-4 ${PRIMARY}`}>
        {t("save")}
      </button>
    </form>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <label htmlFor={id} className="mb-1 block text-xs text-ink-2">
        {label}
      </label>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

/* ── 로그인 방법 ───────────────────────────────────────── */

export function LoginMethods({
  hasPassword,
  linked,
  available,
}: {
  hasPassword: boolean;
  linked: { provider: AuthProvider; email: string | null }[];
  available: AuthProvider[];
}) {
  const t = useTranslations("settings.login");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const methods = (hasPassword ? 1 : 0) + linked.length;

  const unlink = (provider: AuthProvider) =>
    start(async () => {
      const res = await runAction(() => unlinkProvider(provider));
      setNotice(res.ok ? null : { tone: "error", text: res.error });
    });

  return (
    <>
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <Row label={t("password")} value={hasPassword ? "••••••••" : undefined}>
        <button type="button" className={BUTTON} onClick={() => setOpen((v) => !v)}>
          {hasPassword ? t("change") : t("set")}
        </button>
      </Row>
      {open && <PasswordForm hasPassword={hasPassword} onDone={() => setOpen(false)} />}

      {available.map((p) => {
        const account = linked.find((l) => l.provider === p);
        const isLast = Boolean(account) && methods < 2;
        return (
          <Row
            key={p}
            label={
              <span className="flex items-center gap-2">
                <ProviderLogo provider={p} size={15} />
                {PROVIDER_LABEL[p]}
              </span>
            }
            value={account?.email ?? (account ? undefined : t("notLinked"))}
          >
            {account ? (
              <button type="button" className={BUTTON} disabled={pending || isLast} title={isLast ? t("lastMethodHint") : undefined} onClick={() => unlink(p)}>
                {t("unlink")}
              </button>
            ) : (
              <a href={`/auth/${SLUG[p]}/start?intent=link&returnTo=%2Fsettings`} className={`${BUTTON} inline-flex items-center`}>
                {t("link")}
              </a>
            )}
          </Row>
        );
      })}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BUTTON}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await runAction(() => signOutEverywhere());
              setNotice(res.ok ? { tone: "info", text: t("signedOutAll") } : { tone: "error", text: res.error });
            })
          }
        >
          {t("signOutAll")}
        </button>
        <span className="text-[11.5px] text-ink-3">{t("signOutAllHint")}</span>
      </div>
    </>
  );
}

function Row({ label, value, children }: { label: React.ReactNode; value?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-divider py-2.5 text-sm first:border-t-0">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {label}
        {value && <span className="truncate text-[11.5px] text-ink-2">{value}</span>}
      </span>
      {children}
    </div>
  );
}

function PasswordForm({ hasPassword, onDone }: { hasPassword: boolean; onDone: () => void }) {
  const t = useTranslations("settings.password");
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) return <Banner>{t("changed")}</Banner>;
  return (
    <form
      className="mt-2 max-w-[360px] rounded border border-side-border bg-side-bg p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await runAction(() => changePassword(form.current, form.next, form.confirm));
          if (res.ok) {
            setDone(true);
            onDone();
          } else setError(res.error);
        });
      }}
    >
      {hasPassword && (
        <label className="mb-2 block text-xs text-ink-2">
          {t("current")}
          <input
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))}
            className={`${FIELD} mt-1`}
          />
        </label>
      )}
      <label className="mb-2 block text-xs text-ink-2">
        {t("next")}
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={256}
          value={form.next}
          onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))}
          className={`${FIELD} mt-1`}
        />
      </label>
      <label className="mb-2 block text-xs text-ink-2">
        {t("confirm")}
        <input
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
          className={`${FIELD} mt-1`}
        />
      </label>
      <Banner tone="warn">{t("warning")}</Banner>
      {error && <Banner tone="error">{error}</Banner>}
      <button type="submit" disabled={pending} className={`mt-3 ${PRIMARY}`}>
        {t("submit")}
      </button>
    </form>
  );
}
