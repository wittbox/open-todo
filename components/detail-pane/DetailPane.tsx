"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { ListPath } from "@/components/detail-pane/ListPath";
import { PANE_CLASS } from "@/components/shell/shell";
import { Calendar } from "@/components/ui/calendar";
import { createStep, deleteAttachment, deleteStep, deleteTask, setAssignee, setReminder, setRepeat, updateStep, updateTask } from "@/lib/actions/task";
import { addDays, dateOnlyFromString, dateOnlyToString, daysFromToday, isOverdue, todayDateOnly } from "@/lib/date";
import { DATE_ONLY } from "@/lib/format";
import { describeRule, presetRules, weekdayNames, type RepeatRule, type Translate } from "@/lib/repeat";
import type { AttachmentItem, TaskDetail, TaskPerson } from "@/lib/queries/list";
import { formatBytes, isInlineImage, pastedImageName } from "@/lib/files/policy";
import type { ListMember } from "@/lib/queries/members";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import { useFormatter, useLocale, useTimeZone, useTranslations } from "next-intl";
import { DEFAULT_TZ, zonedToInstant } from "@/lib/tz";

/** lib/repeat.ts 는 순수 함수라 next-intl 의 좁은 키 타입을 모른다 — 넘길 때만 풀어 준다. */
const loose = (t: ReturnType<typeof useTranslations<"tasks">>): Translate => t as unknown as Translate;

export function DetailPane({ task, canWrite }: { task: TaskDetail; canWrite: boolean }) {
  const t = useTranslations("tasks");
  // 붙여넣은 그림에 붙일 이름만 files 묶음에서 읽는다.
  const tFiles = useTranslations("files");
  const locale = useLocale();
  const tz = useTimeZone();
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? "");
  /**
   * 열려 있는 팝오버는 하나뿐이다.
   *
   * 각자 따로 열고 닫게 두면 기한 달력 위에 반복 목록이 겹쳐 뜬다 —
   * 달력이 커지면서 눈에 띄게 됐다.
   */
  const [picker, setPicker] = useState<null | "due" | "assign" | "repeat" | "remind">(null);
  const toggle = (which: NonNullable<typeof picker>) =>
    setPicker((cur) => (cur === which ? null : which));
  const [customOpen, setCustomOpen] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stepRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const act = (fn: () => Promise<ActionResult<unknown>>) => {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      router.refresh();
    });
  };

  async function upload(files: File[]) {
    for (const f of files) {
      setUploading(f.name);
      try {
        const body = new FormData();
        body.set("file", f);
        const res = await fetch(`/api/tasks/${task.id}/files`, { method: "POST", body });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setError(b.error ?? t("detail.uploadFailed"));
          break;
        }
      } catch {
        setError(t("detail.uploadFailed"));
        break;
      } finally {
        setUploading(null);
      }
    }
    router.refresh();
  }

  // 캡처한 화면을 그대로 붙일 수 있게 한다. 클립보드 이미지에는 이름이 없어
  // 붙여넣은 시각으로 만든다.
  useEffect(() => {
    if (!canWrite) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 글을 쓰던 중이면 그 입력에 붙는 게 맞다.
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const images = [...(e.clipboardData?.items ?? [])]
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => f != null);
      if (images.length === 0) return;

      e.preventDefault();
      const now = new Date();
      void upload(
        images.map((f) => new File([f], pastedImageName(now, f.type, tFiles("pastedImage")), { type: f.type })),
      );
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // upload 는 task.id 에만 매여 있다.
  }, [task.id, canWrite]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    const q = new URLSearchParams(params.toString());
    q.delete("task");
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  }

  async function copyLink() {
    const url = `${window.location.origin}/t/${task.seq}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast(t("detail.copied", { url }));
    } catch {
      setToast(t("detail.copyFailed", { url }));
    }
  }

  const due = task.dueDate ? dateOnlyFromString(task.dueDate) : null;
  // 반복 문구와 기본 선택지는 기한에서 뽑는다. 기한이 없으면 오늘 기준.
  const repeatAnchor = due ?? todayDateOnly(new Date(), tz);

  return (
    <>
    {/* 1280px 보다 좁으면 옆에 붙지 않고 겹쳐 뜬다(폰은 화면 전체). 바깥을 누르면 닫힌다. */}
    <div data-pane-backdrop="" onClick={close} className="fixed inset-0 z-20 hidden bg-black/10 md:block xl:hidden" />
    <aside className={PANE_CLASS}>
      <div className="flex min-w-0 items-center gap-1.5 px-3 pt-2.5">
        <ListPath task={task} here={pathname === `/list/${task.listId}`} readOnly={!canWrite} />
        <button onClick={close} className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded text-ink-2 hover:bg-side-hover md:h-7 md:w-7" aria-label={t("detail.close")}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {/* 제목 · 세부 단계 */}
        <div className="mb-2.5 rounded bg-white">
          <div className="flex items-start gap-3 px-3.5 pb-1.5 pt-3.5">
            <button
              disabled={!canWrite}
              onClick={() => act(() => updateTask(task.id, { isCompleted: !task.isCompleted }))}
              aria-label={task.isCompleted ? t("row.uncomplete") : t("row.complete")}
              className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-ink-2 ${
                task.isCompleted ? "bg-[#2564cf] border-[#2564cf] text-white" : ""
              }`}
            >
              {task.isCompleted && <Icon name="check" size={13} />}
            </button>
            <textarea
              value={title}
              readOnly={!canWrite}
              rows={1}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== task.title && act(() => updateTask(task.id, { title }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className={`flex-1 resize-none bg-transparent text-base font-semibold leading-snug outline-none ${
                task.isCompleted ? "text-ink-2 line-through" : ""
              }`}
            />
            <button
              disabled={!canWrite}
              onClick={() => act(() => updateTask(task.id, { isImportant: !task.isImportant }))}
              aria-label={task.isImportant ? t("row.unimportant") : t("row.important")}
              className={task.isImportant ? "text-[#2564cf]" : "text-ink-2"}
            >
              <Icon name={task.isImportant ? "starFilled" : "star"} />
            </button>
          </div>

          <button
            onClick={copyLink}
            className="flex items-center gap-1.5 px-3.5 pb-3 pl-[46px] text-xs text-link hover:underline"
          >
            <span className="font-mono font-semibold">#{task.seq}</span>
            <Icon name="link" size={13} />
            {t("detail.copyLink")}
          </button>

          {task.steps.map((s) => (
            <div key={s.id} className="group flex items-center gap-3 border-t border-divider px-3.5 py-2.5">
              <button
                disabled={!canWrite}
                onClick={() => act(() => updateStep(s.id, { isCompleted: !s.isCompleted }))}
                aria-label={s.isCompleted ? t("detail.stepUncomplete") : t("detail.stepComplete")}
                className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-[1.5px] border-ink-2 ${
                  s.isCompleted ? "border-[#2564cf] bg-[#2564cf] text-white" : ""
                }`}
              >
                {s.isCompleted && <Icon name="check" size={11} />}
              </button>
              <input
                defaultValue={s.title}
                readOnly={!canWrite}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v && v !== s.title) act(() => updateStep(s.id, { title: v }));
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${
                  s.isCompleted ? "text-ink-2 line-through" : ""
                }`}
              />
              {canWrite && (
                <button
                  onClick={() => act(() => deleteStep(s.id))}
                  aria-label={t("detail.deleteStep")}
                  className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-danger pointer-coarse:opacity-100"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          ))}

          {canWrite && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = stepRef.current?.value.trim();
                if (!v) return;
                stepRef.current!.value = "";
                act(() => createStep(task.id, v));
              }}
              className="flex items-center gap-3 border-t border-divider px-3.5 py-2.5"
            >
              <Icon name="plus" size={16} className="shrink-0 text-link" />
              <input
                ref={stepRef}
                placeholder={t("detail.nextStep")}
                className="min-w-0 flex-1 bg-transparent text-sm text-link outline-none placeholder:text-link"
              />
            </form>
          )}
        </div>

        {/* 알림 · 기한 · 반복 */}
        <div className="relative mb-2.5 rounded bg-white">
          <DetailItem
            icon="bell"
            label={
              task.remindAt
                ? t("detail.remindAt", { when: formatWhen(format, task.remindAt) })
                : t("detail.remind")
            }
            active={task.remindAt != null}
            disabled={!canWrite}
            onClick={() => toggle("remind")}
            onClear={task.remindAt ? () => act(() => setReminder(task.id, null)) : undefined}
          />
          <DetailItem
            icon="calendar"
            label={due ? t("detail.dueAt", { date: format.dateTime(due, DATE_ONLY) }) : t("detail.setDue")}
            active={due != null}
            danger={due != null && !task.isCompleted && isOverdue(due, new Date(), tz)}
            disabled={!canWrite}
            onClick={() => toggle("due")}
            onClear={due ? () => act(() => updateTask(task.id, { dueDate: null })) : undefined}
          />
          <DetailItem
            icon="repeat"
            label={task.repeat ? describeRule(task.repeat, repeatAnchor, loose(t), locale) : t("detail.repeat")}
            active={task.repeat != null}
            disabled={!canWrite}
            onClick={() => {
              setCustomOpen(false);
              toggle("repeat");
            }}
            onClear={task.repeat ? () => act(() => setRepeat(task.id, null)) : undefined}
          />

          {picker === "remind" && (
            <ReminderPicker
              due={due}
              onPick={(at) => {
                setPicker(null);
                act(() => setReminder(task.id, at));
              }}
            />
          )}

          {picker === "due" && (
            <div className="absolute left-2 right-2 top-[92px] z-20 rounded-md border border-[#e1dfdd] bg-white py-1.5 shadow-[0_6.4px_14.4px_rgba(0,0,0,.132)]">
              {[
                { label: t("due.today"), days: 0 },
                { label: t("due.tomorrow"), days: 1 },
                { label: t("due.nextWeek"), days: 7 },
              ].map((o) => (
                <button
                  key={o.days}
                  onClick={() => {
                    setPicker(null);
                    act(() => updateTask(task.id, { dueDate: dateOnlyToString(daysFromToday(o.days, new Date(), tz)) }));
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm hover:bg-side-hover"
                >
                  <Icon name="calendar" size={16} className="text-ink-2" />
                  {o.label}
                  <span className="ml-auto text-xs text-ink-2">{format.dateTime(daysFromToday(o.days, new Date(), tz), DATE_ONLY)}</span>
                </button>
              ))}
              <div className="my-1.5 h-px bg-divider" />
              {/* 달을 넘기는 것과 날짜를 고르는 것은 다른 일이다.
                  넘길 때는 아무것도 저장하지 않고 닫지도 않는다. */}
              <Calendar
                value={due}
                onPick={(d) => {
                  setPicker(null);
                  act(() => updateTask(task.id, { dueDate: dateOnlyToString(d) }));
                }}
                onClear={
                  due
                    ? () => {
                        setPicker(null);
                        act(() => updateTask(task.id, { dueDate: null }));
                      }
                    : undefined
                }
                clearLabel={t("due.clear")}
              />
            </div>
          )}

          {picker === "repeat" && (
            <RepeatPicker
              anchor={repeatAnchor}
              current={task.repeat}
              custom={customOpen}
              onCustom={() => setCustomOpen(true)}
              onPick={(rule) => {
                setPicker(null);
                setCustomOpen(false);
                act(() => setRepeat(task.id, rule));
              }}
            />
          )}
        </div>

        {/* 담당자 · 파일 */}
        <div className="relative mb-2.5 rounded bg-white">
          <DetailItem
            icon="share"
            label={task.assignee ? task.assignee.name : t("detail.assign")}
            active={task.assignee != null}
            avatar={task.assignee ?? undefined}
            disabled={!canWrite}
            onClick={() => toggle("assign")}
            onClear={
              task.assignee ? () => act(() => setAssignee(task.id, null)) : undefined
            }
          />
          <DetailItem
            icon="clip"
            label={uploading ? t("detail.uploading", { name: uploading }) : t("detail.addFile")}
            disabled={!canWrite || uploading != null}
            onClick={() => fileRef.current?.click()}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length > 0) void upload(files);
            }}
          />

          {task.attachments.map((a) => (
            <AttachmentRow
              key={a.id}
              file={a}
              canDelete={canWrite}
              onDelete={() => act(() => deleteAttachment(a.id))}
            />
          ))}

          {canWrite && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const files = [...e.dataTransfer.files];
                if (files.length > 0) void upload(files);
              }}
              className={`m-3 rounded border border-dashed px-3 py-4 text-center text-xs ${
                dragOver ? "border-link bg-[#eff4fc] text-link" : "border-[#c8c6c4] text-ink-3"
              }`}
            >
              {t.rich("detail.dropHint", { b: (c) => <b>{c}</b> })}
            </div>
          )}

          {picker === "assign" && (
            <AssigneePicker
              listId={task.listId}
              currentId={task.assignee?.id ?? null}
              onPick={(id) => {
                setPicker(null);
                act(() => setAssignee(task.id, id));
              }}
            />
          )}
        </div>

        {/* 메모 */}
        <div className="rounded bg-white">
          <textarea
            value={note}
            readOnly={!canWrite}
            placeholder={t("detail.notePlaceholder")}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (task.note ?? "") && act(() => updateTask(task.id, { note }))}
            className="min-h-[90px] w-full resize-y bg-transparent p-3.5 text-sm outline-none placeholder:text-ink-3"
          />
        </div>

        {error && (
          <div className="mt-2.5 flex items-start gap-2 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><Icon name="x" size={13} /></button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center border-t border-side-border px-4 py-3 text-xs text-ink-2">
        <span>
          {t("detail.createdOn", {
            date: format.dateTime(new Date(task.createdAt), { month: "long", day: "numeric" }),
          })}
        </span>
        {canWrite && (
          <button
            onClick={() => {
              if (!window.confirm(t("detail.confirmDelete", { title: task.title }))) return;
              startTransition(async () => {
                const res = await runAction(() => deleteTask(task.id));
                if (!res.ok && !handledAuthFailure(res)) setError(res.error);
                else close();
                router.refresh();
              });
            }}
            className="ml-auto text-ink-2 hover:text-danger"
            aria-label={t("detail.deleteTask")}
          >
            <Icon name="trash" size={17} />
          </button>
        )}
      </div>

      {toast && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-40 -translate-x-1/2 rounded bg-ink px-4 py-2.5 text-[13px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </aside>
    </>
  );
}

/**
 * 담당자 고르기.
 *
 * 후보는 서버가 정한다 — 클라이언트가 아무 사용자나 넣어도 서버 액션이 다시
 * 막지만, 애초에 고를 수 없는 사람을 보여주지 않는 편이 덜 헷갈린다.
 */
/**
 * 반복 고르기. 기본 선택지는 기한 날짜에서 만들어지므로
 * "매주 수요일"처럼 지금 이 작업에 맞는 말이 나온다.
 */
/** 첨부 한 줄. 이미지는 눌러서 펼쳐 보고, 나머지는 내려받는다. */
function AttachmentRow({
  file,
  canDelete,
  onDelete,
}: {
  file: AttachmentItem;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const t = useTranslations("tasks");
  const inline = isInlineImage(file.mimeType);
  const ext = file.name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "";

  return (
    <div className="group flex items-center gap-3 border-t border-divider px-3.5 py-2.5">
      <a
        href={`/api/files/${file.id}`}
        target={inline ? "_blank" : undefined}
        rel="noreferrer"
        className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded bg-pane-bg text-[9px] text-ink-2"
      >
        {inline ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${file.id}`} alt="" className="h-full w-full object-cover" />
        ) : (
          ext
        )}
      </a>
      <a href={`/api/files/${file.id}`} className="min-w-0 flex-1" target={inline ? "_blank" : undefined} rel="noreferrer">
        <span className="block truncate text-sm">{file.name}</span>
        <span className="block text-[11px] text-ink-3">
          {formatBytes(file.size)}
          {file.uploaderName ? ` · ${file.uploaderName}` : ""}
        </span>
      </a>
      {canDelete && (
        <button
          onClick={onDelete}
          aria-label={t("detail.deleteAttachment")}
          className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100 hover:text-danger pointer-coarse:opacity-100"
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

/** 알림 시각을 사람이 읽는 말로 — 사용자 언어·시간대. */
function formatWhen(format: ReturnType<typeof useFormatter>, iso: string): string {
  return format.dateTime(new Date(iso), {
    month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit",
  });
}

/** 기한이 있으면 그 기준 선택지도 함께 낸다. */
function ReminderPicker({ due, onPick }: { due: Date | null; onPick: (at: string) => void }) {
  // 브라우저 시계가 아니라 사용자 시간대의 벽시계로 "오늘 6시" 를 정한다 — 출장 중 노트북이 다른
  // 시간대에 있어도 알림이 설정한 사람의 6시에 온다.
  const t = useTranslations("tasks");
  const tz = useTimeZone() ?? DEFAULT_TZ;
  const format = useFormatter();
  // 고른 날짜에 붙일 시각. 업무 시작 무렵이 가장 흔해 9시를 기본으로 둔다.
  const [time, setTime] = useState("09:00");
  /** 날짜 전용 값(UTC 자정)의 그날 hour:minute — 사용자 시간대 */
  const at = (dateOnlyValue: Date, hour: number, minute = 0) =>
    zonedToInstant(dateOnlyValue.getUTCFullYear(), dateOnlyValue.getUTCMonth() + 1, dateOnlyValue.getUTCDate(), hour, minute, tz);
  const now = new Date();
  const today = todayDateOnly(now, tz);
  const today6pm = at(today, 18);
  const tomorrow9 = at(addDays(today, 1), 9);
  const formatDay = (d: Date) => format.dateTime(d, { month: "numeric", day: "numeric", timeZone: "UTC" });

  const options: { label: string; hint?: string; when: Date }[] = [];
  if (today6pm.getTime() > now.getTime()) options.push({ label: t("reminder.todayEvening"), when: today6pm });
  options.push({ label: t("reminder.tomorrowMorning"), when: tomorrow9 });

  if (due) {
    // 기한은 날짜 전용(UTC 자정)이라 그 날의 사용자 시간대 아침 9시로 옮긴다.
    options.push({ label: t("reminder.dueDayMorning"), hint: formatDay(due), when: at(due, 9) });
    const dayBefore = addDays(due, -1);
    options.push({ label: t("reminder.dayBeforeMorning"), hint: formatDay(dayBefore), when: at(dayBefore, 9) });
  }

  return (
    <div className="absolute left-2 right-2 top-[46px] z-20 rounded-md border border-[#e1dfdd] bg-white py-1.5 shadow-[0_6.4px_14.4px_rgba(0,0,0,.132)]">
      {options
        .filter((o) => o.when.getTime() > now.getTime())
        .map((o) => (
          <button
            key={o.label}
            onClick={() => onPick(o.when.toISOString())}
            className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm hover:bg-side-hover"
          >
            <Icon name="bell" size={16} className="text-ink-2" />
            {o.label}
            {o.hint && <span className="ml-auto text-xs text-ink-2">{o.hint}</span>}
          </button>
        ))}

      <div className="my-1.5 h-px bg-divider" />
      {/* 날짜는 앱 달력에서 고르고, 시각만 따로 받는다.
          type="time" 에는 달을 넘기는 조작이 없어 같은 문제가 없다. */}
      <label className="flex items-center gap-3 px-3.5 py-1.5 text-sm">
        <Icon name="bell" size={16} className="text-ink-2" />
        {t("reminder.time")}
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value || "09:00")}
          className="ml-auto rounded border border-[#d6d4d2] px-1.5 py-0.5 text-xs"
        />
      </label>
      <Calendar
        value={null}
        onPick={(d) => {
          const [h, m] = time.split(":").map(Number);
          onPick(at(d, h || 9, m || 0).toISOString());
        }}
      />
    </div>
  );
}

function RepeatPicker({
  anchor,
  current,
  custom,
  onCustom,
  onPick,
}: {
  anchor: Date;
  current: RepeatRule | null;
  custom: boolean;
  onCustom: () => void;
  onPick: (rule: RepeatRule) => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [every, setEvery] = useState(current?.every ?? 1);
  const [unit, setUnit] = useState<RepeatRule["unit"]>(current?.unit ?? "WEEK");
  const [days, setDays] = useState<number[]>(current?.days ?? [anchor.getUTCDay()]);
  const shortDays = weekdayNames(locale, "short");

  const same = (a: RepeatRule) =>
    current != null &&
    current.unit === a.unit &&
    current.every === a.every &&
    current.days.join() === a.days.join();

  return (
    <div className="absolute left-2 right-2 top-[132px] z-20 rounded-md border border-[#e1dfdd] bg-white py-1.5 shadow-[0_6.4px_14.4px_rgba(0,0,0,.132)]">
      {!custom &&
        presetRules(anchor, loose(t), locale).map((p) => (
          <button
            key={p.key}
            onClick={() => onPick(p.rule)}
            className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm hover:bg-side-hover ${
              same(p.rule) ? "text-link" : ""
            }`}
          >
            <Icon name="repeat" size={16} className={same(p.rule) ? "text-link" : "text-ink-2"} />
            {p.label}
            {same(p.rule) && <Icon name="check" size={14} className="ml-auto text-link" />}
          </button>
        ))}

      {!custom && (
        <>
          <div className="my-1.5 h-px bg-divider" />
          <button
            onClick={onCustom}
            className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm hover:bg-side-hover"
          >
            <Icon name="edit" size={16} className="text-ink-2" />
            {t("repeat.custom")}
            <Icon name="chevronRight" size={14} className="ml-auto text-ink-2" />
          </button>
        </>
      )}

      {custom && (
        <div className="px-3.5 py-2">
          <div className="flex items-center gap-2 text-sm">
            <input
              type="number"
              min={1}
              max={30}
              value={every}
              onChange={(e) => setEvery(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
              className="w-14 rounded border border-[#d6d4d2] px-1.5 py-1 text-sm outline-none focus:border-link"
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as RepeatRule["unit"])}
              className="rounded border border-[#d6d4d2] px-1.5 py-1 text-sm outline-none focus:border-link"
            >
              <option value="DAY">{t("repeat.unit.DAY")}</option>
              <option value="WEEK">{t("repeat.unit.WEEK")}</option>
              <option value="MONTH">{t("repeat.unit.MONTH")}</option>
              <option value="YEAR">{t("repeat.unit.YEAR")}</option>
            </select>
          </div>

          {unit === "WEEK" && (
            <div className="mt-2.5 flex gap-1">
              {shortDays.map((label, d) => {
                const on = days.includes(d);
                return (
                  <button
                    key={d}
                    onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d].sort())}
                    className={`grid h-7 w-7 place-items-center rounded-full text-xs ${
                      on ? "bg-link text-white" : "bg-pane-bg text-ink-2 hover:bg-side-hover"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={() => onPick({ unit, every, days: unit === "WEEK" ? days : [] })}
            disabled={unit === "WEEK" && days.length === 0}
            className="mt-3 h-8 w-full rounded bg-link text-sm text-white disabled:bg-[#c8c6c4]"
          >
            {unit === "WEEK" && days.length === 0 ? t("repeat.pickDay") : t("repeat.save")}
          </button>
        </div>
      )}
    </div>
  );
}

function AssigneePicker({
  listId,
  currentId,
  onPick,
}: {
  listId: string;
  currentId: string | null;
  onPick: (id: string | null) => void;
}) {
  const t = useTranslations("tasks");
  const [members, setMembers] = useState<ListMember[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/lists/${listId}/members`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => alive && setMembers(d.members as ListMember[]))
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, [listId]);

  const term = q.trim().toLowerCase();
  const shown = (members ?? []).filter(
    (m) => !term || m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term),
  );

  return (
    <div className="absolute left-2 right-2 top-[52px] z-20 rounded-md border border-[#e1dfdd] bg-white py-1.5 shadow-[0_6.4px_14.4px_rgba(0,0,0,.132)]">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("assignee.search")}
        className="mx-2.5 mb-1 w-[calc(100%-20px)] rounded border border-[#d6d4d2] px-2 py-1 text-[13px] outline-none focus:border-link"
      />

      {members === null && <p className="px-3.5 py-2 text-xs text-ink-3">{t("assignee.loading")}</p>}
      {members !== null && shown.length === 0 && (
        <p className="px-3.5 py-2 text-xs text-ink-3">{t("assignee.none")}</p>
      )}

      <ul className="max-h-[210px] overflow-y-auto">
        {shown.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => onPick(m.id === currentId ? null : m.id)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-side-hover"
            >
              <span
                className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: m.avatarColor }}
              >
                {m.name.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="shrink-0 text-[11px] text-ink-3">
                {m.isOwner ? t("assignee.owner") : t(`assignee.${m.role}`)}
              </span>
              {m.id === currentId && <Icon name="check" size={14} className="shrink-0 text-link" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailItem({
  icon,
  label,
  active,
  danger,
  pending,
  disabled,
  avatar,
  onClick,
  onClear,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  danger?: boolean;
  pending?: string;
  disabled?: boolean;
  /** 담당자처럼 사람을 가리키는 행은 아이콘 대신 아바타를 보여준다. */
  avatar?: TaskPerson;
  onClick?: () => void;
  onClear?: () => void;
}) {
  const t = useTranslations("tasks");
  const muted = Boolean(pending) || disabled;
  return (
    <div className="flex items-center border-t border-divider first:border-t-0">
      <button
        type="button"
        disabled={muted}
        onClick={onClick}
        className={`flex flex-1 items-center gap-3 px-3.5 py-3 text-left text-sm ${
          muted ? "cursor-default text-ink-3" : "hover:bg-side-hover"
        } ${active && !muted ? "text-link" : ""} ${danger ? "text-danger" : ""}`}
      >
        {avatar ? (
          <span
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
            style={{ background: avatar.avatarColor }}
          >
            {avatar.name.slice(0, 2)}
          </span>
        ) : (
          <span className={`grid w-[18px] shrink-0 place-items-center ${muted ? "text-ink-3" : active ? "text-link" : "text-ink-2"}`}>
            <Icon name={icon} size={16} />
          </span>
        )}
        <span className="flex-1">{label}</span>
        {pending && <span className="rounded-full bg-pane-bg px-2 py-0.5 text-[11px] text-ink-2">{pending}</span>}
      </button>
      {onClear && (
        <button onClick={onClear} aria-label={t("detail.clear")} className="px-3 text-ink-2 hover:text-danger">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
