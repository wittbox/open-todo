"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { GrowingTextarea, onEnter, oneLine } from "@/components/ui/GrowingTextarea";
import { ImageViewer } from "@/components/ui/ImageViewer";
import { IssueEditor } from "@/components/issues/IssueEditor";
import { IssueMarkdown } from "@/components/issues/IssueMarkdown";
import type { EditorMember } from "@/components/issues/RichEditor";
import { Face, StatusPill } from "@/components/issues/IssueBits";
import { LabelPicker } from "@/components/issues/LabelPicker";
import { useIssueRefresh } from "@/components/issues/useIssueRefresh";
import {
  addCommentAction,
  addIssueLabelAction,
  issueImageLinksAction,
  deleteCommentAction,
  deleteIssueAction,
  setWatchingAction,
  updateIssueAction,
} from "@/lib/actions/issue";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import { copyText } from "@/lib/clipboard";
import { buildIssuePrompt } from "@/lib/issues/prompt";
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
 * 이슈 페이지. 목록에서 이슈를 누르면 오른쪽 좁은 창이 아니라
 * 프로젝트 머리글 아래 본문 자리 전체에 열린다 — 이슈는 긴 본문·캡처·여러 사람의 댓글이 이어지는 문서라서.
 *
 * 왼쪽: 제목 → 본문 카드(소제목, 사진은 폭에 맞춰 크게) → 타임라인(댓글 카드 사이에 바뀐 기록이 가는 줄로) → 댓글 입력과 상태 버튼.
 * 오른쪽 좁은 열: 상태·담당자·우선순위·라벨·기한·보고자·지켜보기를 바로 고친다. 좁은 화면에서는 이 열이 제목 아래로 온다.
 * 동작마다 서버가 다시 그리고(router.refresh), 남이 바꾼 것은 자동 새로고침(useIssueRefresh)이 가져온다.
 */
export function IssuePage({
  projectId,
  projectName,
  stamp,
  issue,
  issueKey,
  labels,
  members,
  meId,
  isAdmin,
  readOnly,
}: {
  projectId: string;
  /** Claude Code 용 복사의 머리말 */
  projectName: string;
  /** 서버가 이 화면을 그릴 때의 '바뀜 표시' — 자동 새로고침이 비교한다 */
  stamp: string;
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
  useIssueRefresh(projectId, stamp);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [title, setTitle] = useState(issue.title);
  // 자동 새로고침으로 남이 바꾼 제목이 내려오면 따라간다 — 내가 고치던 중(화면 값이 옛 서버 값과 다름)이면 두고.
  const [serverTitle, setServerTitle] = useState(issue.title);
  if (serverTitle !== issue.title) {
    setServerTitle(issue.title);
    if (title === serverTitle) setTitle(issue.title);
  }
  const [editingBody, setEditingBody] = useState(false);
  // 좁은 화면에서는 필드를 칩 한 줄로 접어 두고, 누르면 펼친다 — 본문이 먼저 보이게.
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [viewer, setViewer] = useState<{ images: AttachmentItem[]; start: number } | null>(null);
  const canWrite = !readOnly;
  const isReporter = issue.reporter?.id === meId;
  const names = new Map([...issue.people.map((p) => [p.userId, p.name] as const), ...members.map((m) => [m.userId, m.name] as const)]);
  const nameOf = (id: string) => names.get(id) ?? t("pane.unknown");
  const dateLabel = (ymd: string) => format.dateTime(dateOnlyFromString(ymd), DATE_ONLY);
  const mentionNames = issue.people;
  // 편집기의 @부르기 후보 — 나를 뺀 멤버
  const editorMembers = members.filter((m) => m.userId !== meId).map((m) => ({ userId: m.userId, name: m.name, department: m.department }));
  const listHref = `${pathname}?tab=issues`;
  const onView = (images: AttachmentItem[], start: number) => setViewer({ images, start });

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

  /** ‘＋ 새 라벨’ — 만들고 이 이슈에 바로 붙인다. 성공하면 true(입력칸을 닫는다). */
  async function createLabel(name: string, color: string): Promise<boolean> {
    const res = await runAction(() => addIssueLabelAction(issue.id, { name, color }));
    if (!res.ok) {
      if (!handledAuthFailure(res)) setError(res.error);
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  }

  async function copyLink() {
    const url = `${window.location.origin}/i/${issue.ref}`;
    setToast((await copyText(url)) ? t("pane.copied", { url }) : t("pane.copyFailed", { url }));
  }

  /** Claude Code 용 복사(2026-10-13) — 머리말 + 본문, 본문 사진은 24시간 임시 링크. 사진이 없으면 서버에 묻지 않는다. */
  async function copyPrompt() {
    const origin = window.location.origin;
    let images: { name: string; size: number; url: string }[] = [];
    if (issue.attachments.some((a) => isInlineImage(a.mimeType))) {
      const res = await runAction(() => issueImageLinksAction(issue.id));
      if (!res.ok) {
        if (!handledAuthFailure(res)) setToast(t("pane.photoLinksFailed", { error: res.error }));
        return;
      }
      images = res.data.map((im) => ({ name: im.name, size: im.size, url: origin + im.path }));
    }
    const text = buildIssuePrompt({
      issue,
      projectName,
      labels,
      url: `${origin}/i/${issue.ref}`,
      images,
      t: t as unknown as Translate,
    });
    setToast((await copyText(text)) ? t("pane.copyPromptDone", { photos: images.length }) : t("pane.copyPromptFailed"));
  }

  async function sendComment(text: string, files: File[]): Promise<boolean> {
    const res =
      files.length === 0
        ? await runAction(() => addCommentAction(issue.id, text))
        : await sendForm(`/api/issues/${issue.id}/comments`, "POST", { body: text, files }, tp("send.unauthenticated"), t("pane.commentFailed"));
    return settle(res);
  }

  /** 본문 고치기(2026-10-20) — 글과 함께 본문 파일을 붙이고 뺀다 */
  async function saveBody(text: string, files: File[], removeIds: string[]): Promise<boolean> {
    const ok = settle(
      await sendForm(`/api/issues/${issue.id}/body`, "POST", { body: text, files, removeIds }, tp("send.unauthenticated"), t("editor.bodyFailed")),
    );
    if (ok) setEditingBody(false);
    return ok;
  }

  /** 댓글 고치기(2026-10-20) — 고칠 때도 Ctrl+V 로 사진을 붙인다 */
  async function saveComment(eventId: string, text: string, files: File[], removeIds: string[]): Promise<boolean> {
    return settle(
      await sendForm(
        `/api/issues/${issue.id}/comments/${eventId}`,
        "PATCH",
        { body: text, files, removeIds },
        tp("send.unauthenticated"),
        t("editor.commentEditFailed"),
      ),
    );
  }

  function settle(res: ActionResult<unknown>): boolean {
    if (!res.ok) {
      if (!handledAuthFailure(res)) setError(res.error);
      return false;
    }
    setError(null);
    router.refresh();
    return true;
  }

  // 댓글 입력 옆 상태 버튼. 해결됨은 위쪽 배너가 보고자·관리자에게 '확인하고 닫기 · 다시 열기' 를 준다.
  const statusAction =
    !canWrite ? null : issue.status === "OPEN" || issue.status === "IN_PROGRESS" ? (
      <button type="button" disabled={pending} onClick={() => patch({ status: "RESOLVED" })} className={SMALL_BTN}>
        <span aria-hidden="true" className="text-[#0b6a0b]">✓</span> {t("pane.resolveAction")}
      </button>
    ) : issue.status === "CLOSED" ? (
      <button type="button" disabled={pending} onClick={() => patch({ status: "OPEN" })} className={SMALL_BTN}>
        {t("pane.reopen")}
      </button>
    ) : null;

  const select = "h-7 w-full min-w-0 rounded border border-[#e1dfdd] bg-white px-1.5 text-[12.5px] disabled:bg-transparent disabled:border-transparent disabled:appearance-none";
  const timeline = issue.events.filter((e) => e.kind !== "CREATED");

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white" aria-label={`${issue.ref} ${issue.title}`}>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-4 pb-12 md:px-6">
          <div className="flex items-center gap-3 pt-3 text-[12.5px]">
            <Link href={listHref} className="text-link hover:underline">
              {t("pane.backToList")}
            </Link>
            <span className="flex-1" />
            <button
              type="button"
              onClick={copyPrompt}
              title={t("pane.copyPromptHint")}
              className="inline-flex items-center gap-1 text-ink-2 hover:text-link"
            >
              <Icon name="copy" size={12} />
              {t("pane.copyPrompt")}
            </button>
            <button type="button" onClick={copyLink} className="inline-flex items-center gap-1 text-ink-2 hover:text-link">
              <Icon name="link" size={12} />
              {t("pane.copyLink")}
            </button>
          </div>
          {toast && <p className="mt-2 rounded bg-[#eff6fc] px-3 py-1.5 text-[12px] text-link">{toast}</p>}

          {/* 제목 */}
          <header className="border-b border-[#edebe9] pb-3 pt-1.5">
            <div className="flex items-start gap-2.5">
              <span className="pt-[5px] font-mono text-[15px] text-ink-3 md:text-[17px]">{issue.ref}</span>
              <GrowingTextarea
                value={title}
                readOnly={!canWrite}
                aria-label={t("pane.titleLabel")}
                onChange={(e) => setTitle(oneLine(e.target.value))}
                onBlur={() => title.trim() && title !== issue.title && patch({ title })}
                onKeyDown={(e) => onEnter(e, () => e.currentTarget.blur())}
                className="min-w-0 flex-1 bg-transparent text-[19px] font-semibold leading-snug outline-none md:text-[22px]"
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
              <StatusPill status={issue.status} />
              <span>
                {t.rich("pane.opened", {
                  name: issue.reporter?.name ?? t("pane.unknown"),
                  when: ago(issue.createdAt),
                  count: issue.commentCount,
                  b: (chunks) => <b className="font-semibold text-ink">{chunks}</b>,
                })}
              </span>
            </div>
            {canWrite && issue.status === "RESOLVED" && (isReporter || isAdmin) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded bg-[#dff6dd] px-3 py-2 text-[12.5px] text-[#0b6a0b]">
                <span className="flex-1">{t("pane.resolvedBanner")}</span>
                <button type="button" disabled={pending} onClick={() => patch({ status: "CLOSED" })} className="rounded bg-[#0b6a0b] px-2.5 py-0.5 text-white">
                  {t("pane.confirmClose")}
                </button>
                <button type="button" disabled={pending} onClick={() => patch({ status: "OPEN" })} className="rounded border border-[#0b6a0b] px-2.5 py-0.5">
                  {t("pane.reopen")}
                </button>
              </div>
            )}
          </header>

          {/* 좁은 화면: 필드 요약 칩 — 누르면 아래에 필드 칸이 펼쳐진다 */}
          <button
            type="button"
            aria-expanded={fieldsOpen}
            onClick={() => setFieldsOpen((v) => !v)}
            className="mt-3 flex w-full flex-wrap items-center gap-1.5 text-left text-[12px] lg:hidden"
          >
            <span className="rounded-full border border-[#e1dfdd] px-2 py-px">{issue.assignee?.name ?? t("pane.noAssignee")}</span>
            <span className="rounded-full border border-[#e1dfdd] px-2 py-px">{t(`priority.${issue.priority}`)}</span>
            {issue.dueDate && <span className="rounded-full border border-[#e1dfdd] px-2 py-px">{dateLabel(issue.dueDate)}</span>}
            {issue.labelIds.length > 0 && <span className="rounded-full border border-[#e1dfdd] px-2 py-px">{t("pane.labelCount", { count: issue.labelIds.length })}</span>}
            <span className="ml-auto text-link">{fieldsOpen ? t("pane.collapseFields") : t("pane.expandFields")}</span>
          </button>

          <div className="mt-4 grid gap-x-7 gap-y-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            {/* 필드 — 넓으면 오른쪽 열, 좁으면 요약 칩을 눌렀을 때 격자로 */}
            <aside
              aria-label={t("pane.fields")}
              className={`${fieldsOpen ? "grid" : "hidden"} grid-cols-2 gap-x-4 rounded border border-[#edebe9] px-3 py-1 text-[12.5px] sm:grid-cols-3 lg:col-start-2 lg:row-start-1 lg:!block lg:self-start lg:border-0 lg:p-0`}
            >
              <Field label={t("pane.status")}>
                {canWrite ? (
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
                ) : (
                  <StatusPill status={issue.status} />
                )}
              </Field>

              <Field label={t("pane.assignee")}>
                <span className="flex min-w-0 items-center gap-1.5">
                  {issue.assignee && <Face name={issue.assignee.name} color={issue.assignee.avatarColor} size={20} />}
                  <select
                    aria-label={t("pane.assignee")}
                    value={issue.assigneeId ?? ""}
                    disabled={!canWrite || pending}
                    onChange={(e) => patch({ assigneeId: e.target.value || null })}
                    className={select}
                  >
                    <option value="">{t("pane.noAssignee")}</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.userId === meId ? t("pane.me", { name: m.name }) : m.name}
                      </option>
                    ))}
                  </select>
                </span>
              </Field>

              <Field label={t("pane.priority")}>
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
              </Field>

              <Field label={t("pane.labels")}>
                {/* 늘 펼쳐 두고 누르면 붙이고 떼기, ‘＋ 새 라벨’ 은 이슈를 고칠 수 있는 사람 누구나(2026-10-13) */}
                <LabelPicker
                  labels={labels}
                  selected={issue.labelIds}
                  readOnly={!canWrite}
                  disabled={pending}
                  onToggle={(id) =>
                    patch({ labelIds: issue.labelIds.includes(id) ? issue.labelIds.filter((x) => x !== id) : [...issue.labelIds, id] })
                  }
                  onCreate={createLabel}
                />
              </Field>

              <Field label={t("pane.due")}>
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
              </Field>

              <Field label={t("pane.reporter")}>
                <span className="flex min-w-0 items-center gap-1.5">
                  {issue.reporter && <Face name={issue.reporter.name} color={issue.reporter.avatarColor} size={20} />}
                  <span className="truncate">{issue.reporter?.name ?? t("pane.unknown")}</span>
                </span>
              </Field>

              <Field label={t("pane.watch")}>
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="text-ink-2">{t("pane.watchers", { count: issue.watcherCount })}</span>
                  <button
                    type="button"
                    disabled={pending}
                    aria-pressed={issue.isWatching}
                    onClick={() => act(() => setWatchingAction(issue.id, !issue.isWatching))}
                    className="text-link hover:underline"
                  >
                    {issue.isWatching ? t("pane.watchOff") : t("pane.watchOn")}
                  </button>
                </span>
              </Field>

              {issue.sourceMessageId && (
                <Field label={t("pane.sourceMessage")}>
                  <Link href={`${pathname}?msg=${issue.sourceMessageId}`} className="text-link hover:underline">
                    {t("pane.viewSource")}
                  </Link>
                </Field>
              )}

              {issue.canDelete && canWrite && (
                <div className="col-span-full py-2.5 lg:pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t("pane.confirmDeleteIssue", { ref: issue.ref }))) {
                        act(() => deleteIssueAction(issue.id), () => router.push(listHref));
                      }
                    }}
                    className="text-[12px] text-danger hover:underline"
                  >
                    {t("pane.deleteIssue")}
                  </button>
                </div>
              )}
            </aside>

            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              {/* 본문 */}
              <article className="rounded-md border border-[#e1dfdd]">
                <div className="flex items-center gap-2 rounded-t-md border-b border-[#e1dfdd] bg-side-bg px-3 py-1.5 text-[12.5px] text-ink-2">
                  <b className="font-semibold text-ink">{issue.reporter?.name ?? t("pane.unknown")}</b>
                  {ago(issue.createdAt)}
                  <span className="flex-1" />
                  {canWrite && !editingBody && (
                    <button type="button" onClick={() => setEditingBody(true)} className="text-ink-3 hover:text-link">
                      {t("pane.editBody")}
                    </button>
                  )}
                </div>
                <div className="px-3.5 py-3">
                  {editingBody ? (
                    <IssueEditor
                      mode="edit"
                      initial={issue.body}
                      existing={issue.attachments}
                      members={editorMembers}
                      knownNames={mentionNames}
                      placeholder={t("editor.bodyPlaceholder")}
                      ariaLabel={t("pane.bodyLabel")}
                      minHeight={200}
                      maxHeight={560}
                      onSubmit={saveBody}
                      onCancel={() => setEditingBody(false)}
                    />
                  ) : issue.body.trim() ? (
                    <IssueMarkdown body={issue.body} mentions={mentionNames} meId={meId} issueKey={issueKey} />
                  ) : (
                    <p className="text-[13px] text-ink-3">{t("pane.noBody")}</p>
                  )}
                  {!editingBody && <Files files={issue.attachments} onView={onView} />}
                </div>
              </article>

              {/* 타임라인 — 댓글 카드 사이에 바뀐 기록이 가는 줄로 */}
              <ol aria-label={t("pane.activity")} className="ml-[13px] border-l-2 border-[#edebe9] pl-0">
                {timeline.map((e) =>
                  e.kind === "COMMENT" ? (
                    <Comment
                      key={e.id}
                      e={e}
                      meId={meId}
                      issueKey={issueKey}
                      mentions={mentionNames}
                      canEdit={canWrite && e.isMine}
                      canDelete={canWrite && (e.isMine || isAdmin)}
                      members={editorMembers}
                      onSave={(text, files, removeIds) => saveComment(e.id, text, files, removeIds)}
                      onDelete={() => window.confirm(t("comment.confirmDelete")) && act(() => deleteCommentAction(e.id))}
                      onView={onView}
                    />
                  ) : (
                    <li key={e.id} data-event={e.kind} className="relative py-2 pl-6 text-[12.5px] text-ink-2">
                      <span aria-hidden="true" className="absolute -left-[7px] top-[13px] h-3 w-3 rounded-full border-2 border-[#c8c6c4] bg-white" />
                      <b className="font-semibold text-ink">{e.actor?.name ?? t("pane.unknown")}</b> {describeEvent(e, t as unknown as Translate, nameOf, dateLabel)}
                      <span className="text-ink-3"> · {ago(e.createdAt)}</span>
                    </li>
                  ),
                )}
                <li className="relative pb-1 pl-6 pt-3">
                  <span aria-hidden="true" className="absolute -left-[7px] top-[22px] h-3 w-3 rounded-full bg-[#c8c6c4]" />
                  {error && <p className="mb-2 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}
                  <IssueEditor
                    mode="compose"
                    placeholder={t("pane.commentPlaceholder")}
                    ariaLabel={t("editor.commentWrite")}
                    disabled={!canWrite}
                    disabledHint={t("pane.archivedHint")}
                    members={editorMembers}
                    knownNames={mentionNames}
                    actions={statusAction}
                    onSubmit={(text, files) => sendComment(text, files)}
                  />
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      {viewer && <ImageViewer images={viewer.images} start={viewer.start} onClose={() => setViewer(null)} />}
    </section>
  );
}

/** multipart 요청 → ActionResult(서버 액션과 같은 모양). 파일이 실린 글은 라우트로 보낸다. */
async function sendForm(
  url: string,
  method: "POST" | "PATCH",
  input: { body: string; files: File[]; removeIds?: string[] },
  unauthenticated: string,
  fail: string,
): Promise<ActionResult<unknown>> {
  const fd = new FormData();
  fd.set("body", input.body);
  for (const f of input.files) fd.append("files", f, f.name);
  for (const id of input.removeIds ?? []) fd.append("remove", id);
  const r = await fetch(url, { method, body: fd }).catch(() => null);
  const data = r ? ((await r.json().catch(() => ({}))) as { error?: string }) : {};
  if (r?.status === 401) return { ok: false, error: unauthenticated, code: "unauthenticated" };
  return r?.ok ? { ok: true, data: null } : { ok: false, error: data.error ?? fail, code: "unknown" };
}

const SMALL_BTN = "inline-flex h-[26px] items-center gap-1 whitespace-nowrap rounded border border-[#c8c6c4] bg-white px-2.5 text-[12.5px] hover:bg-side-hover disabled:opacity-50";

/** 필드 한 칸 — 넓은 화면에서는 위아래로 쌓인 오른쪽 열, 좁은 화면에서는 격자 한 칸 */
function Field({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-[#edebe9] py-2 lg:border-b">
      <div className="mb-1 flex items-center justify-between text-[11.5px] text-ink-3">
        <span>{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * 붙인 파일. 사진은 본문 폭에 맞춰 크게(버그 리포트는 캡처가 본문이다) — 누르면 사진 보기 창,
 * 사진이 아닌 파일은 칩으로 받는다.
 */
function Files({ files, onView }: { files: AttachmentItem[]; onView: (images: AttachmentItem[], start: number) => void }) {
  const t = useTranslations("issues");
  if (files.length === 0) return null;
  const photos = files.filter((f) => isInlineImage(f.mimeType));
  const others = files.filter((f) => !isInlineImage(f.mimeType));
  return (
    <div className="mt-3">
      {photos.map((f, i) => (
        <figure key={f.id} className="mb-2.5 overflow-hidden rounded border border-[#e1dfdd]">
          <button type="button" aria-label={t("pane.viewFile", { name: f.name })} onClick={() => onView(photos, i)} className="block w-full cursor-zoom-in bg-[#faf9f8]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${f.id}`} alt="" className="mx-auto block max-h-[520px] max-w-full object-contain" />
          </button>
          <figcaption className="border-t border-[#edebe9] px-2.5 py-1 text-[11.5px] text-ink-3">
            {f.name} · {formatBytes(f.size)}
          </figcaption>
        </figure>
      ))}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {others.map((f) => (
            <a
              key={f.id}
              href={`/api/files/${f.id}`}
              className="inline-flex items-center gap-1.5 rounded border border-[#e1dfdd] px-2 py-1 text-[12px] hover:bg-side-hover"
            >
              <Icon name="clip" size={12} className="text-ink-2" />
              <span className="max-w-[220px] truncate">{f.name}</span>
              <span className="text-ink-3">{formatBytes(f.size)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** 타임라인의 댓글 카드 — 얼굴은 타임라인 선 위에 */
function Comment({
  e,
  meId,
  issueKey,
  mentions,
  canEdit,
  canDelete,
  members,
  onSave,
  onDelete,
  onView,
}: {
  e: IssueEventItem;
  meId: string;
  issueKey: string | null;
  mentions: { userId: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
  members: EditorMember[];
  onSave: (text: string, files: File[], removeIds: string[]) => Promise<boolean>;
  onDelete: () => void;
  onView: (images: AttachmentItem[], start: number) => void;
}) {
  const t = useTranslations("issues");
  const tp = useTranslations("projects");
  const tz = useTimeZone();
  const [editing, setEditing] = useState(false);
  return (
    <li className="group relative py-2 pl-6" data-comment={e.id}>
      <span className="absolute -left-[15px] top-[10px]">
        {e.actor ? <Face name={e.actor.name} color={e.actor.avatarColor} size={28} /> : <span className="block h-7 w-7 rounded-full bg-pane-bg" />}
      </span>
      <div className="rounded-md border border-[#e1dfdd] bg-white">
        <div className="flex items-center gap-1.5 rounded-t-md border-b border-[#e1dfdd] bg-side-bg px-3 py-1.5 text-[12.5px]">
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
        <div className="px-3 py-2 text-[13.5px]">
          {e.deleted ? (
            <p className="text-ink-3">{t("comment.deleted")}</p>
          ) : editing ? (
            <IssueEditor
              mode="edit"
              initial={e.body}
              existing={e.attachments}
              members={members}
              knownNames={mentions}
              placeholder={t("editor.commentLabel")}
              ariaLabel={t("comment.editLabel")}
              onSubmit={async (text, files, removeIds) => {
                const ok = await onSave(text, files, removeIds);
                if (ok) setEditing(false);
                return ok;
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            e.body && <IssueMarkdown body={e.body} mentions={mentions} meId={meId} issueKey={issueKey} />
          )}
          {!e.deleted && !editing && <Files files={e.attachments} onView={onView} />}
        </div>
      </div>
    </li>
  );
}
