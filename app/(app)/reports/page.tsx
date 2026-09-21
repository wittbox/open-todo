import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUserId } from "@/lib/session";
import { listReports, listSharedReports } from "@/lib/queries/report";
import { openReport } from "@/lib/actions/report";
import { addDays, currentWeekStart, dateOnlyToString } from "@/lib/date";
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

export default async function ReportsPage() {
  const userId = await requireUserId();
  const [reports, sharedReports] = await Promise.all([listReports(userId), listSharedReports(userId)]);

  const thisWeek = currentWeekStart(new Date(), await getRequestTimeZone());
  const format = await getFormatter();
  const t = await getTranslations("reports");
  const locale = await getLocale();
  const dateOf = (iso: string) => format.dateTime(new Date(iso), { year: "numeric", month: "numeric", day: "numeric" });
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * i));
  const existing = new Map(reports.map((r) => [r.weekStart, r]));

  async function open(formData: FormData) {
    "use server";
    const week = String(formData.get("week") ?? "");
    const res = await openReport(week);
    if (res.ok) redirect(`/reports/${res.data.id}`);
  }

  return (
    <section className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-pane-bg px-4 py-5 md:px-10 md:py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1.5 text-sm text-ink-2">
          {t("page.lead")}
        </p>

        <h2 className="mb-2 mt-8 text-sm font-semibold">{t("page.pickWeek")}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {weeks.map((w, i) => {
            const key = dateOnlyToString(w);
            const report = existing.get(key);
            return (
              <form action={open} key={key}>
                <input type="hidden" name="week" value={key} />
                <button className="flex w-full items-center gap-3 rounded border border-side-border bg-white px-4 py-3 text-left hover:bg-side-hover">
                  <Icon name="calendar" size={17} className="shrink-0 text-ink-2" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {shortDayLabel(w, locale)} ~ {shortDayLabel(addDays(w, 6), locale)}
                      {i === 0 && <span className="ml-2 text-xs text-link">{t("page.thisWeek")}</span>}
                      {i === 1 && <span className="ml-2 text-xs text-ink-2">{t("page.lastWeek")}</span>}
                    </span>
                    <span className="block truncate text-xs text-ink-2">
                      {report ? report.title : t("page.notCreated")}
                    </span>
                  </span>
                  {report?.publishedAt && (
                    <span className="shrink-0 rounded-full bg-[#dff6dd] px-2.5 py-0.5 text-[11px] text-[#0b6a0b]">
                      {t("page.published")}
                    </span>
                  )}
                </button>
              </form>
            );
          })}
        </div>

        <h2 className="mb-2 mt-9 text-sm font-semibold">{t("page.mine", { count: reports.length })}</h2>
        {reports.length === 0 ? (
          <p className="rounded border border-side-border bg-white px-4 py-6 text-center text-sm text-ink-2">
            {t("page.noneMine")}
          </p>
        ) : (
          <ul className="divide-y divide-divider overflow-hidden rounded border border-side-border bg-white">
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-side-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.title}</span>
                    <span className="block text-xs text-ink-2">
                      {r.weekStart}
                      {r.publishedAt && ` · ${t("page.publishedAt", { date: dateOf(r.publishedAt) })}`}
                      {r.sharedWithCount > 0 && ` · ${t("page.sharedCount", { count: r.sharedWithCount })}`}
                      {r.sendCount > 0 && ` · ${t("page.sendCount", { count: r.sendCount })}`}
                    </span>
                  </span>
                  {r.sharedWithCount > 0 && <Icon name="share" size={15} className="shrink-0 text-ink-2" />}
                  <Icon name="chevronRight" size={15} className="shrink-0 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <h2 className="mb-2 mt-9 text-sm font-semibold">
          {t("page.sharedWithMe", { count: sharedReports.length })}
        </h2>
        {sharedReports.length === 0 ? (
          <p className="rounded border border-side-border bg-white px-4 py-6 text-center text-sm text-ink-2">
            {t("page.noneShared")}
          </p>
        ) : (
          <ul className="divide-y divide-divider overflow-hidden rounded border border-side-border bg-white">
            {sharedReports.map((r) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-side-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.title}</span>
                    <span className="block text-xs text-ink-2">
                      {r.authorName} · {r.weekStart} · {t("page.published")}{" "}
                      {dateOf(r.publishedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-pane-bg px-2 py-0.5 text-[11px] text-ink-2">
                    {t("page.readOnly")}
                  </span>
                  <Icon name="chevronRight" size={15} className="shrink-0 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
