"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { RichEditor, type EditorMember, type RichEditorHandle } from "@/components/issues/RichEditor";
import { checkFile, formatBytes, isInlineImage, MAX_FILES_PER_MESSAGE } from "@/lib/files/policy";
import type { AttachmentItem } from "@/lib/queries/list";

/**
 * 이슈 글 쓰기·고치기 칸(2026-10-20) — 편집기(RichEditor) + 붙일 파일 + 아래 줄.
 *
 * compose: 댓글 쓰기. 보내면 비운다. 아래 줄에 상태 버튼(actions)과 보내기.
 * edit: 본문·댓글 고치기. 붙어 있던 파일도 보이고 ✕ 로 뺄 수 있다. 취소·저장.
 * 파일은 📎·붙여넣기(Ctrl+V)·끌어 놓기로 붙고, 글과 함께 한 번에 나간다. 사진은 글 아래 첨부(정할 것 3 A).
 */
type Pending = { key: number; file: File; preview: string | null };

export function IssueEditor({
  mode,
  initial = "",
  existing = [],
  members,
  knownNames,
  placeholder,
  ariaLabel,
  actions,
  disabled,
  disabledHint,
  minHeight,
  maxHeight,
  onSubmit,
  onCancel,
}: {
  mode: "compose" | "edit";
  initial?: string;
  /** 고칠 때 이미 붙어 있는 파일 */
  existing?: AttachmentItem[];
  members: EditorMember[];
  knownNames?: { userId: string; name: string }[];
  placeholder: string;
  ariaLabel: string;
  actions?: React.ReactNode;
  disabled?: boolean;
  disabledHint?: string;
  minHeight?: number;
  maxHeight?: number;
  /** 성공하면 true — compose 는 비우고, edit 는 부르는 쪽이 닫는다 */
  onSubmit: (body: string, files: File[], removeIds: string[]) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const t = useTranslations("issues");
  const tp = useTranslations("projects");
  const tAll = useTranslations() as unknown as (key: string, values?: Record<string, string | number>) => string;
  const editor = useRef<RichEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const [files, setFiles] = useState<Pending[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(!initial.trim());
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), [files]);

  const kept = existing.filter((a) => !removed.includes(a.id));
  const canSubmit = !busy && !disabled && (mode === "edit" || !empty || files.length > 0);

  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    setFileError(null);
    setFiles((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (kept.length + next.length >= MAX_FILES_PER_MESSAGE) {
          setFileError(t("errors.tooManyFiles", { max: MAX_FILES_PER_MESSAGE }));
          break;
        }
        const c = checkFile(f.name, f.size);
        if (!c.ok) {
          setFileError(tAll(c.key, c.values));
          continue;
        }
        next.push({ key: nextKey.current++, file: f, preview: isInlineImage(f.type) ? URL.createObjectURL(f) : null });
      }
      return next;
    });
  }

  async function submit() {
    if (!canSubmit || !editor.current) return;
    setBusy(true);
    const ok = await onSubmit(editor.current.getMarkdown(), files.map((f) => f.file), removed);
    setBusy(false);
    if (ok && mode === "compose") {
      editor.current.clear();
      setFiles([]);
      setFileError(null);
      setEmpty(true);
      editor.current.focus();
    }
  }

  if (disabled && mode === "compose") {
    return (
      <div className="rounded border border-[#e1dfdd] bg-[#f3f2f1] px-3 py-2.5 text-[13px] text-ink-2">{disabledHint ?? tp("composer.locked")}</div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        // 편집 칸 안에 떨어뜨린 것은 편집기가 받는다(handleDrop). 그 밖(파일 줄·아래 줄)은 여기서.
        if (e.defaultPrevented || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        addFiles([...e.dataTransfer.files]);
      }}
      className={`relative rounded-md border bg-white focus-within:border-link focus-within:shadow-[0_0_0_1px_#2564cf] ${
        dragOver ? "border-dashed border-link" : "border-[#8a8886]"
      }`}
    >
      <RichEditor
        ref={editor}
        initial={initial}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        members={members}
        knownNames={knownNames}
        disabled={busy}
        autoFocus={mode === "edit"}
        minHeight={minHeight ?? (mode === "edit" ? 120 : 64)}
        maxHeight={maxHeight ?? 420}
        onChange={(md) => setEmpty(!md.trim())}
        onFiles={addFiles}
        onAttach={() => fileRef.current?.click()}
        onSubmit={() => void submit()}
      />

      {(kept.length > 0 || files.length > 0 || removed.length > 0) && (
        <ul className="flex flex-wrap gap-2 border-t border-[#edebe9] px-3 py-2" aria-label={tp("composer.attachedFiles")}>
          {existing.map((a) => {
            const off = removed.includes(a.id);
            return (
              <li
                key={a.id}
                className={`inline-flex items-center gap-1.5 rounded border border-[#e1dfdd] py-1 pl-1.5 pr-1 text-[12px] ${off ? "bg-[#fdf3f4] text-ink-3 line-through" : "bg-[#faf9f8]"}`}
              >
                {isInlineImage(a.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${a.id}`} alt="" className="h-[22px] w-[22px] rounded-[3px] object-cover" />
                ) : (
                  <Icon name="clip" size={13} className="text-ink-2" />
                )}
                <span className="max-w-[180px] truncate">{a.name}</span>
                <span className="text-[11px] text-ink-3">{formatBytes(a.size)}</span>
                <button
                  type="button"
                  onClick={() => setRemoved((r) => (off ? r.filter((x) => x !== a.id) : [...r, a.id]))}
                  aria-label={off ? t("editor.restoreFile", { name: a.name }) : tp("composer.removeFile", { name: a.name })}
                  title={off ? t("editor.restore") : t("editor.remove")}
                  className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-side-hover hover:text-ink"
                >
                  <Icon name={off ? "plus" : "x"} size={12} />
                </button>
              </li>
            );
          })}
          {files.map((f) => (
            <li key={f.key} className="inline-flex items-center gap-1.5 rounded border border-[#e1dfdd] bg-[#eff6fc] py-1 pl-1.5 pr-1 text-[12px]">
              {f.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.preview} alt="" className="h-[22px] w-[22px] rounded-[3px] object-cover" />
              ) : (
                <Icon name="clip" size={13} className="text-ink-2" />
              )}
              <span className="max-w-[180px] truncate">{f.file.name}</span>
              <span className="text-[11px] text-ink-3">{formatBytes(f.file.size)}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))}
                aria-label={tp("composer.removeFile", { name: f.file.name })}
                className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-side-hover hover:text-ink"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {fileError && <p className="px-3 pb-2 text-[12px] text-danger">{fileError}</p>}

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

      <div className="flex items-center gap-1.5 border-t border-[#edebe9] px-2 py-1.5">
        <span className="ml-1 min-w-0 truncate text-[11.5px] text-ink-3 pointer-coarse:hidden">
          {mode === "compose" ? t("editor.hintCompose") : t("editor.hintEdit")}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {mode === "compose" ? (
            <>
              {actions}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-link px-3 text-[12.5px] text-white disabled:bg-[#c8c6c4] pointer-coarse:h-9 pointer-coarse:px-4 pointer-coarse:text-[14px]"
              >
                <Icon name="send" size={13} />
                {busy ? tp("composer.sending") : tp("composer.send")}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onCancel} disabled={busy} className="rounded border border-[#8a8886] px-3 py-0.5 text-[12.5px]">
                {t("editor.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="rounded bg-link px-3 py-0.5 text-[12.5px] text-white disabled:bg-[#c8c6c4]"
              >
                {busy ? t("editor.saving") : t("editor.save")}
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
