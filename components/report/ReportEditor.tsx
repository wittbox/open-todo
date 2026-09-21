"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { ReportBody } from "@/lib/report/render";
import {
  buildReport,
  nextSectionOverride,
  type ReportContent,
  type SectionKey,
  type SourceTask,
} from "@/lib/report/aggregate";
import { cancelScheduledSend, publishReport, unpublishReport, updateReport } from "@/lib/actions/report";
import { ReportShareDialog, type ShareMember } from "@/components/report/ReportShareDialog";
import { UNGROUPED_SCOPE_ID } from "@/lib/report/aggregate";
import { reportPdfFileName } from "@/lib/report/filename";
import { Calendar } from "@/components/ui/calendar";
import { shortDayLabel } from "@/lib/format";
import { checkScheduleAt, earliestSlot, slotToInstant, scheduleLabel, timeSlots } from "@/lib/report/schedule";
import type { GroupOption, ReportScope } from "@/lib/queries/report";
import type { UserHit } from "@/lib/queries/share";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import { useFormatter, useLocale, useTimeZone, useTranslations } from "next-intl";

export type SendLog = {
  id: string;
  toEmails: string[];
  sentAt: string;
  status: string;
  errorMsg: string | null;
  /** 예약한 시각. 지금 보낸 것은 null */
  scheduledAt: string | null;
  attachPdf: boolean;
};

export function ReportEditor({
  reportId,
  authorName,
  weekStart,
  initialTitle,
  initialSummary,
  scope: initialScope,
  groups,
  tasks,
  publishedAt,
  baseUrl,
  sends,
  sharedWith,
}: {
  reportId: string;
  /** 첨부 PDF 이름에 들어간다 */
  authorName: string;
  weekStart: string;
  initialTitle: string;
  initialSummary: string;
  scope: ReportScope;
  groups: GroupOption[];
  tasks: SourceTask[];
  publishedAt: string | null;
  baseUrl: string;
  sends: SendLog[];
  sharedWith: ShareMember[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [scope, setScope] = useState<ReportScope>(initialScope);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const weekStartDate = useMemo(() => new Date(`${weekStart}T00:00:00.000Z`), [weekStart]);

  const tz = useTimeZone();
  const locale = useLocale();
  const format = useFormatter();
  const t = useTranslations("reports");

  // 편집 중에는 서버를 기다리지 않고 화면에서 바로 다시 집계한다. 주 범위는 작성자 시간대로 자른다(서버와 같게).
  const preview: ReportContent = useMemo(
    () =>
      buildReport(
        // 서버(getReportSource)와 같은 규칙. 그룹 없는 목록은 전용 id 로 고른다.
        tasks.filter((t) =>
          scope.allGroups ? true : scope.groupIds.includes(t.groupId ?? UNGROUPED_SCOPE_ID),
        ),
        weekStartDate,
        {
          timeZone: tz,
          locale,
          title,
          summary,
          excludedTaskIds: scope.excludedTaskIds,
          comments: scope.comments,
          sections: scope.sections,
        },
      ),
    [tasks, scope, weekStartDate, title, summary, tz, locale],
  );

  function save(patch: { title?: string; summary?: string; scope?: Partial<ReportScope> }) {
    startTransition(async () => {
      const res = await runAction(() => updateReport(reportId, patch));
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
    });
  }

  function setScopeAndSave(next: ReportScope) {
    setScope(next);
    save({ scope: next });
  }

  function toggleExclude(taskId: string) {
    const has = scope.excludedTaskIds.includes(taskId);
    setScopeAndSave({
      ...scope,
      excludedTaskIds: has
        ? scope.excludedTaskIds.filter((x) => x !== taskId)
        : [...scope.excludedTaskIds, taskId],
    });
  }

  /** 자동 분류를 손으로 바로잡는다. 이 보고서에만 남고 작업 자체는 건드리지 않는다. */
  function moveSection(taskId: string, to: Exclude<SectionKey, "done">) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setScopeAndSave({
      ...scope,
      sections: nextSectionOverride(task, weekStartDate, to, scope.sections, tz),
    });
  }

  const allGroupIds = groups.map((g) => g.id);

  /** '전체' 는 켜고 끄는 하나의 스위치다. 끄면 아무것도 안 고른 상태가 된다. */
  function toggleAll() {
    setScopeAndSave({ ...scope, allGroups: !scope.allGroups, groupIds: [] });
  }

  function toggleGroup(id: string) {
    // '전체' 상태에서 하나를 빼면 "그것만 빼고 나머지 전부"다.
    // 예전에는 여기서 그 하나만 남아서, 해제하려다 나머지가 통째로 사라졌다.
    const selected = scope.allGroups ? allGroupIds : scope.groupIds;
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];

    setScopeAndSave({
      ...scope,
      // 다시 전부 고르면 '전체' 로 되돌아간다 — 체크 모양과 뜻이 어긋나지 않게.
      allGroups: next.length === allGroupIds.length,
      groupIds: next.length === allGroupIds.length ? [] : next,
    });
  }

  // 본문에서 빠진 것들. 되돌릴 자리가 없으면 뺀 순간 사라져 버린다.
  const excluded = tasks.filter((t) => scope.excludedTaskIds.includes(t.id));

  return (
    <section className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-pane-bg">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-side-border bg-side-bg px-4 py-3 md:px-7 md:py-3.5">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <span className="text-[13px] text-ink-2">{preview.rangeLabel}</span>
        {/* 좁은 화면에서 글자가 한 자씩 꺾이지 않게 버튼은 통째로 다음 줄로 넘긴다. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 whitespace-nowrap">
          {publishedAt ? (
            <span className="rounded-full bg-[#dff6dd] px-2.5 py-1 text-xs text-[#0b6a0b]">
              {t("editor.publishedOn", { date: format.dateTime(new Date(publishedAt), { year: "numeric", month: "numeric", day: "numeric" }) })}
            </span>
          ) : (
            <span className="rounded-full bg-[#fff4ce] px-2.5 py-1 text-xs text-[#7a5a00]">{t("editor.draft")}</span>
          )}
          <button
            disabled={!publishedAt}
            onClick={() => setShareOpen(true)}
            title={publishedAt ? t("editor.shareTitle") : t("editor.shareAfterPublish")}
            className="h-8 rounded border border-[#8a8886] bg-white px-3 text-sm hover:bg-side-hover disabled:cursor-default disabled:opacity-50"
          >
            {t("editor.share")} {sharedWith.length > 0 && `(${sharedWith.length})`}
          </button>
          <button
            onClick={() => {
              if (publishedAt && !window.confirm(t("editor.republishConfirm"))) return;
              startTransition(async () => {
                const res = await runAction(() => publishReport(reportId));
                if (!res.ok && !handledAuthFailure(res)) setError(res.error);
                else setToast(t("editor.publishedToast"));
                router.refresh();
              });
            }}
            className="h-8 rounded bg-link px-4 text-sm text-white hover:brightness-95"
          >
            {publishedAt ? t("editor.republish") : t("editor.publish")}
          </button>
          <button
            disabled={!publishedAt}
            onClick={() => setSendOpen(true)}
            className="h-8 rounded border border-[#8a8886] bg-white px-3 text-sm hover:bg-side-hover disabled:cursor-default disabled:opacity-50"
            title={publishedAt ? t("editor.sendTitle") : t("editor.sendAfterPublish")}
          >
            {t("editor.sendMail")}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger md:mx-7">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><Icon name="x" size={13} /></button>
        </div>
      )}

      {/* 1280px 보다 좁으면 편집 칸(제목·요약·범위)을 보고서 아래로 내린다 — 옆에 두면 본문이 400px 남짓이 된다. */}
      <div className="grid grid-cols-1 items-start gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* 집계 결과 + 편집 */}
        <div className="px-3 py-4 md:px-7 md:py-6">
          <div className="rounded border border-side-border bg-white px-4 py-4 md:px-7 md:py-6">
            <ReportBody
              content={preview}
              baseUrl={baseUrl}
              editing={{
                comments: scope.comments,
                onExclude: toggleExclude,
                onComment: (taskId, text) =>
                  setScopeAndSave({ ...scope, comments: { ...scope.comments, [taskId]: text } }),
                onMoveSection: moveSection,
              }}
            />
          </div>

          {excluded.length > 0 && (
            <div className="mt-4 rounded border border-side-border bg-white px-4 py-4 md:px-7">
              <p className="mb-1.5 text-xs text-ink-2">{t("editor.excluded", { count: excluded.length })}</p>
              {excluded.map((task) => (
                <div key={task.id} className="flex items-baseline gap-2 py-1 text-sm text-ink-3">
                  <span className="w-10 shrink-0 text-right font-mono text-[12.5px]">#{task.seq}</span>
                  <span className="min-w-0 flex-1 truncate line-through">{task.title}</span>
                  <button
                    onClick={() => toggleExclude(task.id)}
                    className="shrink-0 text-[11.5px] text-link hover:underline"
                  >
                    {t("editor.restore")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {sends.length > 0 && (
            <>
              <h2 className="mb-2 mt-7 text-sm font-semibold">{t("editor.sendHistory")}</h2>
              <ul className="overflow-hidden rounded border border-side-border bg-white text-sm">
                {sends.map((s) => (
                  <SendHistoryItem key={s.id} s={s} reportId={reportId} />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* 편집 컨트롤 */}
        <aside className="border-t border-side-border bg-side-bg px-4 py-6 md:px-7 xl:sticky xl:top-[57px] xl:border-l xl:border-t-0 xl:px-5">
          <h3 className="mb-1.5 text-[13px] font-semibold">{t("editor.titleLabel")}</h3>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== initialTitle && save({ title })}
            className="h-[34px] w-full rounded border border-[#d6d4d2] px-2.5 text-sm outline-none focus:border-link"
          />

          <h3 className="mb-1.5 mt-5 text-[13px] font-semibold">{t("editor.summaryLabel")}</h3>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={() => summary !== initialSummary && save({ summary })}
            placeholder={t("editor.summaryPlaceholder")}
            className="min-h-[96px] w-full resize-y rounded border border-[#d6d4d2] p-2 text-[13px] outline-none focus:border-link"
          />

          <h3 className="mb-1.5 mt-5 text-[13px] font-semibold">{t("editor.scopeLabel")}</h3>
          {groups.length === 0 ? (
            <p className="text-xs text-ink-2">{t("editor.noGroups")}</p>
          ) : (
            <>
              <label className="mb-1 flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={scope.allGroups} onChange={toggleAll} />
                {t("editor.all")}
              </label>
              {groups.map((g) => (
                <label key={g.id} className="mb-1 flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={scope.allGroups || scope.groupIds.includes(g.id)}
                    onChange={() => toggleGroup(g.id)}
                  />
                  {g.name}
                </label>
              ))}
            </>
          )}

          <p className="mt-5 text-xs leading-relaxed text-ink-2">
            {t.rich("editor.publishNote", { b: (chunks) => <b>{chunks}</b> })}
          </p>

          {publishedAt && (
            <button
              onClick={() => {
                if (!window.confirm(t("editor.unpublishConfirm"))) return;
                startTransition(async () => {
                  const res = await runAction(() => unpublishReport(reportId));
                  if (!res.ok && !handledAuthFailure(res)) setError(res.error);
                  router.refresh();
                });
              }}
              className="mt-4 text-xs text-danger hover:underline"
            >
              {t("editor.unpublish")}
            </button>
          )}
        </aside>
      </div>

      {shareOpen && (
        <ReportShareDialog
          reportId={reportId}
          members={sharedWith}
          onClose={() => {
            setShareOpen(false);
            router.refresh();
          }}
        />
      )}

      {sendOpen && (
        <SendDialog
          reportId={reportId}
          authorName={authorName}
          preview={preview}
          onClose={() => setSendOpen(false)}
          onSent={(msg) => {
            setSendOpen(false);
            setToast(msg);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded bg-ink px-4 py-2.5 text-[13px] text-white shadow-lg">
          {toast}
          <button onClick={() => setToast(null)} className="ml-3 opacity-70">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
    </section>
  );
}

/** 되돌릴 수 없는 외부 발신이므로 수신자와 내용을 한 번 더 확인시킨다. */
function SendDialog({
  reportId,
  authorName,
  preview,
  onClose,
  onSent,
}: {
  reportId: string;
  authorName: string;
  preview: ReportContent;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [raw, setRaw] = useState("");
  // 본문과 같은 내용을 PDF 로도 붙인다. 기본은 켬 — 인쇄·결재·보관은 대개 PDF 로 한다.
  const [attachPdf, setAttachPdf] = useState(true);
  // 지금 / 예약. 기본은 지금 — 예약을 고를 때만 날짜와 시각이 나온다.
  const [mode, setMode] = useState<"now" | "later">("now");
  const tz = useTimeZone();
  const locale = useLocale();
  const t = useTranslations("reports");
  const tAll = useTranslations();
  const [slot, setSlot] = useState(() => earliestSlot(new Date(), tz));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<UserHit[]>([]);

  const recipients = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 마지막으로 입력 중인 조각만 가지고 찾는다. 앞의 것들은 이미 확정된 주소다.
  const typing = raw.split(/[,;\n]/).pop()?.trim() ?? "";

  // 주소를 다 적었으면 더 찾을 것이 없다.
  const searching = typing.length >= 1 && !typing.includes("@");

  useEffect(() => {
    if (!searching) return;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?self=1&q=${encodeURIComponent(typing)}`, {
          signal: ac.signal,
        });
        if (res.ok) setHits((await res.json()) as UserHit[]);
      } catch {
        /* 입력이 바뀌어 취소된 요청은 무시한다 */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [typing, searching]);

  // 찾는 중이 아닐 때는 지난 결과를 보여주지 않는다.
  const suggestions = searching ? hits : [];

  /** 고른 주소로 마지막 조각을 갈아 끼우고 쉼표를 붙여 다음 입력을 잇는다. */
  function pick(email: string) {
    const parts = raw.split(/([,;\n])/);
    let lastText = parts.length - 1;
    while (lastText >= 0 && /^[,;\n]$/.test(parts[lastText])) lastText -= 1;
    if (lastText < 0) parts.push(email);
    else parts[lastText] = email;
    setRaw(`${parts.join("")}, `);
    setHits([]);
  }

  const scheduleAt = mode === "later" ? slotToInstant(slot.day, slot.hhmm, tz) : null;

  async function send() {
    setError(null);
    // 서버도 같은 규칙으로 따진다. 여기서 먼저 막는 건 왕복 없이 바로 알려 주려는 것뿐이다.
    if (scheduleAt) {
      const check = checkScheduleAt(scheduleAt.toISOString(), new Date(), tz);
      if (!check.ok) {
        setError((tAll as unknown as (k: string, v?: Record<string, number>) => string)(check.key, check.values));
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipients, attachPdf, scheduleAt: scheduleAt?.toISOString() ?? null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? t("errors.sendFailed"));
        return;
      }
      if (body.scheduled) {
        onSent(t("send.scheduledToast", { when: scheduleLabel(new Date(body.scheduledAt), tz, locale), count: recipients.length }));
        return;
      }
      onSent(body.mock ? t("send.mockToast") : t("send.sentToast", { count: recipients.length }));
    } catch {
      setError(t("errors.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" onMouseDown={onClose} role="presentation">
      <div
        className="thin-scroll max-h-[86dvh] w-[520px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg bg-white p-6 shadow-[0_25.6px_57.6px_rgba(0,0,0,.22)]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("send.aria")}
      >
        <h3 className="text-lg font-semibold">{t("send.title")}</h3>
        <p className="mt-1 text-xs text-ink-2">
          {mode === "now"
            ? t("send.warnNow")
            : t("send.warnSchedule")}
        </p>

        <label className="mb-1.5 mt-4 block text-xs text-ink-2">{t("send.toLabel")}</label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t("send.toPlaceholder")}
          className="min-h-[72px] w-full resize-y rounded border border-[#8a8886] p-2 text-sm outline-none focus:border-link"
        />

        {suggestions.length > 0 && (
          <ul className="mt-1 max-h-[168px] overflow-y-auto rounded border border-side-border bg-white">
            {suggestions.map((u) => (
              <li key={u.id} className="border-t border-divider first:border-t-0">
                <button
                  onClick={() => pick(u.email)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-side-hover"
                >
                  <span
                    className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: u.avatarColor }}
                  >
                    {u.name.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{u.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 rounded bg-pane-bg px-3 py-2.5 text-xs leading-relaxed text-ink-2">
          <div>
            {t("send.subjectLine")} <b className="text-ink">{preview.title}</b>
          </div>
          <div className="mt-0.5">{t("send.bodyLine", { range: preview.rangeLabel, count: preview.taskCount })}</div>
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={attachPdf}
            onChange={(e) => setAttachPdf(e.target.checked)}
            className="mt-[3px]"
          />
          <span>
            {t("send.attachPdf")}
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
              <span className="grid h-[22px] w-[18px] place-items-center rounded-[3px] bg-[#d13438] text-[8px] font-bold text-white">
                PDF
              </span>
              {reportPdfFileName(preview, authorName)}
            </span>
          </span>
        </label>

        <div className="mt-4 border-t border-divider pt-3">
          <div className="inline-flex overflow-hidden rounded border border-[#c8c6c4] text-[12.5px]">
            {(["now", "later"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1 ${mode === m ? "bg-link text-white" : "bg-white text-ink hover:bg-side-hover"}`}
              >
                {m === "now" ? t("send.now") : t("send.schedule")}
              </button>
            ))}
          </div>

          {mode === "later" && (
            <>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCalendarOpen((v) => !v)}
                  className="h-8 rounded border border-[#8a8886] bg-white px-2.5 text-[13px] hover:bg-side-hover"
                >
                  {shortDayLabel(slot.day, locale)} ▾
                </button>
                <select
                  value={slot.hhmm}
                  onChange={(e) => setSlot((v) => ({ ...v, hhmm: e.target.value }))}
                  className="h-8 rounded border border-[#8a8886] bg-white px-2 text-[13px]"
                  aria-label={t("send.timeAria")}
                >
                  {timeSlots().map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {calendarOpen && (
                <div className="mt-1 w-[260px] rounded border border-side-border bg-white shadow-sm">
                  <Calendar
                    value={slot.day}
                    onPick={(day) => {
                      setSlot((v) => ({ ...v, day }));
                      setCalendarOpen(false);
                    }}
                  />
                </div>
              )}
              <p className="mt-2 text-xs leading-relaxed text-ink-2">
                {t.rich("send.scheduleNote", { b: (chunks) => <b className="text-ink">{chunks}</b> })}
              </p>
            </>
          )}
        </div>

        {error && <p className="mt-3 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 rounded border border-[#8a8886] px-4 text-sm hover:bg-side-hover">
            {t("send.cancel")}
          </button>
          <button
            disabled={recipients.length === 0 || busy}
            onClick={send}
            className="h-8 rounded bg-link px-4 text-sm text-white hover:brightness-95 disabled:opacity-50"
          >
            {busy
              ? mode === "now"
                ? t("send.sending")
                : t("send.scheduling")
              : scheduleAt
                ? t("send.scheduleSubmit", { when: scheduleLabel(scheduleAt, tz, locale), count: recipients.length })
                : t("send.sendSubmit", { count: recipients.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 상태별 색. 문구는 `reports.status.<상태>`. */
const SEND_BADGE: Record<string, string> = {
  SCHEDULED: "bg-[#eff4fc] text-[#1b4b9b]",
  SENDING: "bg-[#eff4fc] text-[#1b4b9b]",
  SENT: "bg-[#eff6ef] text-[#0b6a0b]",
  FAILED: "bg-[#fdf3f4] text-danger",
  CANCELED: "bg-pane-bg text-ink-2",
};

/** 발송 이력 한 줄. 기다리는 예약에만 취소 버튼이 있다. */
function SendHistoryItem({ s, reportId }: { s: SendLog; reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const tz = useTimeZone();
  const locale = useLocale();
  const format = useFormatter();
  const t = useTranslations("reports");
  const badgeClass = SEND_BADGE[s.status] ?? SEND_BADGE.SENT;
  const waiting = s.status === "SCHEDULED" || s.status === "SENDING";
  const scheduled = s.scheduledAt ? scheduleLabel(new Date(s.scheduledAt), tz, locale) : null;
  const when = waiting && scheduled ? scheduled : format.dateTime(new Date(s.sentAt), { dateStyle: "medium", timeStyle: "short" });
  // 예약에서 나온 줄은 원래 예약 시각을 붙여 둔다. "몇 시 예약분이 어떻게 됐는지" 가 궁금한 것이다.
  const origin = !waiting && scheduled ? ` · ${t("history.fromSchedule", { when: scheduled })}` : "";

  function cancel() {
    startTransition(async () => {
      const res = await runAction(() => cancelScheduledSend(reportId, s.id));
      if (!res.ok && !handledAuthFailure(res)) setErr(res.error);
      router.refresh();
    });
  }

  return (
    <li className="flex items-start gap-3 border-t border-divider px-4 py-2.5 first:border-t-0">
      <span className={`mt-0.5 shrink-0 rounded-full px-2 text-[11px] ${badgeClass}`}>{t(`status.${s.status}` as never)}</span>
      <div className="min-w-0 flex-1">
        <span className="text-ink-2">
          {when}
          {s.attachPdf ? ` · ${t("history.withPdf")}` : ""}
          {origin}
        </span>
        <div className="text-xs text-ink-2">{s.toEmails.join(", ")}</div>
        {s.errorMsg && waiting && (
          <div className="text-xs text-[#7a5a00]">{t("history.retrying", { error: s.errorMsg })}</div>
        )}
        {s.errorMsg && s.status === "FAILED" && <div className="text-xs text-danger">{s.errorMsg}</div>}
        {s.errorMsg && s.status === "CANCELED" && <div className="text-xs text-ink-2">{s.errorMsg}</div>}
        {err && <div className="text-xs text-danger">{err}</div>}
      </div>
      {s.status === "SCHEDULED" && (
        <button
          type="button"
          disabled={pending}
          onClick={cancel}
          className="shrink-0 text-xs text-link hover:underline disabled:opacity-50"
        >
          {t("history.cancelSchedule")}
        </button>
      )}
    </li>
  );
}
