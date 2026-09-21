import type { ListSortBy } from "@/app/generated/prisma/enums";

/**
 * 정렬 메뉴에 나오는 차례. 문구는 화면이 `tasks.sort.<키>` 로 읽는다 —
 * 여기는 순수 함수만 두고 번역은 컴포넌트에 맡긴다.
 */
export const SORT_KEYS = ["MANUAL", "IMPORTANCE", "DUE_DATE", "ALPHABETICAL", "CREATED_AT"] as const satisfies readonly ListSortBy[];

type Sortable = {
  title: string;
  isImportant: boolean;
  /** "YYYY-MM-DD" 또는 null */
  dueDate: string | null;
  order: string;
  createdAt: string;
};

/**
 * 목록 정렬. 같은 순위일 때는 항상 수동 순서(order)로 갈라 결과가 흔들리지 않게 한다.
 * 기한 없는 작업은 어떤 기준에서도 뒤로 보낸다.
 */
export function sortTasks<T extends Sortable>(tasks: T[], sortBy: ListSortBy): T[] {
  const arr = [...tasks];
  const byOrder = (a: T, b: T) => a.order.localeCompare(b.order);

  switch (sortBy) {
    case "IMPORTANCE":
      return arr.sort((a, b) => Number(b.isImportant) - Number(a.isImportant) || byOrder(a, b));
    case "DUE_DATE":
      return arr.sort((a, b) => {
        if (a.dueDate === b.dueDate) return byOrder(a, b);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    case "ALPHABETICAL":
      return arr.sort((a, b) => a.title.localeCompare(b.title, "ko") || byOrder(a, b));
    case "CREATED_AT":
      return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byOrder(a, b));
    default:
      return arr.sort(byOrder);
  }
}
