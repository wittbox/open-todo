"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePoll } from "@/components/project/usePoll";

/** 이슈는 메시지만큼 급하지 않다 — 바뀜 표시만 묻는 가벼운 요청이라 이 정도면 충분하다. */
export const ISSUE_POLL_MS = 10_000;

/**
 * 이슈 화면 자동 새로고침. 남이 상태를 바꾸거나 댓글을 달면 몇 초 안에 목록·보드·열린 이슈에 보인다.
 *
 * 몇 초마다 '바뀜 표시'(issueStamp)만 묻고, 서버가 그린 화면의 것과 다를 때만 router.refresh() 한다 —
 * 아무 일 없을 때 목록 전체를 다시 그리지 않게. 탭이 숨겨져 있으면 쉬고, 돌아오면 바로 한 번(usePoll).
 * 다시 그려도 화면의 상태(거르기·보기·쓰던 댓글·고치던 본문)는 그대로다.
 */
export function useIssueRefresh(projectId: string, stamp: string) {
  const router = useRouter();
  // 서버가 그린 화면의 표시. 내 동작 뒤의 refresh 로 새 값이 내려오면 그것으로 바뀐다.
  const known = useRef(stamp);
  useEffect(() => {
    known.current = stamp;
  }, [stamp]);

  usePoll(async () => {
    const res = await fetch(`/api/projects/${projectId}/issues`, { cache: "no-store" });
    // 로그아웃·내보내짐은 다음 화면 이동이 처리한다. 여기서는 조용히 쉰다.
    if (!res.ok) return;
    const data = (await res.json()) as { stamp?: string };
    if (!data.stamp || data.stamp === known.current) return;
    known.current = data.stamp;
    router.refresh();
  }, ISSUE_POLL_MS);
}
