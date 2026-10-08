"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { PANE_CLASS } from "@/components/shell/shell";
import { GrowingTextarea, onEnter, oneLine } from "@/components/ui/GrowingTextarea";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { MessageBody } from "@/components/project/MessageBody";
import { MessageComposer } from "@/components/project/MessageComposer";
import { Face, LabelChip, StatusPill } from "@/components/issues/IssueBits";
import {
  addCommentAction,
  deleteCommentAction,
  deleteIssueAction,
  editCommentAction,
  setWatchingAction,
  updateIssueAction,
} from "@/lib/actions/issue";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import { dateOnlyFromString } from "@/lib/date";
import { DATE_ONLY } from "@/lib/format";
import { formatBytes, isInlineImage } from "@/lib/files/policy";
import { describeEvent, PRIORITIES, STATUSES } from "@/lib/issues/format";
import { relativeShort, timeOf, type Translate } from "@/lib/projects/format";
import type { AttachmentItem } from "@/lib/queries/list";
import type { IssueDetail, IssueEventItem, IssueLabelItem } from "@/lib/queries/issues";
import type { ProjectMemberItem } from "@/lib/queries/project";
import type { IssuePriority, IssueStatus } from "@/app/generated/prisma/enums";

/**
 * 이슈 상세 — 작업 상세 창과 같은 자리(오른쪽)에 붙는다.
 * 제목·상태·담당자·우선순위·라벨·기한을 바로 고치고, 바뀐 기록과 댓글이 시간순으로 쌓인다.
 * 동작마다 서버가 다시 그린다(router.refresh) — 목록의 상태·갱신 시각도 함께 맞춰진다.
 */
export function IssuePane({
  issue,
  issueKey,
  labels,
  members,
  meId,
  isAdmin,
  readOnly,
}: {
  issue: IssueDetail;
  issueKey: string | null;
  labels: IssueLabelItem[];
  members: ProjectMemberItem[];
  meId: string;
  isAdmin: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("issues");
  const tp = useTranslations("projects");
  const tz = useTimeZone();
  const format = useFormatter();
  const ago = (iso: string) => relativeShort(iso, new Date(), tz, tp as unknown as Translate);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [title, setTitle] = useState(issue.title);
  const [editingBody, setEditingBody] = useState(false);
  const [body, setBody] = useState(issue.body);
  const [editingLabels, setEditingLabels] = useState(false);
  const [viewer, setViewer] = useState<{ images: AttachmentItem[]; start: number } | null>(null);
  const canWrite = !readOnly;
  const isReporter = issue.reporter?.id === meId;
  const names = new Map([...issue.people.map((p) => [p.userId, p.name] as const), ...members.map((m) => [m.userId, m.name] as const)]);
  const nameOf = (id: string) => names.get(id) ?? t("pane.unknown");
  const dateLabel = (ymd: string) => format.dateTime(dateOnlyFromString(ymd), DATE_ONLY);
  const mentionNames = issue.people;

  function act(fn: () => Promise<ActionResult<unknown>>, then?: () => void) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok) {
        if (!handledAuthFailure(res)) setError(res.error);
        return;
      }
      setError(null);
      then?.();
      router.refresh();
    });
  }
  const patch = (p: Parameters<typeof updateIssueAction>[1], then?: () => void) => act(() => updateIssueAction(issue.id, p), then);

  function close() {
    router.replace(`${pathname}?tab=issues`, { scroll: false });
  }

  async function copyLink() {
    const url = `${window.location.origin}/i/${issue.ref}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast(t("pane.copied", { url }));
    } catch {
      setToast(t("pane.copyFailed", { url }));
    }
  }

  async function sendComment(text: string, files: File[]): Promise<boolean> {
    let res: ActionResult<unknown>;
    if (files.length === 0) {
      res = await runAction(() => addCommentAction(issue.id, text));
    } else {
      const fd = new FormData();
      fd.set("body", text);
      for (const f of files) fd.append("files", f, f.name);
      const r = await fetch(`/api/issues/${issue.id}/comments`, { method: "POST", body: fd }).catch(() => null);
      const data = r ? ((await r.json().catch(() => ({}))) as { error?: string }) : {};
      res =
        r?.status === 401
          ? { ok: false, error: tp("send.unauthenticated"), code: "unauthenticated" }
          : r?.ok
            ? { ok: true, data: null }
            : { ok: false, error: data.error ?? t("pane.commentFailed"), code: "unknown" };
    }
    if (!res.ok) {
      if (!handledAuthFailure(res)) setError(res.error);
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  }

  const select = "h-7 min-w-0 rounded border border-[#e1dfdd] bg-white px-1.5 text-[12.5px] disabled:bg-transparent disabled:border-transparent disabled:appearance-none";
  const card = "mb-2.5 rounded bg-white";

  return (
    <aside className={PANE_CLASS} aria-label={`${issue.ref} ${issue.title}`}>
      <div className="flex items-center gap-2 border-b border-[#e1dfdd] bg-white px-3.5 py-2 text-[12px] text-ink-2">
        <button type="button" onClick={copyLink} className="inline-flex items-center gap-1 hover:text-link">
          <span className="font-mono font-semibold">{issue.ref}</span>
          <Icon name="link" size={12} />
          {t("pane.copyLink")}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={close} aria-label={t("pane.close")} className="text-ink-2 hover:text-ink">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3.5">
        {toast && <p className="mb-2 rounded bg-[#eff6fc] px-3 py-1.5 text-[12px] text-link">{toast}</p>}

        {/* 제목 · 상태 */}
        <div className={`${card} px-3.5 pb-3 pt-3`}>
          <GrowingTextarea
            value={title}
            readOnly={!canWrite}
            aria-label={t("pane.titleLabel")}
            onChange={(e) => setTitle(oneLine(e.target.value))}
            onBlur={() => title.trim() && title !== issue.title && patch({ title })}
            onKeyDown={(e) => onEnter(e, () => e.currentTarget.blur())}
            className="w-full bg-transparent text-base font-semibold leading-snug outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={issue.status} />
            {canWrite && (
              <select
                aria-label={t("pane.changeStatus")}
                value={issue.status}
                disabled={pending}
                onChange={(e) => patch({ status: e.target.value as IssueStatus })}
                className={select}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </select>
            )}
          </div>
          {canWrite && issue.status === "RESOLVED" && (isReporter || isAdmin) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded bg-[#dff6dd] px-2.5 py-2 text-[12.5px] text-[#0b6a0b]">
              <span className="flex-1">{t("pane.resolvedBanner")}</span>
              <button type="button" disabled={pending} onClick={() => patch({ status: "CLOSED" })} className="rounded bg-[#0b6a0b] px-2.5 py-0.5 text-white">
                {t("pane.confirmClose")}
              </button>
              <button type="button" disabled={pending} onClick={() => patch({ status: "OPEN" })} className="rounded border border-[#0b6a0b] px-2.5 py-0.5">
                {t("pane.reopen")}
              </button>
            </div>
          )}
        </div>

        {/* 담당자 · 우선순위 · 라벨 · 기한 · 보고자 · 지켜보기 */}
        <div className={`${card} grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 px-3.5 py-3 text-[12.5px]`}>
          <span className="text-ink-3">{t("pane.assignee")}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            {issue.assignee && <Face name={issue.assignee.name} color={issue.assignee.avatarColor} size={20} />}
            <select
              aria-label={t("pane.assignee")}
              value={issue.assigneeId ?? ""}
              disabled={!canWrite || pending}
              onChange={(e) => patch({ assigneeId: e.target.value || null })}
              className={`${select} flex-1`}
            >
              <option value="">{t("pane.noAssignee")}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === meId ? t("pane.me", { name: m.name }) : m.name}
                </option>
              ))}
            </select>
          </span>

          <span className="text-ink-3">{t("pane.priority")}</span>
          <select
            aria-label={t("pane.priority")}
            value={issue.priority}
            disabled={!canWrite || pending}
            onChange={(e) => patch({ priority: e.target.value as IssuePriority })}
            className={select}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </select>

          <span className="self-start pt-0.5 text-ink-3">{t("pane.labels")}</span>
          <span className="flex flex-wrap items-center gap-1">
            {(editingLabels ? labels : labels.filter((l) => issue.labelIds.includes(l.id))).map((l) => {
              const on = issue.labelIds.includes(l.id);
              return editingLabels ? (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  disabled={pending}
                  onClick={() => patch({ labelIds: on ? issue.labelIds.filter((x) => x !== l.id) : [...issue.labelIds, l.id] })}
                  className={`rounded-full ${on ? "ring-2 ring-link ring-offset-1" : "opacity-50 hover:opacity-100"}`}
                >
                  <LabelChip name={l.name} color={l.color} />
                </button>
              ) : (
                <LabelChip key={l.id} name={l.name} color={l.color} />
              );
            })}
            {canWrite && labels.length > 0 && (
              <button type="button" onClick={() => setEditingLabels((v) => !v)} className="text-[12px] text-link hover:underline">
                {editingLabels ? t("pane.labelsDone") : issue.labelIds.length ? t("pane.labelsEdit") : t("pane.labelsAdd")}
              </button>
            )}
            {labels.length === 0 && <span className="text-ink-3">{t("pane.none")}</span>}
          </span>

          <span className="text-ink-3">{t("pane.due")}</span>
          <span className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label={t("pane.due")}
              value={issue.dueDate ?? ""}
              disabled={!canWrite || pending}
              onChange={(e) => patch({ dueDate: e.target.value || null })}
              className={select}
            />
            {issue.dueDate && canWrite && (
              <button type="button" aria-label={t("pane.clearDue")} onClick={() => patch({ dueDate: null })} className="text-ink-3 hover:text-danger">
                <Icon name="x" size={12} />
              </button>
            )}
          </span>

          <span className="text-ink-3">{t("pane.reporter")}</span>
          <span className="truncate">
            {t("pane.reporterLine", { name: issue.reporter?.name ?? t("pane.unknown"), when: ago(issue.createdAt) })}
          </span>

          <span className="text-ink-3">{t("pane.watch")}</span>
          <span className="flex items-center gap-2">
            <span className="text-ink-2">{t("pane.watchers", { count: issue.watcherCount })}</span>
            <button
              type="button"
              disabled={pending}
              aria-pressed={issue.isWatching}
              onClick={() => act(() => setWatchingAction(issue.id, !issue.isWatching))}
              className="text-[12px] text-link hover:underline"
            >
              {issue.isWatching ? t("pane.watchOff") : t("pane.watchOn")}
            </button>
          </span>
        </div>

        {/* 본문 */}
        <div className={`${card} px-3.5 py-3`}>
          {editingBody ? (
            <>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                aria-label={t("pane.bodyLabel")}
                className="w-full resize-y rounded border border-[#8a8886] px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-link"
              />
              <div className="mt-2 flex justify-end gap-2 text-[12.5px]">
                <button type="button" onClick={() => (setBody(issue.body), setEditingBody(false))} className="rounded border border-[#8a8886] px-3 py-0.5">
                  {t("pane.cancel")}
                </button>
                <button type="button" disabled={pending} onClick={() => patch({ body }, () => setEditingBody(false))} className="rounded bg-link px-3 py-0.5 text-white">
                  {t("pane.save")}
                </button>
              </div>
            </>
          ) : (
            <>
              {issue.body.trim() ? (
                <IssueBody body={issue.body} mentions={mentionNames} meId={meId} issueKey={issueKey} />
              ) : (
                <p className="text-[13px] text-ink-3">{t("pane.noBody")}</p>
              )}
              {canWrite && (
                <button type="button" onClick={() => setEditingBody(true)} className="mt-2 text-[12px] text-link hover:underline">
                  {t("pane.editBody")}
                </button>
              )}
            </>
          )}
          <Files files={issue.attachments} onView={(images, start) => setViewer({ images, start })} />
        </div>

        {/* 활동 */}
        <div className={`${card} px-3.5 py-2.5`} aria-label={t("pane.activity")}>
          {issue.events.map((e) =>
            e.kind === "COMMENT" ? (
              <Comment
                key={e.id}
                e={e}
                meId={meId}
                issueKey={issueKey}
                mentions={mentionNames}
                canEdit={canWrite && e.isMine}
                canDelete={canWrite && (e.isMine || isAdmin)}
                pending={pending}
                onEdit={(text) => act(() => editCommentAction(e.id, text))}
                onDelete={() => window.confirm(t("comment.confirmDelete")) && act(() => deleteCommentAction(e.id))}
                onView={(images, start) => setViewer({ images, start })}
              />
            ) : (
              <p key={e.id} className="flex gap-1.5 py-1 text-[12px] text-ink-2">
                <span aria-hidden="true" className="text-ink-3">
                  {e.kind === "CREATED" ? "●" : "↻"}
                </span>
                <span>
                  <b className="font-semibold text-ink">{e.actor?.name ?? t("pane.unknown")}</b> {describeEvent(e, t as unknown as Translate, nameOf, dateLabel)}
                  <span className="text-ink-3"> · {ago(e.createdAt)}</span>
                </span>
              </p>
            ),
          )}
        </div>

        {error && <p className="mb-2.5 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}

        {issue.canDelete && canWrite && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t("pane.confirmDeleteIssue", { ref: issue.ref }))) {
                act(() => deleteIssueAction(issue.id), close);
              }
            }}
            className="mb-3 text-[12px] text-danger hover:underline"
          >
            {t("pane.deleteIssue")}
          </button>
        )}
      </div>

      <div className="border-t border-[#e1dfdd] bg-white">
        <MessageComposer
          placeholder={t("pane.commentPlaceholder")}
          disabled={!canWrite}
          disabledHint={t("pane.archivedHint")}
          members={members.filter((m) => m.userId !== meId)}
          allowFiles
          onSend={sendComment}
        />
      </div>

      {viewer && <ImageViewer images={viewer.images} start={viewer.start} onClose={() => setViewer(null)} />}
    </aside>
  );
}

/**
 * 이슈 본문. 템플릿의 "## 재현 순서" 같은 줄은 소제목으로 그리고, 그 사이 글은 메시지와 같은 규칙(멘션·링크)으로.
 * 마크다운 전부를 해석하지는 않는다 — 소제목만으로 버그 보고서가 읽히고, 나머지는 평문이 더 안전하다.
 */
function IssueBody({
  body,
  mentions,
  meId,
  issueKey,
}: {
  body: string;
  mentions: { userId: string; name: string }[];
  meId: string;
  issueKey: string | null;
}) {
  const blocks: { heading: string | null; text: string }[] = [{ heading: null, text: "" }];
  for (const line of body.split("\n")) {
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) blocks.push({ heading: h[1].trim(), text: "" });
    else blocks[blocks.length - 1].text += (blocks[blocks.length - 1].text ? "\n" : "") + line;
  }
  return (
    <div className="text-[13px] leading-relaxed">
      {blocks.map((b, i) => (
        <div key={i}>
          {b.heading && <h4 className="mt-2.5 text-[12.5px] font-semibold text-ink-2 first:mt-0">{b.heading}</h4>}
          {b.text.trim() && (
            <MessageBody body={b.text.replace(/^\n+|\n+$/g, "")} mentions={mentions} meId={meId} issueKey={issueKey} className="text-[13px]" />
          )}
        </div>
      ))}
    </div>
  );
}

function Files({ files, onView }: { files: AttachmentItem[]; onView: (images: AttachmentItem[], start: number) => void }) {
  const t = useTranslations("issues");
  if (files.length === 0) return null;
  const photos = files.filter((f) => isInlineImage(f.mimeType));
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {files.map((f) =>
        isInlineImage(f.mimeType) ? (
          <button
            key={f.id}
            type="button"
            title={f.name}
            aria-label={t("pane.viewFile", { name: f.name })}
            onClick={() => onView(photos, photos.findIndex((p) => p.id === f.id))}
            className="h-14 w-20 cursor-zoom-in overflow-hidden rounded border border-[#e1dfdd]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${f.id}`} alt="" className="h-full w-full object-cover" />
          </button>
        ) : (
          <a
            key={f.id}
            href={`/api/files/${f.id}`}
            className="inline-flex items-center gap-1.5 rounded border border-[#e1dfdd] px-2 py-1 text-[12px] hover:bg-side-hover"
          >
            <Icon name="clip" size={12} className="text-ink-2" />
            <span className="max-w-[180px] truncate">{f.name}</span>
            <span className="text-ink-3">{formatBytes(f.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

function Comment({
  e,
  meId,
  issueKey,
  mentions,
  canEdit,
  canDelete,
  pending,
  onEdit,
  onDelete,
  onView,
}: {
  e: IssueEventItem;
  meId: string;
  issueKey: string | null;
  mentions: { userId: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
  pending: boolean;
  onEdit: (text: string) => void;
  onDelete: () => void;
  onView: (images: AttachmentItem[], start: number) => void;
}) {
  const t = useTranslations("issues");
  const tp = useTranslations("projects");
  const tz = useTimeZone();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.body);
  return (
    <div className="group flex gap-2 py-1.5" data-comment={e.id}>
      {e.actor ? <Face name={e.actor.name} color={e.actor.avatarColor} /> : <span className="h-[22px] w-[22px] shrink-0 rounded-full bg-pane-bg" />}
      <div className="min-w-0 flex-1 rounded-md bg-pane-bg px-2.5 py-1.5 text-[13px]">
        <div className="flex items-center gap-1.5 text-[12px]">
          <b className="font-semibold">{e.actor?.name ?? t("pane.unknown")}</b>
          <span className="text-ink-3">
            {relativeShort(e.createdAt, new Date(), tz, tp as unknown as Translate)} {timeOf(e.createdAt, tz)}
            {e.editedAt && ` · ${t("comment.edited")}`}
          </span>
          <span className="flex-1" />
          {!e.deleted && !editing && (
            <span className="flex gap-2 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100">
              {canEdit && (
                <button type="button" onClick={() => setEditing(true)} className="text-ink-3 hover:text-link">
                  {t("comment.edit")}
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={onDelete} className="text-ink-3 hover:text-danger">
                  {t("comment.delete")}
                </button>
              )}
            </span>
          )}
        </div>
        {e.deleted ? (
          <p className="text-ink-3">{t("comment.deleted")}</p>
        ) : editing ? (
          <>
            <textarea
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              rows={3}
              aria-label={t("comment.editLabel")}
              className="mt-1 w-full resize-y rounded border border-[#8a8886] bg-white px-2 py-1 text-[13px] outline-none"
            />
            <div className="mt-1 flex justify-end gap-2 text-[12px]">
              <button type="button" onClick={() => (setText(e.body), setEditing(false))}>
                {t("comment.cancel")}
              </button>
              <button
                type="button"
                disabled={pending || !text.trim()}
                onClick={() => {
                  onEdit(text);
                  setEditing(false);
                }}
                className="font-semibold text-link"
              >
                {t("comment.save")}
              </button>
            </div>
          </>
        ) : (
          e.body && <MessageBody body={e.body} mentions={mentions} meId={meId} issueKey={issueKey} className="whitespace-pre-wrap break-words" />
        )}
        {!e.deleted && <Files files={e.attachments} onView={onView} />}
      </div>
    </div>
  );
}
