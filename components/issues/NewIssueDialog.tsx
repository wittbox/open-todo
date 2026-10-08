"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { BTN_CLASS, Dialog, INPUT_CLASS, PRIMARY_CLASS } from "@/components/project/Dialog";
import { LabelChip } from "@/components/issues/IssueBits";
import { createIssueAction } from "@/lib/actions/issue";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import { checkFile, formatBytes, pastedImageName } from "@/lib/files/policy";
import { PRIORITIES } from "@/lib/issues/format";
import type { ActionResult } from "@/lib/actions/_helpers";
import type { IssueLabelItem } from "@/lib/queries/issues";
import type { ProjectMemberItem } from "@/lib/queries/project";
import type { IssuePriority } from "@/app/generated/prisma/enums";

/**
 * 새 이슈. 본문은 프로젝트 템플릿으로 채워 두고, 화면 캡처는 Ctrl+V 로 붙인다.
 * 파일이 있으면 multipart 라우트, 없으면 서버 액션 — 메시지와 같은 길.
 */
export function NewIssueDialog({
  projectId,
  projectName,
  template,
  labels,
  members,
  from,
  onCreated,
  onClose,
}: {
  projectId: string;
  projectName: string;
  template: string;
  labels: IssueLabelItem[];
  members: ProjectMemberItem[];
  /** 메시지에서 만들 때 — 제목·본문을 채워 두고, 그 메시지의 파일은 서버가 복사해 붙인다 */
  from?: { messageId: string; title: string; body: string; fileCount: number };
  onCreated: (number: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("issues");
  const tp = useTranslations("projects");
  const tAll = useTranslations();
  const [title, setTitle] = useState(from?.title ?? "");
  const [body, setBody] = useState(from?.body ?? template);
  // 라벨은 미리 골라 두지 않는다 — 실수로 붙는 것보다 비어 있는 편이 낫다.
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<IssuePriority>("NORMAL");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function addFiles(list: File[]) {
    for (const f of list) {
      const c = checkFile(f.name, f.size);
      if (!c.ok) {
        setError(tAll(c.key, c.values));
        return;
      }
    }
    setError(null);
    setFiles((prev) => [...prev, ...list]);
  }

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const fields = { title, body, priority, assigneeId: assigneeId || null, labelIds, dueDate: dueDate || null, sourceMessageId: from?.messageId ?? null };
    let res: ActionResult<{ id: string; number: number }>;
    if (files.length === 0) {
      res = await runAction(() => createIssueAction({ projectId, ...fields }));
    } else {
      const fd = new FormData();
      fd.set("title", title);
      fd.set("body", body);
      fd.set("priority", priority);
      if (assigneeId) fd.set("assigneeId", assigneeId);
      if (dueDate) fd.set("dueDate", dueDate);
      if (from) fd.set("sourceMessageId", from.messageId);
      for (const id of labelIds) fd.append("labelIds", id);
      for (const f of files) fd.append("files", f, f.name);
      const r = await fetch(`/api/projects/${projectId}/issues`, { method: "POST", body: fd }).catch(() => null);
      const data = r ? ((await r.json().catch(() => ({}))) as { issue?: { id: string; number: number }; error?: string }) : {};
      res =
        r?.status === 401
          ? { ok: false, error: tp("send.unauthenticated"), code: "unauthenticated" }
          : r?.ok && data.issue
            ? { ok: true, data: data.issue }
            : { ok: false, error: data.error ?? t("new.failed"), code: "unknown" };
    }
    setBusy(false);
    if (!res.ok) {
      if (!handledAuthFailure(res)) setError(res.error);
      return;
    }
    onCreated(res.data.number);
  }

  return (
    <Dialog title={t("new.title", { project: projectName })} width={600} onClose={onClose}>
      <div
        onPaste={(e) => {
          const images = [...e.clipboardData.items]
            .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
            .map((i) => i.getAsFile())
            .filter((f): f is File => f != null);
          if (images.length === 0) return;
          e.preventDefault();
          const now = new Date();
          addFiles(images.map((f) => new File([f], pastedImageName(now, f.type, tAll("files.pastedImage")), { type: f.type })));
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={t("new.titlePlaceholder")}
          aria-label={t("new.titleLabel")}
          className={INPUT_CLASS}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          aria-label={t("new.bodyLabel")}
          placeholder={t("new.bodyPlaceholder")}
          className="mt-2.5 w-full resize-y rounded border border-[#8a8886] px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-link focus:shadow-[0_0_0_1px_#2564cf]"
        />

        <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <label className="text-xs text-ink-2">
            {t("new.priority")}
            <select value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)} className={`${INPUT_CLASS} mt-1`}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-2">
            {t("new.assignee")}
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={`${INPUT_CLASS} mt-1`}>
              <option value="">{t("new.unassigned")}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.isMe ? t("new.me", { name: m.name }) : m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-2">
            {t("new.due")}
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${INPUT_CLASS} mt-1`} />
          </label>
        </div>

        {labels.length > 0 && (
          <div className="mt-2.5">
            <div className="text-xs text-ink-2">{t("new.labels")}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {labels.map((l) => {
                const on = labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setLabelIds((ids) => (on ? ids.filter((x) => x !== l.id) : [...ids, l.id]))}
                    className={`rounded-full ${on ? "ring-2 ring-link ring-offset-1" : "opacity-60 hover:opacity-100"}`}
                  >
                    <LabelChip name={l.name} color={l.color} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 hover:text-ink">
            <Icon name="clip" size={14} />
            {t("new.attach")}
          </button>
          <span className="text-ink-3">{t("new.pasteHint")}</span>
          {from && from.fileCount > 0 && <span className="text-ink-3">{t("new.fromFiles", { count: from.fileCount })}</span>}
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded border border-[#e1dfdd] px-1.5 py-0.5 text-[12px] text-ink">
              {f.name} <span className="text-ink-3">{formatBytes(f.size)}</span>
              <button type="button" aria-label={t("new.removeFile", { name: f.name })} onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))}>
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>

        {error && <p className="mt-3 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_CLASS}>
            {t("new.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={!title.trim() || busy} className={PRIMARY_CLASS}>
            {busy ? t("new.creating") : t("new.create")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
