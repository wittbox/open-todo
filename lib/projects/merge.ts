import type { MessageItem } from "@/lib/queries/project";

/**
 * 폴링으로 받은 메시지를 화면의 Map 에 합친다. 순수 함수 — 시험하기 쉽게 화면 밖에 둔다.
 *
 * 원글은 서버 행으로 바꿔 끼운다(답글 수는 서버가 센 값). 답글 없는 삭제 원글은 지운다.
 * 답글은 화면에 그리지 않고 `reply:{id}` 로만 기억하며 원글의 답글 수를 맞춘다 —
 * 단, 같은 묶음에 원글이 함께 왔으면 서버가 센 수에 이미 들어 있으니 더하지 않는다
 * (2026-09-16 확인 중 "답글 1개" 가 "2개" 로 보인 원인).
 */
export function mergeMessages(prev: Map<string, MessageItem>, items: MessageItem[]): Map<string, MessageItem> {
  if (items.length === 0) return prev;
  const next = new Map(prev);
  const rootsInBatch = new Set<string>();

  for (const m of items) {
    if (m.parentId) continue;
    rootsInBatch.add(m.id);
    if (m.deletedAt && m.replyCount === 0) next.delete(m.id);
    else next.set(m.id, m);
  }

  for (const m of items) {
    if (!m.parentId) continue;
    const parent = next.get(m.parentId);
    if (!parent) continue;
    const key = `reply:${m.id}`;
    const seen = next.has(key);
    const counted = rootsInBatch.has(m.parentId);
    if (!m.deletedAt && !seen) {
      next.set(key, m);
      if (!counted) next.set(m.parentId, { ...parent, replyCount: parent.replyCount + 1, lastReplyAt: m.createdAt });
    } else if (m.deletedAt && seen) {
      next.delete(key);
      if (!counted) next.set(m.parentId, { ...parent, replyCount: Math.max(0, parent.replyCount - 1) });
    }
  }
  return next;
}
