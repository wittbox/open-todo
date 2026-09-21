import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * 그룹 / 목록 / 작업 / 세부 단계의 정렬 순서.
 *
 * 정수 인덱스를 쓰면 항목 하나를 드래그할 때마다 뒤따르는 행을 전부 갱신해야 한다.
 * fractional index는 인접한 두 값 사이의 문자열을 새로 만들어 한 행만 UPDATE 하면 된다.
 */

/** 목록의 맨 앞에 넣을 순서값 */
export function orderBefore(first: string | null): string {
  return generateKeyBetween(null, first);
}

/** 목록의 맨 뒤에 붙일 순서값 */
export function orderAfter(last: string | null): string {
  return generateKeyBetween(last, null);
}

/** 두 항목 사이에 끼워 넣을 순서값 */
export function orderBetween(prev: string | null, next: string | null): string {
  return generateKeyBetween(prev, next);
}

/** 시드/일괄 생성용 — 연속된 순서값 n개 */
export function orderSequence(n: number, after: string | null = null): string[] {
  return generateNKeysBetween(after, null, n);
}

/** DB에서 읽은 배열을 order 기준으로 정렬 (문자열 비교로 충분하다) */
export function sortByOrder<T extends { order: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}
