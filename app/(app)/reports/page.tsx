import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { getTeamReports, listReports, listSharedReports, teamMemberIds } from "@/lib/queries/report";
import { TeamReports } from "@/components/report/TeamReports";
import { openReport } from "@/lib/actions/report";
import { addDays, currentWeekStart, dateOnlyFromString, dateOnlyToString } from "@/lib/date";
import { shortDayLabel } from "@/lib/format";
import { Icon } from "@/components/icons";
import { getRequestTimeZone } from "@/lib/prefs";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/brand-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");
  return { title: await pageTitle(t("navTitle")) };
}

/** 첫 화면 목록에 처음 보이는 개수 — 나머지는 “더 보기” 를 펼쳐 달별로 */
const RECENT = 5;

/** ‘다른 주 쓰기’ 로 고를 수 있는 지난 주 수(이번·지난 주 두 칸 다음부터) */
const OTHER_WEEKS = 10;

/**
 * 주간보고서. 나에게 보고서를 공유한 사람이 있으면(팀장) 위에 [내 보고서 | 팀 보고서] 탭(?tab=team).
 * 팀원끼리는 서로 공유하지 않는 한 탭이 보이지 않는다.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const userId = await requireUserId();
  const hasTeam = (await teamMemberIds(userId)).length > 0;
  const tab = hasTeam && (await searchParams).tab === "team" ? "team" : "mine";
  const t = await getTranslations("reports");

  const thisWeek = currentWeekStart(new Date(), await getRequestTimeZone());
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * i));

  async function open(formData: FormData) {
    "use server";
    const week = String(formData.get("week") ?? "");
    const res = await openReport(week);
    if (res.ok) redirect(`/reports/${res.data.id}`);
  }

  const tabCls = (on: boolean) => `px-0.5 pb-2 ${on ? "font-semibold shadow-[inset_0_-2px_0_#2564cf]" : "text-ink-2 hover:text-ink"}`;

  return (
    <section className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-pane-bg px-4 py-5 md:px-10 md:py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1.5 text-sm text-ink-2">{t("page.lead")}</p>

        {hasTeam && (
          <nav aria-label={t("page.tabsNav")} className="mt-5 flex gap-5 border-b border-side-border text-sm">
            <Link href="/reports" aria-current={tab === "mine" ? "page" : undefined} className={tabCls(tab === "mine")}>
              {t("page.tabMine")}
            </Link>
            <Link href="/reports?tab=team" aria-current={tab === "team" ? "page" : undefined} className={tabCls(tab === "team")}>
              {t("page.tabTeam")}
            </Link>
          </nav>
        )}

        {tab === "team" ? <TeamReports data={await getTeamReports(userId, weeks)} /> : <MyReports userId={userId} weeks={weeks} open={open} />}
      </div>
    </section>
  );
}

/**
 * 내 보고서 탭. 주차 선택은 이번 주·지난 주 두 칸, 밀린 주는 ‘다른 주 쓰기’ 고르기로. 만든 보고서·공유받은 보고서는
 * 최근 5개 + 더 보기(달별) — 위 두 칸에 이미 보이는 이번·지난 주 보고서는 목록에서 뺀다.
 */
async function MyReports({ userId, weeks, open }: { userId: string; weeks: Date[]; open: (formData: FormData) => Promise<void> }) {
  const [reports, sharedReports] = await Promise.all([listReports(userId), listSharedReports(userId)]);
  const t = await getTranslations("reports");
  const format = await getFormatter();
  const locale = await getLocale();
  const dateOf = (iso: string) => format.dateTime(new Date(iso), { year: "numeric", month: "numeric", day: "numeric" });
  const existing = new Map(reports.map((r) => [r.weekStart, r]));
  const cards = weeks.slice(0, 2);
  const cardKeys = new Set(cards.map(dateOnlyToString));
  const others = Array.from({ length: OTHER_WEEKS }, (_, i) => addDays(weeks[0], -7 * (i + 2)));
  const listed = reports.filter((r) => !cardKeys.has(r.weekStart));
  const range = (w: Date) => `${shortDayLabel(w, locale)} ~ ${shortDayLabel(addDays(w, 6), locale)}`;
  // 달 묶음 이름 — 날짜 전용 값이라 UTC 로 읽는다
  const monthOf = (weekStart: string) => format.dateTime(dateOnlyFromString(weekStart), { year: "numeric", month: "long", timeZone: "UTC" });

  return (
    <>
      <h2 className="mb-2 mt-8 text-sm font-semibold">{t("page.pickWeek")}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cards.map((w, i) => {
          const key = dateOnlyToString(w);
          const report = existing.get(key);
          return (
            <form action={open} key={key}>
              <input type="hidden" name="week" value={key} />
              <button className="flex w-full items-center gap-3 rounded border border-side-border bg-white px-4 py-3 text-left hover:bg-side-hover">
                <Icon name="calendar" size={17} className="shrink-0 text-ink-2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    {range(w)}
                    {i === 0 && <span className="ml-2 text-xs text-link">{t("page.thisWeek")}</span>}
                    {i === 1 && <span className="ml-2 text-xs text-ink-2">{t("page.lastWeek")}</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-2">{report ? report.title : t("page.notCreated")}</span>
                </span>
                {report?.publishedAt && (
                  <span className="shrink-0 rounded-full bg-[#dff6dd] px-2.5 py-0.5 text-[11px] text-[#0b6a0b]">{t("page.published")}</span>
                )}
              </button>
            </form>
          );
        })}
      </div>
      {/* 밀린 주 — 고르고 ‘열기’ 로 그 주 보고서를 만들거나 연다 */}
      <form action={open} className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
        <label htmlFor="other-week">{t("page.otherWeek")}</label>
        <select id="other-week" name="week" className="h-7 rounded border border-[#d6d4d2] bg-white px-1.5 text-[12.5px] text-ink">
          {others.map((w) => {
            const key = dateOnlyToString(w);
            return (
              <option key={key} value={key}>
                {range(w)}
                {existing.has(key) ? t("page.made") : ""}
              </option>
            );
          })}
        </select>
        <button className="h-7 rounded border border-[#d6d4d2] bg-white px-2.5 hover:bg-side-hover">{t("page.openWeek")}</button>
      </form>

      <h2 className="mb-2 mt-9 text-sm font-semibold">{t("page.mine", { count: reports.length })}</h2>
      {reports.length === 0 ? (
        <p className="rounded border border-side-border bg-white px-4 py-6 text-center text-sm text-ink-2">{t("page.noneMine")}</p>
      ) : listed.length === 0 ? (
        <p className="rounded border border-side-border bg-white px-4 py-4 text-center text-sm text-ink-2">{t("page.onlyCardWeeks")}</p>
      ) : (
        <RecentList
          more={(n) => t("page.moreMine", { count: n })}
          collapse={t("page.collapse")}
          monthOf={monthOf}
          items={listed.map((r) => ({
            id: r.id,
            weekStart: r.weekStart,
            title: r.title,
            badge: r.publishedAt ? t("page.published") : null,
            meta: [
              r.weekStart,
              r.publishedAt && t("page.publishedAt", { date: dateOf(r.publishedAt) }),
              r.sharedWithCount > 0 && t("page.sharedCount", { count: r.sharedWithCount }),
              r.sendCount > 0 && t("page.sendCount", { count: r.sendCount }),
            ]
              .filter(Boolean)
              .join(" · "),
            shared: r.sharedWithCount > 0,
          }))}
        />
      )}

      <h2 className="mb-2 mt-9 text-sm font-semibold">{t("page.sharedWithMe", { count: sharedReports.length })}</h2>
      {sharedReports.length === 0 ? (
        <p className="rounded border border-side-border bg-white px-4 py-6 text-center text-sm text-ink-2">{t("page.noneShared")}</p>
      ) : (
        <RecentList
          more={(n) => t("page.moreShared", { count: n })}
          collapse={t("page.collapse")}
          monthOf={monthOf}
          items={sharedReports.map((r) => ({
            id: r.id,
            weekStart: r.weekStart,
            title: r.title,
            badge: t("page.readOnly"),
            meta: `${r.authorName} · ${r.weekStart} · ${t("page.published")} ${dateOf(r.publishedAt)}`,
            shared: false,
          }))}
        />
      )}
    </>
  );
}

type ListItem = { id: string; weekStart: string; title: string; badge: string | null; meta: string; shared: boolean };

/** 최근 몇 개만 보이고, 나머지는 “N개 더 보기” 를 펼치면 달별로 묶어 전부. 펼치기는 브라우저 기본(details)이라 스크립트가 없다. */
function RecentList({
  items,
  more,
  collapse,
  monthOf,
}: {
  items: ListItem[];
  more: (n: number) => string;
  collapse: string;
  monthOf: (weekStart: string) => string;
}) {
  const recent = items.slice(0, RECENT);
  const rest = items.slice(RECENT);
  const months = new Map<string, ListItem[]>();
  for (const it of rest) {
    const key = monthOf(it.weekStart);
    months.set(key, [...(months.get(key) ?? []), it]);
  }
  const row = (r: ListItem) => (
    <li key={r.id}>
      <Link href={`/reports/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-side-hover">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{r.title}</span>
          <span className="block text-xs text-ink-2">{r.meta}</span>
        </span>
        {r.badge && <span className="shrink-0 rounded-full bg-pane-bg px-2 py-0.5 text-[11px] text-ink-2">{r.badge}</span>}
        {r.shared && <Icon name="share" size={15} className="shrink-0 text-ink-2" />}
        <Icon name="chevronRight" size={15} className="shrink-0 text-ink-3" />
      </Link>
    </li>
  );
  return (
    <div className="overflow-hidden rounded border border-side-border bg-white">
      <ul className="divide-y divide-divider">{recent.map(row)}</ul>
      {rest.length > 0 && (
        <details className="group border-t border-divider">
          <summary className="cursor-pointer list-none bg-[#faf9f8] px-4 py-2 text-center text-[12.5px] text-link hover:underline">
            <span className="group-open:hidden">{more(rest.length)}</span>
            <span className="hidden group-open:inline">{collapse}</span>
          </summary>
          {[...months].map(([month, list]) => (
            <div key={month}>
              <p className="border-t border-divider bg-[#faf9f8] px-4 py-1 text-[11.5px] text-ink-3">{month}</p>
              <ul className="divide-y divide-divider border-t border-divider">{list.map(row)}</ul>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
