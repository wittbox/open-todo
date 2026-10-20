"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, ReactRenderer, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import Mention from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { pastedImageName } from "@/lib/files/policy";

/**
 * 이슈 글 편집기(2026-10-20 — 보이는 그대로 편집, TipTap 3).
 *
 * 쓰는 동안 굵게·목록·체크가 그대로 보이고, 저장은 **마크다운 글자**로 한다(@tiptap/markdown) — 그래서
 * 예전 글·Claude Code 용 복사·검색·알림이 그대로 동작한다. @부르기는 `<@사람id>` 토큰으로 저장한다(메시지와 같은 규칙).
 * 붙여넣거나 끌어 놓은 파일은 글에 넣지 않고 `onFiles` 로 넘긴다 — 사진은 글 아래 첨부로 붙는다(정할 것 3 A).
 */

export type EditorMember = { userId: string; name: string; department?: string | null };

export type RichEditorHandle = {
  /** 지금 글(마크다운) */
  getMarkdown: () => string;
  /** 비우기 — 보낸 뒤 */
  clear: () => void;
  focus: () => void;
};

const MENTION_TOKEN = /^<@(all|[a-z0-9]{20,32})>/;

export const RichEditor = forwardRef<
  RichEditorHandle,
  {
    initial?: string;
    placeholder: string;
    ariaLabel: string;
    members: EditorMember[];
    /** 이미 글 안에 있는 멘션의 이름(멤버가 아닌 사람 포함) */
    knownNames?: { userId: string; name: string }[];
    onChange?: (markdown: string) => void;
    /** 붙여넣기·끌어 놓기로 들어온 파일 */
    onFiles?: (files: File[]) => void;
    /** 📎 버튼 */
    onAttach?: () => void;
    /** Ctrl+Enter */
    onSubmit?: () => void;
    disabled?: boolean;
    autoFocus?: boolean;
    /** 편집 칸의 최소 높이(px) */
    minHeight?: number;
    /** 편집 칸이 이 높이를 넘으면 안에서 스크롤 */
    maxHeight?: number;
  }
>(function RichEditor(
  { initial = "", placeholder, ariaLabel, members, knownNames = [], onChange, onFiles, onAttach, onSubmit, disabled, autoFocus, minHeight = 96, maxHeight },
  ref,
) {
  // 콜백은 바뀌어도 편집기를 다시 만들지 않게 ref 로 둔다
  const cb = useRef({ onChange, onFiles, onSubmit });
  useEffect(() => {
    cb.current = { onChange, onFiles, onSubmit };
  });

  const t = useTranslations("issues");
  const tp = useTranslations("projects");
  const allLabel = tp("message.mentionAll");
  const unknownLabel = tp("message.unknownUser");
  const allHint = tp("composer.mentionAllHint");
  const pastedLabel = useTranslations("files")("pastedImage");
  const words = useRef({ allLabel, unknownLabel, allHint, pastedLabel });
  useEffect(() => {
    words.current = { allLabel, unknownLabel, allHint, pastedLabel };
  });
  const names = useMemo(() => {
    const m = new Map<string, string>([["all", allLabel]]);
    for (const k of knownNames) m.set(k.userId, k.name);
    for (const k of members) m.set(k.userId, k.name);
    return m;
  }, [members, knownNames, allLabel]);
  const namesRef = useRef(names);
  const membersRef = useRef(members);
  useEffect(() => {
    namesRef.current = names;
    membersRef.current = members;
  });

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // 마크다운에 밑줄이 없다 — 저장하면 사라지므로 아예 뺀다
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      Mention.extend({
        // 저장 형식: <@id> — 메시지·알림·검색이 쓰는 토큰 그대로
        markdownTokenName: "issueMention",
        markdownTokenizer: {
          name: "issueMention",
          level: "inline",
          start: (src: string) => src.indexOf("<@"),
          tokenize: (src: string) => {
            const m = MENTION_TOKEN.exec(src);
            return m ? { type: "issueMention", raw: m[0], id: m[1] } : undefined;
          },
        },
        parseMarkdown: (token, h) => h.createNode("mention", { id: token.id, label: namesRef.current.get(token.id) ?? words.current.unknownLabel }),
        renderMarkdown: (node) => `<@${node.attrs?.id}>`,
      }).configure({
        HTMLAttributes: { class: "rounded bg-[#eff4fc] px-0.5 font-semibold text-[#1b4b9b]" },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        // 목록을 열 때마다 최신 멤버를 읽는다(그리는 동안 읽지 않는다)
        // eslint-disable-next-line react-hooks/refs
        suggestion: mentionSuggestion(() => membersRef.current, () => words.current),
      }),
    ],
    // 편집기는 한 번만 만든다 — 멤버·이름은 ref 로 최신을 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    extensions,
    content: initial,
    contentType: "markdown",
    immediatelyRender: false,
    editable: !disabled,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "issue-editor outline-none px-3 py-2.5 text-[13.5px] leading-[1.6]",
        // 빈 곳을 눌러도 글 칸에 들어가게 편집 칸 자체가 최소 높이를 갖는다
        style: `min-height:${minHeight}px`,
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.items ?? [])]
          .filter((i) => i.kind === "file")
          .map((i) => i.getAsFile())
          .filter((f): f is File => f != null);
        if (files.length === 0 || !cb.current.onFiles) return false;
        const now = new Date();
        cb.current.onFiles(
          files.map((f) => (f.type.startsWith("image/") && !f.name.includes(".") ? new File([f], pastedImageName(now, f.type, words.current.pastedLabel), { type: f.type }) : f)),
        );
        return true;
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (files.length === 0 || !cb.current.onFiles) return false;
        event.preventDefault();
        cb.current.onFiles(files);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing && cb.current.onSubmit) {
          event.preventDefault();
          cb.current.onSubmit();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => cb.current.onChange?.(editor.getMarkdown()),
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => editor?.getMarkdown() ?? "",
      clear: () => editor?.commands.clearContent(true),
      focus: () => editor?.commands.focus("end"),
    }),
    [editor],
  );

  return (
    <div className="min-w-0">
      <Toolbar editor={editor} disabled={disabled} onAttach={onAttach} canMention={members.length > 0} t={t} />
      <div className="thin-scroll overflow-y-auto" style={{ maxHeight }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

function Toolbar({
  editor,
  disabled,
  onAttach,
  canMention,
  t,
}: {
  editor: Editor | null;
  disabled?: boolean;
  onAttach?: () => void;
  canMention: boolean;
  t: ReturnType<typeof useTranslations<"issues">>;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      strike: e?.isActive("strike") ?? false,
      heading: e?.isActive("heading") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      task: e?.isActive("taskList") ?? false,
      quote: e?.isActive("blockquote") ?? false,
      code: e?.isActive("code") ?? false,
      codeBlock: e?.isActive("codeBlock") ?? false,
      link: e?.isActive("link") ?? false,
    }),
  });
  if (!editor) return <div className="h-[35px] border-b border-[#edebe9] bg-[#faf9f8]" />;
  const c = () => editor.chain().focus();
  const btn = (label: string, on: boolean | undefined, run: () => void, child: React.ReactNode, title?: string) => (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={`grid h-[26px] min-w-[26px] place-items-center rounded px-1 text-[13px] text-ink-2 hover:bg-side-hover disabled:opacity-40 ${on ? "bg-[#e1dfdd] text-ink" : ""}`}
    >
      {child}
    </button>
  );
  const sep = <span aria-hidden="true" className="mx-0.5 h-[18px] w-px bg-[#e1dfdd]" />;
  return (
    <div role="toolbar" aria-label={t("editor.toolbar")} className="flex flex-wrap items-center gap-0.5 border-b border-[#edebe9] bg-[#faf9f8] px-1.5 py-1">
      {btn(t("editor.bold"), s?.bold, () => c().toggleBold().run(), <b>B</b>, t("editor.boldHint"))}
      {btn(t("editor.italic"), s?.italic, () => c().toggleItalic().run(), <i className="font-serif">I</i>, t("editor.italicHint"))}
      {btn(t("editor.strike"), s?.strike, () => c().toggleStrike().run(), <s>S</s>)}
      {btn(t("editor.heading"), s?.heading, () => c().toggleHeading({ level: 3 }).run(), <span className="font-semibold">H</span>)}
      {sep}
      {btn(t("editor.bulletList"), s?.bullet, () => c().toggleBulletList().run(), "•≡")}
      {btn(t("editor.orderedList"), s?.ordered, () => c().toggleOrderedList().run(), "1.")}
      {btn(t("editor.taskList"), s?.task, () => c().toggleTaskList().run(), "☑")}
      {sep}
      {btn(t("editor.quote"), s?.quote, () => c().toggleBlockquote().run(), "❝")}
      {btn(t("editor.code"), s?.code || s?.codeBlock, () => (editor.state.selection.empty ? c().toggleCodeBlock().run() : c().toggleCode().run()), <span className="font-mono text-[12px]">&lt;/&gt;</span>, t("editor.codeHint"))}
      {btn(
        t("editor.link"),
        s?.link,
        () => {
          if (editor.isActive("link")) {
            c().unsetLink().run();
            return;
          }
          const url = window.prompt(t("editor.linkPrompt"), "https://");
          if (!url || !/^(https?:\/\/|mailto:)/i.test(url.trim())) return;
          c().extendMarkRange("link").setLink({ href: url.trim() }).run();
        },
        <Icon name="link" size={14} />,
      )}
      {(onAttach || canMention) && sep}
      {onAttach && btn(t("editor.attach"), false, onAttach, <Icon name="clip" size={14} />)}
      {canMention && btn(t("editor.mention"), false, () => c().insertContent("@").run(), <Icon name="at" size={14} />)}
    </div>
  );
}

/* ── @부르기 ── */

type MentionItem = { id: string; label: string; department: string | null };

function mentionSuggestion(getMembers: () => EditorMember[], getWords: () => { allLabel: string; allHint: string }) {
  return {
    char: "@",
    items: ({ query }: { query: string }): MentionItem[] => {
      const q = query.toLowerCase();
      const w = getWords();
      const all: MentionItem = { id: "all", label: w.allLabel, department: w.allHint };
      return [all, ...getMembers().map((m) => ({ id: m.userId, label: m.name, department: m.department ?? null }))]
        .filter((m) => !q || m.label.toLowerCase().includes(q) || (m.department ?? "").toLowerCase().includes(q))
        .slice(0, 8);
    },
    render: () => {
      let r: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
      const place = (props: SuggestionProps<MentionItem>) => {
        const rect = props.clientRect?.();
        const el = r?.element as HTMLElement | undefined;
        if (!rect || !el) return;
        el.style.position = "fixed";
        el.style.left = `${Math.min(rect.left, window.innerWidth - 290)}px`;
        el.style.top = `${rect.bottom + 4}px`;
        el.style.zIndex = "60";
      };
      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          r = new ReactRenderer(MentionList, { props, editor: props.editor });
          document.body.appendChild(r.element);
          place(props);
        },
        onUpdate: (props: SuggestionProps<MentionItem>) => {
          r?.updateProps(props);
          place(props);
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            r?.destroy();
            r?.element.remove();
            r = null;
            return true;
          }
          return r?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          r?.destroy();
          r?.element.remove();
          r = null;
        },
      };
    },
  };
}

type MentionListHandle = { onKeyDown: (e: KeyboardEvent) => boolean };
type MentionListProps = SuggestionProps<MentionItem>;

const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList({ items, command }, ref) {
  const tp = useTranslations("projects");
  const [index, setIndex] = useState(0);
  const [prevItems, setPrevItems] = useState(items);
  if (prevItems !== items) {
    setPrevItems(items);
    setIndex(0);
  }
  const pick = (i: number) => {
    const it = items[i];
    if (it) command({ id: it.id, label: it.label });
  };
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (items.length === 0) return false;
      if (e.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        pick(index);
        return true;
      }
      return false;
    },
  }));
  if (items.length === 0) return null;
  return (
    <ul
      role="listbox"
      aria-label={tp("composer.mentionList")}
      className="w-[280px] overflow-hidden rounded-md border border-[#e1dfdd] bg-white py-1 text-[13px] shadow-[0_6.4px_14.4px_rgba(0,0,0,.132),0_1.2px_3.6px_rgba(0,0,0,.108)]"
    >
      {items.map((c, i) => (
        <li key={c.id}>
          <button
            type="button"
            role="option"
            aria-selected={i === index}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(i)}
            className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left ${i === index ? "bg-side-hover" : ""}`}
          >
            <span className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[9px] font-semibold ${c.id === "all" ? "bg-[#e6e4e2] text-[12px] text-ink-2" : "bg-[#8a8886] text-white"}`}>
              {c.id === "all" ? "@" : c.label.slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            {c.department && <span className="shrink-0 text-[11.5px] text-ink-3">{c.department}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
});
