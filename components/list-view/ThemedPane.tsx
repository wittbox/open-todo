import type { ReactNode } from "react";

export type PaneColors = {
  accent: string;
  on: string;
  onMuted: string;
  row: string;
  rowHover: string;
  overdue: string;
};

/**
 * 목록 / 스마트 뷰 공통 본문 틀.
 * 색은 CSS 변수로 내려서 하위 요소가 Tailwind 임의값으로 참조한다.
 */
export function ThemedPane({
  colors,
  title,
  subtitle,
  titleIcon,
  actions,
  footer,
  children,
}: {
  colors: PaneColors;
  title: string;
  subtitle?: string;
  titleIcon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="flex min-w-0 flex-1 flex-col"
      style={
        {
          background: colors.accent,
          "--on": colors.on,
          "--on-muted": colors.onMuted,
          "--row": colors.row,
          "--row-hover": colors.rowHover,
          "--overdue": colors.overdue,
        } as React.CSSProperties
      }
    >
      {/* 폰에서는 좌우 여백·제목을 줄인다 — 32px 씩이면 375px 화면의 1/6 이 여백이다. */}
      <header className="flex items-start gap-2.5 px-4 pb-2 pt-4 md:px-8 md:pb-2.5 md:pt-6">
        {titleIcon && <span className="pt-0.5 text-[var(--on)] md:pt-1">{titleIcon}</span>}
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-semibold tracking-tight text-[var(--on)] md:text-[30px]">{title}</h1>
          {subtitle && <div className="mt-1 text-[13px] text-[var(--on-muted)]">{subtitle}</div>}
        </div>
        {actions && <div className="ml-auto flex gap-1 pt-1.5">{actions}</div>}
      </header>

      <div className="pane-scroll min-h-0 flex-1 overflow-y-auto px-3 pt-1.5 md:px-8">{children}</div>

      {footer && <div className="mx-3 mb-4 mt-2.5 md:mx-8 md:mb-6">{footer}</div>}
    </section>
  );
}

export function PaneButton({ children, title }: { children: ReactNode; title: string }) {
  return (
    <button
      title={title}
      className="grid h-[34px] w-[34px] place-items-center rounded bg-[var(--row)] text-[var(--on)] hover:bg-[var(--row-hover)]"
    >
      {children}
    </button>
  );
}
