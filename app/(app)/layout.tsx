import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getSidebarData } from "@/lib/queries/sidebar";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { AppShell } from "@/components/shell/AppShell";
import { SIDEBAR_COLLAPSED_COOKIE, shellNames } from "@/components/shell/shell";

/**
 * 3분할 셸의 왼쪽 두 칸. 오른쪽 상세 패널은 목록 화면이 직접 붙인다.
 * 좁은 화면에서는 사이드바가 서랍이 되고 위 줄이 생긴다(components/shell/AppShell.tsx).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await readSession();
  // 쿠키는 있는데 끊긴 세션이면 쿠키부터 치운다(그리고 왜 로그아웃됐는지 알려 준다).
  if (!session.userId) redirect(session.problem ? "/auth/signout" : "/login");
  const userId = session.userId;

  const [data, jar] = await Promise.all([getSidebarData(userId), cookies()]);
  if (!data) redirect("/login");

  return (
    <AppShell
      names={shellNames(data)}
      unreadCount={data.unreadCount}
      initialCollapsed={jar.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1"}
      sidebar={<Sidebar data={data} />}
    >
      {children}
    </AppShell>
  );
}
