"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  forgotPasswordAction,
  loginAction,
  oauthEmailAction,
  resendSignupAction,
  resetPasswordAction,
  signupAction,
  verifySignupAction,
  type AuthFormState,
} from "@/lib/actions/auth";
import { AuthTitle, Field, INPUT, Notice, SubmitButton } from "@/components/auth/ui";

/* ── 로그인 ─────────────────────────────────────────────── */

export function LoginForm({ returnTo, signupOpen }: { returnTo: string; signupOpen: boolean }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(loginAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <Field label={t("email")} htmlFor="login-email">
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state?.fields?.email}
          placeholder="name@example.com"
          className={INPUT}
        />
      </Field>
      <Field label={t("password")} htmlFor="login-password">
        <input id="login-password" name="password" type="password" autoComplete="current-password" required className={INPUT} />
      </Field>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pending={pending}>{t("login.submit")}</SubmitButton>
      <div className="mt-2.5 flex justify-between text-[12.5px]">
        <Link href="/forgot-password" className="text-link hover:underline">
          {t("login.forgot")}
        </Link>
        {signupOpen && (
          <Link href="/signup" className="text-link hover:underline">
            {t("login.createAccount")}
          </Link>
        )}
      </div>
    </form>
  );
}

/* ── 가입 ───────────────────────────────────────────────── */

/** 비밀번호 세기 막대 — 안내일 뿐, 막는 것은 서버 규칙(8자·흔한 비밀번호)이다. */
function strength(pw: string): number {
  if (pw.length < 8) return pw.length > 0 ? 1 : 0;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return Math.min(4, 1 + (pw.length >= 12 ? 1 : 0) + (pw.length >= 16 ? 1 : 0) + (kinds >= 3 ? 1 : 0));
}

/** 새 비밀번호 칸. `confirm` 은 한 번 더 적는 칸이라 안내·막대가 없다. */
function PasswordInput({ id, name, label, confirm }: { id: string; name: string; label: string; confirm?: boolean }) {
  const t = useTranslations("auth");
  const [score, setScore] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // 액션이 끝나면 React 가 폼을 비운다 — 막대도 함께 비운다.
    const form = ref.current?.form;
    const clear = () => setScore(0);
    form?.addEventListener("reset", clear);
    return () => form?.removeEventListener("reset", clear);
  }, []);
  return (
    <Field label={label} htmlFor={id} hint={confirm ? undefined : t("passwordHint")}>
      <input
        id={id}
        name={name}
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={256}
        ref={ref}
        onChange={(e) => setScore(strength(e.target.value))}
        className={INPUT}
      />
      {!confirm && (
        <div className="mt-1.5 flex gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1 flex-1 rounded ${i <= score ? (score <= 1 ? "bg-danger" : "bg-[#107c10]") : "bg-divider"}`} />
          ))}
        </div>
      )}
    </Field>
  );
}

export function SignupForm(props: { invite?: string; lockedEmail?: string | null; lockedLabel?: string }) {
  // "다른 주소로 가입" 을 누르면 폼 상태를 처음으로 돌린다.
  const [round, setRound] = useState(0);
  return <SignupFormInner key={round} {...props} onRestart={() => setRound((r) => r + 1)} />;
}

function SignupFormInner({
  invite,
  lockedEmail,
  lockedLabel,
  onRestart,
}: {
  invite?: string;
  lockedEmail?: string | null;
  lockedLabel?: string;
  onRestart: () => void;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signupAction, null);
  const tz = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // 처음 설정을 이 브라우저의 시간대로 — 설정에서 언제든 바꾼다.
    if (tz.current) tz.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  }, []);

  if (state?.sentTo) return <CheckEmail email={state.sentTo} onRestart={onRestart} resend={resendSignupAction} />;

  return (
    <form action={action}>
      <input type="hidden" name="invite" value={invite ?? ""} />
      <input ref={tz} type="hidden" name="timeZone" defaultValue="" />
      <Field label={t("email")} htmlFor="signup-email" hint={lockedEmail ? lockedLabel : undefined}>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          readOnly={Boolean(lockedEmail)}
          defaultValue={lockedEmail ?? state?.fields?.email ?? ""}
          placeholder="name@example.com"
          className={INPUT}
        />
      </Field>
      <Field label={t("name")} htmlFor="signup-name">
        <input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={50}
          defaultValue={state?.fields?.name}
          className={INPUT}
        />
      </Field>
      <PasswordInput id="signup-password" name="password" label={t("password")} />
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pending={pending}>{t("signup.submit")}</SubmitButton>
    </form>
  );
}

type FormAction = (prev: AuthFormState, form: FormData) => Promise<AuthFormState>;

function CheckEmail({
  email,
  onRestart,
  resend,
  extra,
}: {
  email: string;
  onRestart: () => void;
  /** 다시 보내기 — 같은 주소(와 extra)로 다시 부른다 */
  resend: FormAction;
  extra?: Record<string, string>;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(resend, null);
  return (
    <div className="text-center">
      <div className="mb-2 text-3xl" aria-hidden>
        ✉️
      </div>
      <AuthTitle lead={t("checkEmail.body", { email })}>{t("checkEmail.title")}</AuthTitle>
      <form action={action}>
        <input type="hidden" name="email" value={email} />
        {Object.entries(extra ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button
          type="submit"
          disabled={pending}
          className="h-9 w-full rounded border border-[#8a8886] text-sm hover:bg-side-hover disabled:opacity-60"
        >
          {t("checkEmail.resend")}
        </button>
      </form>
      {(state?.done || state?.sentTo) && <Notice>{t("checkEmail.resent")}</Notice>}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <button type="button" onClick={onRestart} className="mt-3 text-[13px] text-link hover:underline">
        {t("checkEmail.other")}
      </button>
    </div>
  );
}

/* ── 메일 링크 확인 ─────────────────────────────────────── */

export function VerifyForm({ token, kind }: { token: string; kind: "password" | "oauth" }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(verifySignupAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={kind} />
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pending={pending}>{t("verify.submit")}</SubmitButton>
    </form>
  );
}

/* ── 제공자 가입: 이메일 적기 ─────────────────────────── */

export function OAuthEmailForm(props: { suggestedEmail: string | null; lockedEmail: boolean; name: string | null; lockedLabel: string }) {
  const [round, setRound] = useState(0);
  return <OAuthEmailInner key={round} {...props} onRestart={() => setRound((r) => r + 1)} />;
}

function OAuthEmailInner({
  suggestedEmail,
  lockedEmail,
  name,
  lockedLabel,
  onRestart,
}: {
  suggestedEmail: string | null;
  lockedEmail: boolean;
  name: string | null;
  lockedLabel: string;
  onRestart: () => void;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(oauthEmailAction, null);
  const tz = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (tz.current) tz.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  }, []);

  if (state?.sentTo) {
    return <CheckEmail email={state.sentTo} onRestart={onRestart} resend={oauthEmailAction} extra={{ name: state.fields?.name ?? "" }} />;
  }
  return (
    <form action={action}>
      <input ref={tz} type="hidden" name="timeZone" defaultValue="" />
      <Field label={t("email")} htmlFor="oauth-email" hint={lockedEmail ? lockedLabel : undefined}>
        <input
          id="oauth-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          readOnly={lockedEmail}
          defaultValue={state?.fields?.email ?? suggestedEmail ?? ""}
          className={INPUT}
        />
      </Field>
      <Field label={t("name")} htmlFor="oauth-name">
        <input
          id="oauth-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={50}
          defaultValue={state?.fields?.name ?? name ?? ""}
          className={INPUT}
        />
      </Field>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pending={pending}>{t("oauthEmail.submit")}</SubmitButton>
      <div className="mt-3 text-center text-[13px]">
        <Link href="/login" className="text-link hover:underline">
          {t("oauthEmail.cancel")}
        </Link>
      </div>
    </form>
  );
}

/* ── 비밀번호 찾기·재설정 ───────────────────────────────── */

export function ForgotForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(forgotPasswordAction, null);
  return (
    <form action={action}>
      <Field label={t("email")} htmlFor="forgot-email">
        <input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.fields?.email}
          className={INPUT}
        />
      </Field>
      {state?.done && <Notice>{t("forgot.sent")}</Notice>}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pending={pending}>{t("forgot.submit")}</SubmitButton>
      <div className="mt-3 text-center text-[13px]">
        <Link href="/login" className="text-link hover:underline">
          {t("forgot.back")}
        </Link>
      </div>
    </form>
  );
}

export function ResetForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(resetPasswordAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      {/* 비밀번호 관리자가 어느 계정의 새 비밀번호인지 알게 */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <PasswordInput id="reset-password" name="password" label={t("newPassword")} />
      <PasswordInput id="reset-confirm" name="confirm" label={t("confirmPassword")} confirm />
      <Notice tone="warn">{t("reset.warning")}</Notice>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <SubmitButton pending={pending}>{t("reset.submit")}</SubmitButton>
    </form>
  );
}
