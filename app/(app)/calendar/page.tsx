import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/brand-server";
import { requireUserId } from "@/lib/session";
import { getCalendarView } from "@/lib/queries/tasks";
import { getTaskDetail } from "@/lib/queries/list";
import { getListRole, ROLE_RANK } from "@/lib/permissions";
import { dateOnlyToString } from "@/lib/date";
import { CALENDAR_PREFS_COOKIE, parseFrom, parsePrefs, projectRepeats, weekGrid } from "@/lib/calendar";
import { CalendarView } from "@/components/calendar/CalendarView";
import { DetailPane } from "@/components/detail-pane/DetailPane";
import { listMyIssues } from "@/lib/queries/issues";
import { requestToday } from "@/lib/prefs";
import { holidayRegion } from "@/lib/holidays";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calendar");
  return { title: await pageTitle(t("title")) };
}

/**
 * 달력. 기한이 있는 작업을 날짜 칸에 올린다. 앱의 첫 화면이다(lib/home.ts).
 *
 * 5주를 본다 — 처음에는 지난 1주 · 이번 주 · 앞으로 3주(lib/calendar.ts 의 weekGrid).
 * 위에 '지난 기한' 줄이 붙는다 — 보는 기간과 상관없이 기한이 지난 미완료 작업 전부.
 *
 * 칸 범위와 반복 다음 회차는 여기(서버)서 계산하고, 칸 안 배치·끌어 놓기·추가는
 * CalendarView 가 한다. 작업을 누르면 목록 화면과 같은 상세 창이 오른쪽에 붙는다.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const userId = await requireUserId();
  const q = await searchParams;
  const today = await requestToday();
  const grid = weekGrid(parseFrom(q, today));
  const from = dateOnlyToString(grid.start);

  const [data, jar, issues] = await Promise.all([
    getCalendarView(userId, grid.start, grid.end, today),
    cookies(),
    // 내가 맡은 열린 이슈 중 기한이 보이는 5주 안인 것
    listMyIssues(userId, { from: grid.start, to: grid.end }),
  ]);
  const prefs = parsePrefs(jar.get(CALENDAR_PREFS_COOKIE)?.value);
  const ghosts = projectRepeats([...data.tasks, ...data.repeatSources], grid.start, grid.end, today);

  const selectedId = typeof q.task === "string" ? q.task : null;
  const detail = selectedId ? await getTaskDetail(userId, selectedId) : null;
  const detailRole = detail ? await getListRole(userId, detail.listId) : null;

  return (
    <>
      <CalendarView
        key={from}
        from={from}
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
        issues={issues}
        holidays={holidayRegion()}
      />
      {detail && detailRole && (
        <DetailPane key={detail.id} task={detail} canWrite={ROLE_RANK[detailRole] >= ROLE_RANK.EDITOR} />
      )}
    </>
  );
}
