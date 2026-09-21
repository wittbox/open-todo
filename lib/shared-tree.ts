/**
 * 공유된 목록을 사이드바에 내 목록처럼 그룹 트리로 놓는다.
 *
 * 예전에는 목록마다 두 줄(목록 / 주인 · 그룹)로 가나다순이라 같은 그룹의 목록이 흩어졌다
 * (2026-09-14 요청). 이제 주인의 그룹 아래에 모으고, 그룹 밖 목록은 그 아래에 둔다 — 내 목록
 * 영역과 같은 배치다.
 *
 * 순서는 주인이 자기 사이드바에 둔 그대로다: 주인 이름 → 그룹 순서 → 목록 순서.
 * 그룹 id 로 묶으므로 이름이 같은 그룹이라도 주인이 다르면 따로 모인다.
 */

export type SharedGroup<T> = { id: string; name: string; ownerName: string; lists: T[] };
export type SharedTree<T> = { groups: SharedGroup<T>[]; lists: T[] };

export type SharedRow<T> = {
  item: T;
  /** 주인 사이드바에서의 목록 순서 */
  order: string;
  ownerName: string;
  /** 주인 쪽 그룹. 그룹 밖 목록이면 null. */
  group: { id: string; name: string; order: string } | null;
};

const byOrder = (a: { order: string }, b: { order: string }) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : 0;
const byOwner = (a: { ownerName: string }, b: { ownerName: string }) =>
  a.ownerName.localeCompare(b.ownerName, "ko");

export function arrangeShared<T>(rows: SharedRow<T>[]): SharedTree<T> {
  const groups = new Map<string, { id: string; name: string; order: string; ownerName: string; rows: SharedRow<T>[] }>();
  const loose: SharedRow<T>[] = [];

  for (const r of rows) {
    if (!r.group) {
      loose.push(r);
      continue;
    }
    const g = groups.get(r.group.id) ?? { ...r.group, ownerName: r.ownerName, rows: [] };
    g.rows.push(r);
    groups.set(r.group.id, g);
  }

  return {
    groups: [...groups.values()]
      .sort((a, b) => byOwner(a, b) || byOrder(a, b))
      .map((g) => ({
        id: g.id,
        name: g.name,
        ownerName: g.ownerName,
        lists: [...g.rows].sort(byOrder).map((r) => r.item),
      })),
    lists: [...loose].sort((a, b) => byOwner(a, b) || byOrder(a, b)).map((r) => r.item),
  };
}
