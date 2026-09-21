import type { ReactNode } from "react";
import clsx from "clsx";
import { LanguageSwitch } from "@/components/auth/LanguageSwitch";

/**
 * 로그인 전 화면들이 함께 쓰는 틀과 부품. 서버·브라우저 어디서든 그린다(훅 없음).
 */

export function AuthScreen({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <main className="relative flex flex-1 flex-col items-center overflow-y-auto bg-side-bg px-4 pb-10 pt-14">
      <div className="absolute right-4 top-3">
        <LanguageSwitch />
      </div>
      <div className="w-full max-w-sm rounded-lg border border-side-border bg-white px-6 py-7">{children}</div>
      {below && <div className="mt-4 w-full max-w-sm text-center text-[13px] leading-relaxed text-ink-2">{below}</div>}
    </main>
  );
}

export function AuthTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-lg font-semibold">{children}</h1>
      {lead && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{lead}</p>}
    </div>
  );
}

export const INPUT =
  "h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-sm outline-none focus:border-link read-only:bg-pane-bg read-only:text-ink-2";

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs text-ink-2">
        {label}
      </label>
      {children}
      {hint && <div className="mt-1 text-[11.5px] text-ink-3">{hint}</div>}
    </div>
  );
}

export function SubmitButton({ children, pending }: { children: ReactNode; pending?: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 h-[38px] w-full rounded bg-link text-sm font-semibold text-white hover:bg-[#1f57b8] disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "mt-3 rounded border px-3 py-2 text-[12.5px] leading-relaxed",
        tone === "info" && "border-[#c7e0f4] bg-[#eff6fc] text-[#1b4b7a]",
        tone === "warn" && "border-[#f0c36d] bg-[#fff8e6] text-[#6b4e00]",
        tone === "error" && "border-[#f1bbbc] bg-[#fdf3f4] text-danger",
      )}
    >
      {children}
    </div>
  );
}

export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-2.5 text-xs text-ink-3">
      <span className="h-px flex-1 bg-divider" />
      {label}
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}
