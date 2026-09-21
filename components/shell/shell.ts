import type { SidebarData } from "@/lib/queries/sidebar";

/**
 * 폰·태블릿 셸의 규칙. 서버(레이아웃)와 브라우저가 함께 쓰므로 "use client" 를 붙이지 않는다 —
 * 클라이언트 모듈의 상수를 서버에서 import 하면 값이 아니라 참조가 온다.
 *
 * 폭 기준(Tailwind 기본값과 같다)
 *   ~767px   폰       메뉴는 서랍, 작업 상세·스레드는 화면을 덮는다
 *   768~1023 태블릿   메뉴는 서랍, 상세는 오른쪽에 겹쳐 뜬다
 *   1024~1279         메뉴는 붙어 있고(접을 수 있다), 상세는 겹쳐 뜬다
 *   1280~             지금까지의 PC 화면
 */

/** 메뉴를 접었는지. 서버가 첫 화면부터 맞게 그리도록 쿠키에 둔다. */
export const SIDEBAR_COLLAPSED_COOKIE = "side_collapsed";

/** 이보다 좁으면 상세 창·스레드가 본문 옆에 붙지 못하고 겹친다(Tailwind xl 미만). */
export const OVERLAY_QUERY = "(max-width: 1279.98px)";

/** 이 폭부터 메뉴가 붙어 있을 수 있다(Tailwind lg). */
export const DOCK_QUERY = "(min-width: 1024px)";

/** 폰(Tailwind md 미만). 달력이 칸 달력 대신 점 달력 + 그날 목록이 된다. */
export const PHONE_QUERY = "(max-width: 767.98px)";

/**
 * 작업 상세·스레드 틀. 폰은 화면 전체, 768px 부터 오른쪽에 400px 로 겹쳐 뜨고,
 * 1280px 부터 지금처럼 본문 옆에 360px 로 붙는다. 뒤의 반투명 판은 겹칠 때만(md~xl) 부르는 쪽이 둔다.
 */
export const PANE_CLASS = [
  "fixed inset-0 z-30 flex w-full flex-col border-side-border bg-pane-bg",
  "md:left-auto md:w-[400px] md:border-l md:shadow-[-8px_0_24px_rgba(0,0,0,.16)]",
  "xl:relative xl:inset-auto xl:z-auto xl:w-[360px] xl:shrink-0 xl:shadow-none",
].join(" ");

/** 주소 → 사이드바에서 불이 들어올 줄의 열쇠 */
export function activeKeyOf(pathname: string): string {
  if (pathname.startsWith("/list/")) return `list:${pathname.slice("/list/".length).split("/")[0]}`;
  if (pathname.startsWith("/projects/")) return `project:${pathname.slice("/projects/".length).split("/")[0]}`;
  return pathname.replace(/^\//, "") || "calendar";
}

/** 위 줄 제목을 고르는 데 필요한 이름만. 사이드바 데이터 전체를 두 번 내려보내지 않는다. */
export type ShellNames = {
  inboxListId: string | null;
  lists: Record<string, string>;
  projects: Record<string, string>;
};

export function shellNames(data: SidebarData): ShellNames {
  const lists: Record<string, string> = {};
  for (const l of [...data.groups.flatMap((g) => g.lists), ...data.ungrouped, ...data.shared]) lists[l.id] = l.name;
  return {
    inboxListId: data.inboxListId,
    lists,
    projects: Object.fromEntries(data.projects.map((p) => [p.id, p.name])),
  };
}

/** 주소만으로 정해지는 화면 이름의 열쇠 — messages/<언어>/nav.json 의 `titles` 아래에 있다. */
export type ShellTitleKey =
  | "calendar"
  | "assigned"
  | "tasks"
  | "notifications"
  | "projects"
  | "reports"
  | "list";

const FIXED_TITLES = ["calendar", "assigned", "tasks", "notifications", "projects"] as const;

/**
 * 폰·태블릿 위 줄에 쓰는 지금 화면 이름.
 *
 * 목록·프로젝트 이름은 사용자가 지은 것이라 그대로 쓰고, 나머지는 열쇠를 `t` 로 옮긴다
 * (이 파일은 서버와 브라우저가 함께 쓰므로 번역기를 직접 만들지 않고 받는다).
 */
export function shellTitle(pathname: string, names: ShellNames, t: (key: ShellTitleKey) => string, appName: string): string {
  const key = activeKeyOf(pathname);
  if (key.startsWith("list:")) {
    const id = key.slice("list:".length);
    return id === names.inboxListId ? t("tasks") : (names.lists[id] ?? t("list"));
  }
  if (key.startsWith("project:")) return names.projects[key.slice("project:".length)] ?? t("projects");
  if (key.startsWith("reports")) return t("reports");
  const fixed = FIXED_TITLES.find((k) => k === key);
  // 아는 화면이 아니면 설치 이름을 그대로 — 브랜드는 번역하지 않는다(lib/brand.ts).
  return fixed ? t(fixed) : appName;
}

type Nav = {
  push: (href: string, options?: { scroll?: boolean }) => void;
  replace: (href: string, options?: { scroll?: boolean }) => void;
};

/**
 * 작업 상세·스레드를 연다(?task= / ?thread=).
 *
 * 넓은 화면에서는 옆에 붙는 창이라 기록을 남기지 않는다(replace). 좁은 화면에서는 창이
 * 본문을 덮으므로 기록을 남겨(push) 휴대폰의 '뒤로' 가 창 닫기가 되게 한다.
 */
export function openPanel(router: Nav, href: string): void {
  const covers =
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(OVERLAY_QUERY).matches;
  if (covers) router.push(href, { scroll: false });
  else router.replace(href, { scroll: false });
}
