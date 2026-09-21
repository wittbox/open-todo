"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { listPath } from "@/lib/list-path";
import type { TaskDetail } from "@/lib/queries/list";

/**
 * 이 작업이 든 곳 — `그룹 › 목록`. 상세 창 맨 윗줄, 닫기 버튼 왼쪽.
 *
 * 달력·나에게 할당됨처럼 여러 목록이 섞이는 화면에서 열면 어느 목록 작업인지 알 수
 * 없었다(2026-09-12 요청). 누르면 그 목록으로 가고 작업은 열린 채 남는다. 이미 그 목록
 * 화면이면 글자만 둔다. 공유받은 목록이면 누가 공유했는지 붙인다 — 사이드바의
 * 공유받은 목록 줄과 같은 정보다.
 */
export function ListPath({
  task,
  here,
  readOnly,
}: {
  task: Pick<TaskDetail, "id" | "listId" | "listName" | "groupName" | "listOwnerName">;
  /** 지금 그 목록 화면인가. 그러면 링크가 아니라 글자만. */
  here: boolean;
  readOnly: boolean;
}) {
  const t = useTranslations("tasks");
  const path = listPath(task.groupName, task.listName);
  const note = [
    task.listOwnerName && t("path.sharedBy", { name: task.listOwnerName }),
    readOnly && t("path.readOnly"),
  ]
    .filter(Boolean)
    .join(" · ");
  const base = "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] text-ink-2";
  const body = (
    <>
      <Icon name="list" size={14} className="shrink-0" />
      {task.groupName && (
        <>
          {/* 이름이 길면 그룹부터 줄인다 — 목록 이름이 더 중요하다. */}
          <span className="max-w-[130px] truncate">{task.groupName}</span>
          <span className="text-ink-3">›</span>
        </>
      )}
      <span className="truncate font-semibold text-ink">{task.listName}</span>
    </>
  );

  return (
    <>
      {here ? (
        <span title={path} className={base}>
          {body}
        </span>
      ) : (
        <Link
          href={`/list/${task.listId}?task=${task.id}`}
          title={t("path.goToList", { path })}
          className={`${base} hover:bg-side-hover`}
        >
          {body}
        </Link>
      )}
      {note && (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-[#e6e4e2] px-1.5 text-[11px] text-ink-2">
          {note}
        </span>
      )}
    </>
  );
}
