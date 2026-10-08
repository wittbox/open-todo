import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { PriorityMark, StatusPill } from "@/components/issues/IssueBits";
import { dateOnlyFromString } from "@/lib/date";
import { DATE_ONLY } from "@/lib/format";
import type { MyIssue } from "@/lib/queries/issues";

/**
 * '나에게 할당됨' 의 이슈 묶음. 작업 줄과 같은 판 모양이지만 체크 동그라미 대신 깃발 —
 * 완료는 이슈에서 상태로 하므로 여기서 끝내지 않는다. 누르면 그 프로젝트의 이슈 탭에서 연다.
 */
export function MyIssueRows({ issues, today }: { issues: MyIssue[]; today: string }) {
  const t = useTranslations("issues");
  const format = useFormatter();
  if (issues.length === 0) return null;
  return (
    <div data-my-issues="">
      <div className="my-2.5 inline-flex h-[30px] items-center gap-2 rounded bg-[var(--row)] px-3 text-[13px] text-[var(--on)]">
        <Icon name="flag" size={14} />
        {t("mine.group")} <span className="text-[var(--on-muted)]">{issues.length}</span>
      </div>
      {issues.map((i) => {
        const late = i.dueDate != null && i.dueDate < today;
        return (
          <Link
            key={i.id}
            href={i.href}
            className="mb-1 flex items-start gap-3.5 rounded bg-[var(--row)] px-4 py-3 hover:bg-[var(--row-hover)]"
          >
            <span className="mt-0.5 shrink-0 text-[var(--on)]">
              <Icon name="flag" size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                <b className="mr-1.5 font-mono font-semibold">{i.ref}</b>
                {i.title}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--on-muted)]">
                {t("mine.meta", { project: i.projectName })}
                {i.dueDate && (
                  <span className={late ? "text-[var(--overdue)]" : undefined}>
                    · <Icon name="calendar" size={12} className="mr-0.5 inline align-[-2px]" />
                    {format.dateTime(dateOnlyFromString(i.dueDate), DATE_ONLY)}
                  </span>
                )}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <StatusPill status={i.status} />
              <PriorityMark priority={i.priority} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
