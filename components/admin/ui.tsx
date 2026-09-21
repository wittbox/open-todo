import type { ReactNode } from "react";
import clsx from "clsx";

/** 관리자·설정 화면이 함께 쓰는 카드와 부품. */

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="max-w-[760px] rounded-lg border border-side-border bg-white">
      <h2 className="flex items-center gap-2 border-b border-divider px-4 py-3 text-sm font-semibold">
        {title}
        {aside && <span className="ml-auto text-xs font-normal text-ink-2">{aside}</span>}
      </h2>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export const FIELD = "h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-sm outline-none focus:border-link";
export const BUTTON = "h-8 shrink-0 rounded border border-[#8a8886] px-3 text-sm hover:bg-side-hover disabled:opacity-50";
export const PRIMARY = "h-8 shrink-0 rounded bg-link px-3.5 text-sm font-semibold text-white hover:bg-[#1f57b8] disabled:opacity-50";

export function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{children}</p>;
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
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

export function Tag({ tone, children }: { tone: "admin" | "off" | "wait" | "used"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-block rounded-full px-2 py-0.5 text-[11.5px]",
        tone === "admin" && "bg-[#eff6fc] text-[#1b4b7a]",
        tone === "off" && "bg-[#fdf3f4] text-danger",
        tone === "wait" && "bg-[#fff8e6] text-[#6b4e00]",
        tone === "used" && "bg-side-active text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

/** 한 번만 보여 주는 링크(초대·재설정) */
export function LinkBox({ link }: { link: string }) {
  return <code className="mt-2 block break-all rounded bg-pane-bg px-2.5 py-2 font-mono text-[11.5px] text-ink-2">{link}</code>;
}

export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: color }}
      aria-hidden
    >
      {name.slice(0, 2)}
    </span>
  );
}
