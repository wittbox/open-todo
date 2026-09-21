"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { encodeMentions } from "@/lib/mentions";
import { checkFile, formatBytes, isInlineImage, MAX_FILES_PER_MESSAGE, pastedImageName } from "@/lib/files/policy";

export type MentionCandidate = { userId: string; name: string; department: string | null; disabled?: boolean };

/** 캐럿 앞의 "@질문" — 자동완성을 열지 말지와 무엇으로 거를지 */
const QUERY_RE = /(^|\s)@([^\s@]{0,20})$/;

/** 손가락으로 쓰는 기기인지. 누를 때마다 묻는다(태블릿에 키보드를 붙였다 뗄 수 있다). */
const coarsePointer = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

type Pending = { key: number; file: File; preview: string | null };

/**
 * 메시지 입력창. Enter 전송, Shift+Enter 줄바꿈. 한글 조합을 끝내는 Enter 는 무시한다
 * (isComposing) — 마지막 글자가 잘려 나가는 것을 막는다. 보관된 프로젝트에서는 잠긴다.
 *
 * `@` 를 치면 멤버 자동완성이 뜬다(맨 위 '전체'). 화면에는 `@이름 ` 으로 들어가고, 보낼 때만
 * 고른 사람의 것을 `<@id>` 토큰으로 바꾼다 — 손으로 친 `@이름` 은 멘션이 아니다.
 * 이름 옆에 부서를 보여 동명이인을 가려 고른다.
 *
 * 파일은 클립 버튼·붙여넣기·끌어다 놓기로 붙고, 글과 함께 한 번에 나간다(대기 상태가 없다).
 * 크기·확장자는 여기서도 보지만 서버가 다시 본다.
 */
export function MessageComposer({
  placeholder,
  disabled,
  disabledHint,
  members = [],
  allowFiles = false,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  disabledHint?: string;
  /** @ 자동완성 후보. 없으면 자동완성이 뜨지 않는다 */
  members?: MentionCandidate[];
  allowFiles?: boolean;
  /** 성공하면 true — 입력칸을 비운다 */
  onSend: (body: string, files: File[]) => Promise<boolean>;
}) {
  const t = useTranslations("projects");
  // 파일 규칙(lib/files/policy.ts)이 주는 열쇠는 이름 공간까지 담고 있어 뿌리 번역기로 읽는다.
  const tAll = useTranslations();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<Pending[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const picks = useRef<{ name: string; id: string }[]>([]);
  const nextKey = useRef(1);
  const canSend = (value.trim().length > 0 || files.length > 0) && !busy && !disabled;

  // 미리보기 주소는 칩이 사라질 때 돌려준다.
  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), [files]);

  const candidates = useMemo(() => {
    if (query == null || members.length === 0) return [];
    const q = query.toLowerCase();
    const all: MentionCandidate = { userId: "all", name: t("message.mentionAll"), department: t("composer.mentionAllHint") };
    // 사용 중지된 사람은 부르지 않는다 — 알림이 닿지 않는다.
    const list = [all, ...members.filter((m) => !m.disabled)].filter(
      (m) => !q || m.name.toLowerCase().includes(q) || (m.department ?? "").toLowerCase().includes(q),
    );
    return list.slice(0, 8);
  }, [query, members, t]);
  const open = candidates.length > 0;

  function syncQuery(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = QUERY_RE.exec(before);
    setQuery(m ? m[2] : null);
    setIndex(0);
  }

  function pick(c: MentionCandidate) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = QUERY_RE.exec(before);
    if (!m) return;
    const start = before.length - m[2].length - 1; // '@' 자리
    const next = `${value.slice(0, start)}@${c.name} ${value.slice(caret)}`;
    picks.current.push({ name: c.name, id: c.userId });
    setValue(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = start + c.name.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function addFiles(incoming: File[]) {
    if (!allowFiles || incoming.length === 0) return;
    setFileError(null);
    setFiles((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (next.length >= MAX_FILES_PER_MESSAGE) {
          setFileError(tAll("files.errors.tooManyPerMessage", { max: MAX_FILES_PER_MESSAGE }));
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

  function removeFile(key: number) {
    setFiles((prev) => prev.filter((f) => f.key !== key));
  }

  async function submit() {
    if (!canSend) return;
    setBusy(true);
    const ok = await onSend(encodeMentions(value, picks.current), files.map((f) => f.file));
    setBusy(false);
    if (ok) {
      setValue("");
      setFiles([]);
      setFileError(null);
      picks.current = [];
      setQuery(null);
      const el = ref.current;
      if (el) {
        el.style.height = "auto";
        el.focus();
      }
    }
  }

  if (disabled) {
    return (
      <div className="mx-6 mb-4 mt-2 rounded border border-[#e1dfdd] bg-[#f3f2f1] px-3 py-2.5 text-[13px] text-ink-2">
        {disabledHint ?? t("composer.locked")}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (!allowFiles) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!allowFiles) return;
        e.preventDefault();
        setDragOver(false);
        addFiles([...e.dataTransfer.files]);
      }}
      className={`relative mx-6 mb-4 mt-2 rounded-md border bg-white focus-within:border-link focus-within:shadow-[0_0_0_1px_#2564cf] ${
        dragOver ? "border-link border-dashed" : "border-[#8a8886]"
      }`}
    >
      {open && (
        <ul
          role="listbox"
          aria-label={t("composer.mentionList")}
          className="absolute bottom-full left-2 z-20 mb-1.5 w-[280px] overflow-hidden rounded-md border border-[#e1dfdd] bg-white py-1 text-[13px] shadow-[0_6.4px_14.4px_rgba(0,0,0,.132),0_1.2px_3.6px_rgba(0,0,0,.108)]"
        >
          {candidates.map((c, i) => (
            <li key={c.userId}>
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left ${i === index ? "bg-side-hover" : ""}`}
              >
                {c.userId === "all" ? (
                  <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[#e6e4e2] text-[12px] font-bold text-ink-2">@</span>
                ) : (
                  <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[#8a8886] text-[9px] font-semibold text-white">
                    {c.name.slice(0, 2)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.department && <span className="shrink-0 text-[11.5px] text-ink-3">{c.department}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={ref}
        value={value}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          syncQuery(e.target);
        }}
        onClick={(e) => syncQuery(e.currentTarget)}
        onPaste={(e) => {
          if (!allowFiles) return;
          const items = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file");
          if (items.length === 0) return;
          e.preventDefault();
          const now = new Date();
          addFiles(
            items
              .map((i) => i.getAsFile())
              .filter((f): f is File => f != null)
              .map((f) => (f.type.startsWith("image/") && !f.name.includes(".") ? new File([f], pastedImageName(now, f.type, tAll("files.pastedImage")), { type: f.type }) : f)),
          );
        }}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 8 * 22 + 18)}px`;
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => (i + 1) % candidates.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => (i - 1 + candidates.length) % candidates.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(candidates[index]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          if (e.key !== "Enter" || e.shiftKey) return;
          // 터치 기기 자판에는 Shift+Enter 가 없다 — Enter 는 줄바꿈으로 두고 보내기는 버튼으로.
          if (coarsePointer()) return;
          e.preventDefault();
          void submit();
        }}
        className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] leading-[1.55] outline-none placeholder:text-ink-3"
      />

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-3 pb-2" aria-label={t("composer.attachedFiles")}>
          {files.map((f) => (
            <li key={f.key} className="inline-flex items-center gap-1.5 rounded border border-[#e1dfdd] bg-[#faf9f8] py-1 pl-1.5 pr-1 text-[12px]">
              {f.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.preview} alt="" className="h-[22px] w-[22px] rounded-[3px] object-cover" />
              ) : (
                <Icon name="clip" size={13} className="text-ink-2" />
              )}
              <span className="max-w-[180px] truncate">{f.file.name}</span>
              <span className="text-[11px] text-ink-3">{formatBytes(f.file.size)}</span>
              <button type="button" onClick={() => removeFile(f.key)} aria-label={t("composer.removeFile", { name: f.file.name })} className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-side-hover hover:text-ink">
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {fileError && <p className="px-3 pb-2 text-[12px] text-danger">{fileError}</p>}

      <div className="flex items-center gap-1 border-t border-[#edebe9] px-2 py-1.5">
        {allowFiles && (
          <>
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
            <button
              type="button"
              title={t("composer.attach")}
              aria-label={t("composer.attach")}
              onClick={() => fileRef.current?.click()}
              className="grid h-[26px] w-[26px] place-items-center rounded text-ink-2 hover:bg-side-hover pointer-coarse:h-10 pointer-coarse:w-10"
            >
              <Icon name="clip" size={15} />
            </button>
          </>
        )}
        {members.length > 0 && (
          <button
            type="button"
            title={t("composer.mention")}
            aria-label={t("composer.mention")}
            onClick={() => {
              const el = ref.current;
              if (!el) return;
              const caret = el.selectionStart ?? value.length;
              const before = value.slice(0, caret);
              const pad = before && !/\s$/.test(before) ? " " : "";
              const next = `${before}${pad}@${value.slice(caret)}`;
              setValue(next);
              setQuery("");
              setIndex(0);
              requestAnimationFrame(() => {
                const pos = before.length + pad.length + 1;
                el.focus();
                el.setSelectionRange(pos, pos);
              });
            }}
            className="grid h-[26px] w-[26px] place-items-center rounded text-ink-2 hover:bg-side-hover pointer-coarse:h-10 pointer-coarse:w-10"
          >
            <Icon name="at" size={15} />
          </button>
        )}
        <span className="ml-1 text-[11.5px] text-ink-3 pointer-coarse:hidden">{allowFiles ? t("composer.hintWithFiles") : t("composer.hint")}</span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          className="ml-auto inline-flex h-[26px] items-center gap-1.5 rounded bg-link px-3 text-[12.5px] text-white disabled:bg-[#c8c6c4] pointer-coarse:h-9 pointer-coarse:rounded-full pointer-coarse:px-4 pointer-coarse:text-[14px]"
        >
          <Icon name="send" size={13} />
          {busy ? t("composer.sending") : t("composer.send")}
        </button>
      </div>
    </div>
  );
}
