"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { DOCK_QUERY, SIDEBAR_COLLAPSED_COOKIE, shellTitle, type ShellNames } from "@/components/shell/shell";
import { useMediaQuery } from "@/components/shell/useMediaQuery";
import { useAppName } from "@/components/brand";

/**
 * 앱 셸 — 사이드바 + (좁을 때) 위 줄 + 본문.
 *
 * 1024px 보다 좁거나 메뉴를 접었으면 사이드바는 왼쪽 서랍이 되고, 위 줄의 ☰ 로 연다.
 * 화면을 옮기거나 서랍 안의 링크를 누르거나 바깥·Esc 로 닫힌다.
 *
 * 서랍 틀에는 '움직임 없음' 일 때 translate 를 아예 두지 않는다(translate-none). 값이
 * 남아 있으면 그 틀이 fixed 요소의 기준이 되어, 사이드바 안에서 여는 공유 창·오른쪽 클릭
 * 메뉴가 화면이 아니라 사이드바 기준으로 자리를 잡는다.
 */

type Shell = { collapsed: boolean; toggleCollapsed: () => void; close: () => void };

const ShellContext = createContext<Shell>({ collapsed: false, toggleCollapsed: () => {}, close: () => {} });

/** 사이드바가 접기·닫기 버튼에 쓴다. 셸 밖(시험 등)에서는 아무 일도 하지 않는다. */
export const useShell = () => useContext(ShellContext);

export function AppShell({
  names,
  unreadCount,
  initialCollapsed,
  sidebar,
  children,
}: {
  names: ShellNames;
  unreadCount: number;
  initialCollapsed: boolean;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("nav");
  const titles = useTranslations("nav.titles");
  const pathname = usePathname();
  const appName = useAppName();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // 서버는 폭을 모른다 — PC 로 가정해 그린다(폰에서는 어차피 화면 밖에 있다).
  const wideEnough = useMediaQuery(DOCK_QUERY, true);
  const docked = !collapsed;
  const shown = open || (docked && wideEnough);

  // 화면을 옮기면 서랍을 닫는다. 렌더 도중 되돌린다(ProjectSection 과 같은 방식).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    setOpen(false);
    try {
      document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // 쿠키를 못 쓰면 이 창에서만 유지된다.
    }
  }

  const shell: Shell = { collapsed, toggleCollapsed, close: () => setOpen(false) };

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex min-h-0 flex-1">
        {open && (
          <div
            data-drawer-backdrop=""
            onClick={() => setOpen(false)}
            className={`fixed inset-0 z-40 bg-black/40 ${docked ? "lg:hidden" : ""}`}
          />
        )}
        <div
          data-sidebar-frame=""
          inert={!shown}
          // 같은 주소를 다시 눌러도 서랍은 닫혀야 한다(주소가 안 바뀌면 위의 닫기가 돌지 않는다).
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest("a[href]")) setOpen(false);
          }}
          className={[
            "fixed inset-y-0 left-0 z-50 flex w-[290px] max-w-[86vw] transition-[translate] duration-200",
            open ? "translate-none shadow-[4px_0_18px_rgba(0,0,0,.18)]" : "-translate-x-full",
            docked ? "lg:static lg:z-auto lg:max-w-none lg:translate-none lg:shadow-none lg:transition-none" : "",
          ].join(" ")}
        >
          {sidebar}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className={`flex h-12 shrink-0 items-center gap-0.5 border-b border-side-border bg-white px-1.5 ${docked ? "lg:hidden" : ""}`}
          >
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={t("openMenu")}
              aria-expanded={open}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink hover:bg-side-hover"
            >
              <Icon name="menu" size={20} />
            </button>
            <span className="min-w-0 flex-1 truncate px-1 text-[16px] font-semibold">
              {shellTitle(pathname, names, titles, appName)}
            </span>
            <Link
              href="/notifications"
              aria-label={unreadCount > 0 ? t("unread", { count: unreadCount }) : titles("notifications")}
              className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink hover:bg-side-hover"
            >
              <Icon name="bell" size={19} />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1.5 min-w-[16px] rounded-full bg-[#c2185b] px-1 text-center text-[10px] font-semibold leading-4 text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          </header>
          <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
