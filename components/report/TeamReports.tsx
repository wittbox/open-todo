"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { Face } from "@/components/issues/IssueBits";
import { addDays, dateOnlyFromString } from "@/lib/date";
import { shortDayLabel } from "@/lib/format";
import type { TeamCell, TeamReports as Data } from "@/lib/queries/report";

const VIEW_KEY = "todo.teamReportView";

/**
 * 팀 보고서 탭 — 나에게 보고하는 사람들(나에게 보고서를 공유한 적이 있는 사람)이 주마다 보고서를 냈는지.
 * 그런 사람이 없으면 탭 자체가 보이지 않는다(app/(app)/reports/page.tsx).
 * 두 가지 보기: 고른 주의 팀원 목록(제목·구간별 수) / 사람 × 주 표(8주 제출 현황). 고른 보기는 이 브라우저에 기억한다.
 * 열 수 있는 것은 내 것과 나에게 공유된 발행본뿐 — 나머지는 상태(발행됨·작성 중·없음)만 보인다.
 */
export function TeamReports({ data }: { data: Data }) {
  const t = useTranslations("reports.team");
  const locale = useLocale();
  const format = useFormatter();
  const [view, setView] = useState<"list" | "table">("list");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에만 있는 값을 처음 한 번 읽는다
      if (localStorage.getItem(VIEW_KEY) === "table") setView("table");
    } catch {}
  }, []);
  const choose = (v: "list" | "table") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const [week, setWeek] = useState(data.weeks[0]);

  if (data.members.length === 0) {
    return <p className="mt-6 rounded border border-side-border bg-white px-4 py-6 text-center text-sm text-ink-2">{t("empty")}</p>;
  }

  const published = (w: string) => data.members.filter((m) => data.cells[m.userId][w].status === "published").length;
  const seg = (on: boolean) => `px-3 py-1 ${on ? "bg-[#eff6fc] font-semibold text-link" : "text-ink-2 hover:bg-side-hover"}`;
  const day = (d: Date) => shortDayLabel(d, locale);
  const range = (w: string) => {
    const d = dateOnlyFromString(w);
    return `${day(d)} ~ ${day(addDays(d, 6))}`;
  };
  const md = (w: string) => {
    const d = dateOnlyFromString(w);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  // 발행 시각은 사용자 시간대로(next-intl 의 timeZone)
  const when = (iso: string) => format.dateTime(new Date(iso), { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
  const shortDay = (iso: string) => format.dateTime(new Date(iso), { month: "numeric", day: "numeric" });
  const counts = (w: string) => {
    const n = { published: 0, draft: 0, none: 0 };
    for (const m of data.members) n[data.cells[m.userId][w].status]++;
    return n;
  };
  const lineTitle = (c: TeamCell) =>
    c.title ?? (c.status === "published" ? t("notShared") : c.status === "draft" ? t("draft") : t("none"));

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-2">
          {t.rich("lead", { count: data.members.length - 1, b: (chunks) => <b className="font-semibold text-ink">{chunks}</b> })}
        </p>
        <span className="ml-auto inline-flex overflow-hidden rounded border border-[#e1dfdd] bg-white text-[12.5px]" role="group" aria-label={t("views")}>
          <button type="button" aria-pressed={view === "list"} onClick={() => choose("list")} className={seg(view === "list")}>
            {t("byWeek")}
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => choose("table")} className={seg(view === "table")}>
            {t("table")}
          </button>
        </span>
      </div>

      {view === "list" ? (
        <>
          <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label={t("weeks")}>
            {data.weeks.map((w, i) => (
              <button
                key={w}
                type="button"
                aria-pressed={week === w}
                onClick={() => setWeek(w)}
                className={`rounded-full border px-3 py-0.5 text-[12.5px] ${
                  week === w ? "border-link bg-[#eff6fc] font-semibold text-link" : "border-[#e1dfdd] bg-white text-ink-2 hover:bg-side-hover"
                }`}
              >
                {t("weekChip", { range: range(w), thisWeek: i === 0 ? "yes" : "no", published: published(w), total: data.members.length })}
              </button>
            ))}
          </div>

          <h2 className="mb-2 mt-5 text-sm font-semibold">
            {range(week)} <span className="font-normal text-ink-2">— {t("summary", counts(week))}</span>
          </h2>
          <ul className="divide-y divide-divider overflow-hidden rounded border border-side-border bg-white" aria-label={t("members")}>
            {data.members.map((m) => {
              const c = data.cells[m.userId][week];
              const body = (
                <>
                  <Face name={m.name} color={m.avatarColor} size={28} />
                  <span className="w-24 shrink-0 truncate text-sm">
                    {m.name}
                    {m.isMe && <span className="text-ink-3"> {t("me")}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${c.reportId ? "" : "text-ink-3"}`}>{lineTitle(c)}</span>
                    {c.counts && <span className="block text-xs text-ink-2">{t("counts", c.counts)}</span>}
                  </span>
                  <StatusPill c={c} />
                  <span className="hidden w-32 shrink-0 text-right text-xs text-ink-2 sm:block">{c.publishedAt ? when(c.publishedAt) : "—"}</span>
                  {c.reportId && <Icon name="chevronRight" size={15} className="shrink-0 text-ink-3" />}
                </>
              );
              return (
                <li key={m.userId} data-member={m.userId}>
                  {c.reportId ? (
                    <Link href={`/reports/${c.reportId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-side-hover">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="thin-scroll mt-4 overflow-x-auto rounded border border-side-border bg-white">
          <table className="w-full min-w-[640px] border-collapse text-[13px]" aria-label={t("table")}>
            <thead>
              <tr className="bg-[#faf9f8] text-[12px] text-ink-2">
                <th className="px-3 py-2 text-left font-semibold">{t("member")}</th>
                {data.weeks.map((w, i) => (
                  <th key={w} className={`px-2 py-2 text-center font-semibold ${i === 0 ? "text-link" : ""}`}>
                    {md(w)}
                    {i === 0 && <span className="block text-[11px] font-normal">{t("thisWeek")}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.userId} className="border-t border-divider">
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <Face name={m.name} color={m.avatarColor} size={24} />
                      {m.name}
                      {m.isMe && <span className="text-ink-3">{t("me")}</span>}
                    </span>
                  </td>
                  {data.weeks.map((w) => (
                    <td key={w} className="px-2 py-2 text-center">
                      <TableCell c={data.cells[m.userId][w]} shortDay={shortDay} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-divider px-3 py-2 text-[12px] text-ink-2">
            <span>
              <span className="rounded bg-[#dff6dd] px-1.5 text-[#0b6a0b]">10/9</span> {t("legendPublished")}
            </span>
            <span>
              <span className="rounded bg-[#edf3ed] px-1.5 text-[#5b7a5b]">{t("publishedShort")}</span> {t("legendLocked")}
            </span>
            <span>
              <span className="rounded bg-[#fff4ce] px-1.5 text-[#8a5a00]">{t("draft")}</span> {t("legendDraft")}
            </span>
            <span>— {t("legendNone")}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function StatusPill({ c }: { c: TeamCell }) {
  const t = useTranslations("reports.team");
  if (c.status === "published") return <span className="shrink-0 rounded-full bg-[#dff6dd] px-2.5 py-0.5 text-[11px] text-[#0b6a0b]">{t("published")}</span>;
  if (c.status === "draft") return <span className="shrink-0 rounded-full bg-[#fff4ce] px-2.5 py-0.5 text-[11px] text-[#8a5a00]">{t("draft")}</span>;
  return <span className="shrink-0 rounded-full bg-pane-bg px-2.5 py-0.5 text-[11px] text-ink-3">{t("noneShort")}</span>;
}

function TableCell({ c, shortDay }: { c: TeamCell; shortDay: (iso: string) => string }) {
  const t = useTranslations("reports.team");
  if (c.status === "published" && c.reportId) {
    return (
      <Link href={`/reports/${c.reportId}`} title={c.title ?? undefined} className="inline-block min-w-[48px] rounded bg-[#dff6dd] px-1.5 py-0.5 text-[12px] text-[#0b6a0b] hover:outline hover:outline-1 hover:outline-[#0b6a0b]">
        {shortDay(c.publishedAt!)}
      </Link>
    );
  }
  if (c.status === "published") {
    return (
      <span title={t("notShared")} className="inline-flex min-w-[48px] items-center justify-center gap-0.5 rounded bg-[#edf3ed] px-1.5 py-0.5 text-[12px] text-[#5b7a5b]">
        <Icon name="lock" size={10} />
        {t("publishedShort")}
      </span>
    );
  }
  if (c.status === "draft") {
    return c.reportId ? (
      <Link href={`/reports/${c.reportId}`} className="inline-block rounded bg-[#fff4ce] px-1.5 py-0.5 text-[12px] text-[#8a5a00]">
        {t("draft")}
      </Link>
    ) : (
      <span className="inline-block rounded bg-[#fff4ce] px-1.5 py-0.5 text-[12px] text-[#8a5a00]">{t("draft")}</span>
    );
  }
  return <span className="text-[#c8c6c4]">—</span>;
}
