/**
 * 작업이 든 곳의 이름 — `그룹 › 목록`, 그룹 밖 목록이면 목록 이름만.
 *
 * 주간보고서의 묶음 이름(lib/report/aggregate.ts)과 같은 모양이다. 여러 목록이 섞이는
 * 화면(달력·나에게 할당됨)에서 같은 이름의 목록('2026년 9월' 등)이
 * 여러 그룹에 있어도 구별되게 한다.
 */
export function listPath(groupName: string | null | undefined, listName: string): string {
  return groupName ? `${groupName} › ${listName}` : listName;
}
