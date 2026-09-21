import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { requireUserId } from "@/lib/session";
import { getCalendarView } from "@/lib/queries/tasks";
import { getTaskDetail } from "@/lib/queries/list";
import { getListRole, ROLE_RANK } from "@/lib/permissions";
import { dateOnlyToString } from "@/lib/date";
import {
  CALENDAR_PREFS_COOKIE,
  monthGrid,
  monthKey,
  parseMonth,
  parsePrefs,
  projectRepeats,
} from "@/lib/calendar";
import { CalendarView } from "@/components/calendar/CalendarView";
import { DetailPane } from "@/components/detail-pane/DetailPane";
import { requestToday } from "@/lib/prefs";
import { holidayRegion } from "@/lib/holidays";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calendar");
  return { title: await pageTitle(t("title")) };
}

/**
 * 달력. 기한이 있는 작업을 날짜 칸에 올린다. 앱의 첫 화면이다(lib/home.ts).
 *
 * 위에 '지난 기한' 줄이 붙는다 — 보는 달과 상관없이 기한이 지난 미완료 작업 전부.
 *
 * 칸 범위와 반복 다음 회차는 여기(서버)서 계산하고, 칸 안 배치·끌어 놓기·추가는
 * CalendarView 가 한다. 작업을 누르면 목록 화면과 같은 상세 창이 오른쪽에 붙는다.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const userId = await requireUserId();
  const q = await searchParams;
  const today = await requestToday();
  const month = parseMonth(q.month, today);
  const grid = monthGrid(month);

  const [data, jar] = await Promise.all([getCalendarView(userId, grid.start, grid.end, today), cookies()]);
  const prefs = parsePrefs(jar.get(CALENDAR_PREFS_COOKIE)?.value);
  const ghosts = projectRepeats([...data.tasks, ...data.repeatSources], grid.start, grid.end, today);

  const selectedId = typeof q.task === "string" ? q.task : null;
  const detail = selectedId ? await getTaskDetail(userId, selectedId) : null;
  const detailRole = detail ? await getListRole(userId, detail.listId) : null;

  return (
    <>
      <CalendarView
        key={monthKey(month)}
        month={monthKey(month)}
        today={dateOnlyToString(today)}
        weeks={grid.weeks}
        tasks={data.tasks}
        ghosts={ghosts}
        ghostSources={data.repeatSources}
        overdue={data.overdue}
        overdueMore={data.overdueMore}
        lists={data.lists}
        prefs={prefs}
        meId={userId}
        holidays={holidayRegion()}
      />
      {detail && detailRole && (
        <DetailPane key={detail.id} task={detail} canWrite={ROLE_RANK[detailRole] >= ROLE_RANK.EDITOR} />
      )}
    </>
  );
}
