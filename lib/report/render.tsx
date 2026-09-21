"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import {
  type ReportContent,
  type ReportTask,
  type SectionKey,
  type SectionReason,
} from "@/lib/report/aggregate";

/**
 * 편집 화면에서만 붙는 도구.
 *
 * 없으면 읽기 전용이다 — 발행본과 공유받은 보고서는 이 값을 넘기지 않으므로
 * 예전과 똑같이 그려진다.
 */
export type ReportBodyEditing = {
  comments: Record<string, string>;
  onExclude: (taskId: string) => void;
  onComment: (taskId: string, text: string) => void;
  /** 자동 분류가 틀렸을 때 반대 구간으로 옮긴다. 완료 구간에는 주지 않는다. */
  onMoveSection: (taskId: string, to: Exclude<SectionKey, "done">) => void;
};

/**
 * 보고서 본문(웹). 편집 화면 미리보기와 공개 페이지가 같은 컴포넌트를 쓴다.
 * 메일은 같은 ReportContent 를 받아 lib/report/email.ts 가 표 레이아웃으로 다시 그린다.
 * 두 렌더러가 갈라지지 않는 이유는 마크업을 공유해서가 아니라 입력 데이터가 하나이기 때문이다.
 */
export function ReportBody({
  content,
  baseUrl,
  editing,
}: {
  content: ReportContent;
  /** 작업 번호를 딥링크로 걸 주소. 없으면 링크 없이 번호만 보여준다. */
  baseUrl?: string;
  editing?: ReportBodyEditing;
}) {
  const tr = useTranslations("reports");
  const empty = content.sections.every((s) => s.groups.length === 0);

  return (
    <div>
      {content.summary.trim() && (
        <p className="mb-6 whitespace-pre-wrap text-sm leading-relaxed text-[#3b3a39]">{content.summary}</p>
      )}

      {empty && <p className="py-8 text-center text-sm text-ink-2">{tr("body.empty")}</p>}

      {content.sections.map((section) =>
        section.groups.length === 0 ? null : (
          <section key={section.key} className="mb-6">
            <h2 className="mb-2 border-b-2 border-[#4f52b2] pb-1.5 text-[15px] font-semibold">
              {section.label}
              <span className="ml-2 text-xs font-normal text-ink-2">
                {tr("body.count", { count: section.groups.reduce((n, g) => n + g.tasks.length, 0) })}
              </span>
            </h2>

            {section.groups.map((group) => (
              <div key={`${group.owner ?? ""} ${group.path}`}>
                <div className="mb-1 mt-3 text-xs text-ink-2">
                  {group.path}
                  {group.owner && <span className="text-ink-3"> · {group.owner}</span>}
                </div>
                {group.tasks.map((t) => (
                  <ReportRow
                    key={t.id}
                    t={t}
                    sectionKey={section.key}
                    baseUrl={baseUrl}
                    editing={editing}
                  />
                ))}
              </div>
            ))}
          </section>
        ),
      )}
    </div>
  );
}

/**
 * 왜 이 줄이 이 구간에 들어왔는지. 편집 화면에서만 보인다 —
 * 자동 분류가 틀렸을 때 이유를 알아야 옮길지 판단할 수 있다.
 * 발행본과 메일에는 나오지 않는다.
 */
function ReasonBadge({ reason, section }: { reason: SectionReason; section: SectionKey }) {
  const label = useTranslations("reports.reasons");
  // 완료 구간은 이유가 하나뿐이라 적을 것이 없다.
  if (section === "done") return null;
  const tone =
    reason === "manual"
      ? "bg-[#f3f2f1] text-ink-2"
      : section === "inProgress"
        ? "bg-[#eff6ef] text-[#0b6a0b]"
        : "bg-[#eff4fc] text-[#1b4b9b]";
  return <span className={`ml-1.5 rounded-full px-1.5 text-[11px] align-[1px] ${tone}`}>{label(reason)}</span>;
}

/**
 * 보고서 한 줄. 편집 화면에서는 코멘트를 그 자리에서 고친다.
 *
 * 코멘트는 평소에 글자로만 보인다 — 발행본·메일과 같은 모양이어야 쓰는 사람이 받는
 * 사람과 같은 것을 본다. 예전에는 코멘트가 있으면 입력칸을 늘 그려서, 저장해도
 * 입력칸과 기울임 글자로 같은 문장이 두 번 보였다.
 */
function ReportRow({
  t,
  sectionKey,
  baseUrl,
  editing,
}: {
  t: ReportTask;
  sectionKey: SectionKey;
  baseUrl?: string;
  editing?: ReportBodyEditing;
}) {
  const tr = useTranslations("reports");
  const [commenting, setCommenting] = useState(false);
  const saved = editing?.comments[t.id] ?? "";

  function finish(text: string | null) {
    setCommenting(false);
    // null 은 취소. 바뀌지 않았으면 저장하지 않는다. 비우면 코멘트가 사라진다.
    if (editing && text !== null && text.trim() !== saved.trim()) editing.onComment(t.id, text);
  }

  return (
    <div className="group/row flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-divider py-1.5 pl-1">
      {/* 번호는 오른쪽에 붙인다. 폭을 고정해 제목이 세로로 맞으면서도
          #3 처럼 짧은 번호 뒤가 벌어지지 않는다. */}
      <span className="w-10 shrink-0 text-right font-mono text-[12.5px] text-link">
        {baseUrl ? (
          <a href={`${baseUrl}/t/${t.seq}`} className="hover:underline">#{t.seq}</a>
        ) : (
          <>#{t.seq}</>
        )}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        {t.title}
        {editing && <ReasonBadge reason={t.reason} section={sectionKey} />}
        {editing && (
          <RowTools
            // 완료는 사실이라 옮길 곳이 없다. 나머지는 반대편으로 보낸다.
            moveTo={sectionKey === "done" ? null : sectionKey === "inProgress" ? "upcoming" : "inProgress"}
            onMove={(to) => editing.onMoveSection(t.id, to)}
            onExclude={() => editing.onExclude(t.id)}
            onComment={() => setCommenting((v) => !v)}
          />
        )}
      </span>
      <span className="ml-auto shrink-0 whitespace-nowrap pl-3 text-xs text-ink-2">
        {[t.assignee, t.stepTotal > 0 ? `${t.stepDone}/${t.stepTotal}` : null, t.dueLabel]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {t.steps.length > 0 && (
        <div className="basis-full pl-6 md:pl-12 text-[12.5px] leading-relaxed text-ink-2">
          └ {t.steps.join(" · ")}
        </div>
      )}
      {editing && commenting ? (
        <CommentInput initial={saved || t.comment || ""} onDone={finish} />
      ) : t.comment ? (
        editing ? (
          <button
            type="button"
            onClick={() => setCommenting(true)}
            title={tr("body.editTitle")}
            className="basis-full cursor-text rounded pl-6 md:pl-12 text-left text-[12.5px] italic leading-relaxed text-ink-2 hover:bg-[#f7f7f7] hover:outline-1 hover:outline-dashed hover:outline-[#d6d4d2]"
          >
            {t.comment}
          </button>
        ) : (
          <div className="basis-full pl-6 md:pl-12 text-[12.5px] italic leading-relaxed text-ink-2">{t.comment}</div>
        )
      ) : null}
    </div>
  );
}

/**
 * 코멘트 입력칸. Enter·바깥 클릭은 저장, Esc 는 취소.
 *
 * 한글은 조합 중에 Enter 가 한 번 더 들어온다. 그걸 저장으로 받으면 마지막 글자가
 * 잘린 채 저장된다 — 조합이 끝난 Enter 만 받는다.
 */
function CommentInput({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
  const tr = useTranslations("reports");
  const done = useRef(false);
  const finish = (v: string | null) => {
    // Esc 로 닫히는 순간 blur 가 한 번 더 올 수 있다. 처음 한 번만 받는다.
    if (done.current) return;
    done.current = true;
    onDone(v);
  };

  return (
    <div className="basis-full pl-6 md:pl-12">
      <input
        autoFocus
        defaultValue={initial}
        placeholder={tr("body.commentPlaceholder")}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            finish(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
        className="mt-1 block w-full rounded border border-link px-2 py-1 text-[12.5px] italic outline-none"
      />
    </div>
  );
}

/**
 * 줄 위의 도구. 평소에는 숨어 있다가 마우스를 올리면 나온다 —
 * 보고서는 읽는 화면이므로 도구가 늘 보이면 글이 아니라 표처럼 읽힌다.
 */
function RowTools({
  moveTo,
  onMove,
  onExclude,
  onComment,
}: {
  /** 옮겨 갈 구간. null 이면 옮기기 버튼을 내지 않는다(완료). */
  moveTo: Exclude<SectionKey, "done"> | null;
  onMove: (to: Exclude<SectionKey, "done">) => void;
  onExclude: () => void;
  /** 코멘트 입력칸을 연다/닫는다 */
  onComment: () => void;
}) {
  const tr = useTranslations("reports");
  return (
    <span className="ml-2 inline-flex gap-2 align-middle opacity-0 transition-opacity group-hover/row:opacity-100 pointer-coarse:opacity-100">
      {moveTo && (
        <button
          type="button"
          onClick={() => onMove(moveTo)}
          className="text-[11.5px] text-ink-3 hover:text-link"
        >
          {moveTo === "upcoming" ? tr("body.moveToUpcoming") : tr("body.moveToInProgress")}
        </button>
      )}
      <button type="button" onClick={onComment} className="text-[11.5px] text-ink-3 hover:text-link">
        {tr("body.comment")}
      </button>
      <button
        type="button"
        onClick={onExclude}
        aria-label={tr("body.excludeAria")}
        className="text-[11.5px] text-ink-3 hover:text-danger"
      >
        {tr("body.exclude")} <Icon name="x" size={11} className="inline align-[-1px]" />
      </button>
    </span>
  );
}
