"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Face, LabelChip, PriorityMark, StatusPill } from "@/components/issues/IssueBits";
import { STATUSES } from "@/lib/issues/format";
import type { IssueItem, IssueLabelItem } from "@/lib/queries/issues";
import type { IssueStatus } from "@/app/generated/prisma/enums";

/**
 * 이슈 보드 — 상태별 칸. 카드를 다른 칸으로 끌면 상태가 바뀐다.
 * 닫힘 칸은 최근 7일 것만 — 오래 닫힌 이슈가 쌓이면 보드가 목록이 된다(전부는 목록의 '닫힘').
 * 끄는 동안의 위치는 화면이 먼저 옮겨 두고(onMove), 서버가 다시 그리면 그 값으로 맞춰진다.
 */

const CLOSED_DAYS = 7;

export function IssueBoard({
  issues,
  labels,
  selected,
  readOnly,
  onOpen,
  onMove,
}: {
  issues: IssueItem[];
  labels: Map<string, IssueLabelItem>;
  selected: number | null;
  readOnly: boolean;
  onOpen: (number: number) => void;
  onMove: (issue: IssueItem, to: IssueStatus) => void;
}) {
  const [dragging, setDragging] = useState<IssueItem | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );
  // 처음 그릴 때의 시각으로 고정한다 — 그릴 때마다 시계를 읽으면 같은 데이터가 다르게 그려질 수 있다.
  const [closedSince] = useState(() => Date.now() - CLOSED_DAYS * 86_400_000);
  const columns = STATUSES.map((status) => ({
    status,
    items: issues.filter(
      (i) => i.status === status && (status !== "CLOSED" || new Date(i.updatedAt).getTime() >= closedSince),
    ),
  }));

  function end(e: DragEndEvent) {
    setDragging(null);
    const to = e.over?.id as IssueStatus | undefined;
    const issue = issues.find((i) => i.id === e.active.id);
    if (issue && to && to !== issue.status) onMove(issue, to);
  }

  return (
    <DndContext
      id="issue-board"
      sensors={sensors}
      onDragStart={(e) => setDragging(issues.find((i) => i.id === e.active.id) ?? null)}
      onDragEnd={end}
      onDragCancel={() => setDragging(null)}
    >
      <div className="thin-scroll grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(220px,1fr))] gap-3 overflow-auto bg-side px-4 py-3 md:px-6">
        {columns.map((c) => (
          <Column key={c.status} status={c.status} count={c.items.length} closed={c.status === "CLOSED"}>
            {c.items.map((i) => (
              <Card
                key={i.id}
                issue={i}
                labels={labels}
                selected={selected === i.number}
                readOnly={readOnly}
                onOpen={() => onOpen(i.number)}
              />
            ))}
          </Column>
        ))}
      </div>
      <DragOverlay>{dragging && <CardFace issue={dragging} labels={labels} lifted />}</DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  count,
  closed,
  children,
}: {
  status: IssueStatus;
  count: number;
  closed: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("issues");
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      data-column={status}
      aria-label={t("board.column", { status: t(`status.${status}`) })}
      className={`flex min-h-[200px] flex-col rounded-md p-2 ${isOver ? "bg-[#eff6fc] outline-2 -outline-offset-2 outline-dashed outline-link" : "bg-pane-bg"}`}
    >
      <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[12.5px]">
        <StatusPill status={status} />
        <span className="text-ink-3">{closed ? t("board.closedRecent", { days: CLOSED_DAYS, count }) : count}</span>
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Card({
  issue,
  labels,
  selected,
  readOnly,
  onOpen,
}: {
  issue: IssueItem;
  labels: Map<string, IssueLabelItem>;
  selected: boolean;
  readOnly: boolean;
  onOpen: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: issue.id, disabled: readOnly });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-card={issue.number}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left"
        aria-current={selected ? "true" : undefined}
      >
        <CardFace issue={issue} labels={labels} selected={selected} />
      </button>
    </div>
  );
}

function CardFace({
  issue,
  labels,
  selected,
  lifted,
}: {
  issue: IssueItem;
  labels: Map<string, IssueLabelItem>;
  selected?: boolean;
  lifted?: boolean;
}) {
  const t = useTranslations("issues");
  return (
    <div
      className={`rounded border bg-white px-2.5 py-2 text-[12.5px] ${selected ? "border-link shadow-[0_0_0_1px_#2564cf]" : "border-[#e1dfdd]"} ${
        lifted ? "shadow-md" : ""
      } ${issue.status === "CLOSED" ? "opacity-70" : ""}`}
    >
      <span className="font-mono text-[11.5px] text-ink-2">{issue.ref}</span>
      <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug">{issue.title}</p>
      {issue.labelIds.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {issue.labelIds.map((id) => {
            const l = labels.get(id);
            return l ? <LabelChip key={id} name={l.name} color={l.color} /> : null;
          })}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between">
        <PriorityMark priority={issue.priority} />
        {issue.assignee ? (
          <Face name={issue.assignee.name} color={issue.assignee.avatarColor} size={20} />
        ) : (
          <span className="text-[11px] text-ink-3">{t("board.unassigned")}</span>
        )}
      </div>
    </div>
  );
}
