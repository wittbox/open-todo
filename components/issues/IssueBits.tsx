import { useTranslations } from "next-intl";
import { labelColor } from "@/lib/issues/format";
import type { IssuePriority, IssueStatus } from "@/app/generated/prisma/enums";

/** 이슈 화면의 작은 조각들 — 상태 알약, 우선순위 표시, 라벨, 얼굴. */

const STATUS_STYLE: Record<IssueStatus, { cls: string; mark: string }> = {
  OPEN: { cls: "bg-[#eff6fc] text-[#2564cf]", mark: "○" },
  IN_PROGRESS: { cls: "bg-[#fff4ce] text-[#8a5a00]", mark: "●" },
  RESOLVED: { cls: "bg-[#dff6dd] text-[#0b6a0b]", mark: "✓" },
  CLOSED: { cls: "bg-pane-bg text-ink-2", mark: "■" },
};

export function StatusPill({ status, className = "" }: { status: IssueStatus; className?: string }) {
  const t = useTranslations("issues");
  const s = STATUS_STYLE[status];
  return (
    <span data-status={status} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[12px] ${s.cls} ${className}`}>
      <span aria-hidden="true" className="text-[10px]">{s.mark}</span>
      {t(`status.${status}`)}
    </span>
  );
}

const PRIORITY_STYLE: Record<IssuePriority, { cls: string; mark: string }> = {
  URGENT: { cls: "font-semibold text-danger", mark: "▲▲ " },
  HIGH: { cls: "text-[#c75000]", mark: "▲ " },
  NORMAL: { cls: "text-ink-2", mark: "" },
  LOW: { cls: "text-ink-3", mark: "▽ " },
};

export function PriorityMark({ priority }: { priority: IssuePriority }) {
  const t = useTranslations("issues");
  const p = PRIORITY_STYLE[priority];
  return (
    <span className={`whitespace-nowrap text-[12px] ${p.cls}`}>
      <span aria-hidden="true">{p.mark}</span>
      {t(`priority.${priority}`)}
    </span>
  );
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  const c = labelColor(color);
  return (
    <span className="inline-block whitespace-nowrap rounded-full px-1.5 text-[11px] leading-[17px]" style={{ background: c.bg, color: c.fg }}>
      {name}
    </span>
  );
}

export function Face({ name, color, size = 22 }: { name: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ background: color, width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
