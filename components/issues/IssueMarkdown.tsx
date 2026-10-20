"use client";

import { Lexer, type Token, type Tokens } from "marked";
import { useTranslations } from "next-intl";
import { inlineNodes, useMentionLabels, type InlineContext } from "@/components/project/MessageBody";

/**
 * 이슈 본문·댓글 그리기(2026-10-20 — 보이는 그대로 편집기, TipTap 3).
 *
 * 글은 마크다운 글자로 저장된다. 여기서는 marked 로 조각만 내고(lexer) React 노드로 직접 그린다 —
 * HTML 문자열을 넣지 않는다(<script> 같은 것은 그대로 글자로 보인다). 글자 조각은 메시지와 같은 규칙으로
 * 멘션(<@id>)·#작업번호·링크·이슈 번호(BUG-23)를 살린다.
 *
 * `breaks: true` — 줄 하나 바꿈도 줄바꿈으로 보인다. 편집기가 생기기 전에 쓴 평문 글이 예전 모습 그대로 보이게.
 */

const lexerOptions = { gfm: true, breaks: true } as const;

/** marked 가 이미 바꿔 둔 글자(escaped)를 되돌린다 — 우리는 React 가 다시 안전하게 넣는다 */
function unescape(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e] ?? _m);
}

/** http(s)·mailto 만 링크로. javascript: 같은 것은 글자로 남긴다. */
function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null;
}

export function IssueMarkdown({ body, className, ...ctx }: InlineContext & { body: string; className?: string }) {
  const tIssues = useTranslations("issues");
  const labels = useMentionLabels();
  const tokens = new Lexer(lexerOptions).lex(body.replace(/\r\n/g, "\n"));
  let n = 0;
  const key = () => `m${n++}`;

  function inline(list: Token[] | undefined): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    for (const t of list ?? []) {
      switch (t.type) {
        case "text": {
          const tt = t as Tokens.Text;
          // 목록 칸 안의 text 는 다시 조각을 품는다
          if (tt.tokens?.length) out.push(...inline(tt.tokens));
          else out.push(...inlineNodes(tt.escaped ? unescape(tt.text) : tt.text, ctx, labels, key()));
          break;
        }
        case "escape":
          out.push((t as Tokens.Escape).text);
          break;
        case "strong":
          out.push(<strong key={key()} className="font-semibold">{inline((t as Tokens.Strong).tokens)}</strong>);
          break;
        case "em":
          out.push(<em key={key()}>{inline((t as Tokens.Em).tokens)}</em>);
          break;
        case "del":
          out.push(<del key={key()} className="text-ink-2">{inline((t as Tokens.Del).tokens)}</del>);
          break;
        case "codespan":
          out.push(
            <code key={key()} className="rounded bg-[#f3f2f1] px-1 py-px font-mono text-[12.5px]">
              {unescape((t as Tokens.Codespan).text)}
            </code>,
          );
          break;
        case "br":
          out.push(<br key={key()} />);
          break;
        case "link": {
          const l = t as Tokens.Link;
          const href = safeHref(l.href);
          out.push(
            href ? (
              <a key={key()} href={href} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                {inline(l.tokens)}
              </a>
            ) : (
              <span key={key()}>{l.raw}</span>
            ),
          );
          break;
        }
        case "checkbox":
          break; // 목록 칸에서 따로 그린다
        default:
          // html·image 등 — 글자 그대로(그림은 첨부로 붙인다)
          out.push(<span key={key()}>{"raw" in t ? (t.raw as string) : ""}</span>);
      }
    }
    return out;
  }

  function block(list: Token[]): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    for (const t of list) {
      switch (t.type) {
        case "space":
        case "checkbox": // 체크 목록 칸의 네모는 목록에서 따로 그린다
          break;
        case "paragraph":
          out.push(<p key={key()} className="my-1.5 first:mt-0 last:mb-0">{inline((t as Tokens.Paragraph).tokens)}</p>);
          break;
        case "heading": {
          const h = t as Tokens.Heading;
          out.push(
            <h4 key={key()} className={`mb-1 mt-3 font-semibold first:mt-0 ${h.depth <= 2 ? "text-[14.5px]" : "text-[13.5px] text-ink-2"}`}>
              {inline(h.tokens)}
            </h4>,
          );
          break;
        }
        case "list": {
          const l = t as Tokens.List;
          const items = l.items.map((it) => (
            <li key={key()} className={it.task ? "flex list-none items-start gap-2" : undefined}>
              {it.task && (
                <span
                  aria-label={it.checked ? tIssues("editor.checked") : tIssues("editor.unchecked")}
                  className={`mt-[4px] grid h-[13px] w-[13px] shrink-0 place-items-center rounded-[3px] border-[1.5px] text-[9px] leading-none text-white ${
                    it.checked ? "border-link bg-link" : "border-ink-2"
                  }`}
                >
                  {it.checked ? "✓" : ""}
                </span>
              )}
              <div className={`min-w-0 ${it.task && it.checked ? "text-ink-2 line-through" : ""}`}>{block(it.tokens)}</div>
            </li>
          ));
          const task = l.items.every((it) => it.task);
          out.push(
            l.ordered ? (
              <ol key={key()} start={typeof l.start === "number" ? l.start : undefined} className="my-1.5 list-decimal pl-6">
                {items}
              </ol>
            ) : (
              <ul key={key()} className={`my-1.5 ${task ? "pl-1" : "list-disc pl-6"}`}>
                {items}
              </ul>
            ),
          );
          break;
        }
        case "blockquote":
          out.push(
            <blockquote key={key()} className="my-1.5 border-l-[3px] border-[#c8c6c4] pl-3 text-ink-2">
              {block((t as Tokens.Blockquote).tokens)}
            </blockquote>,
          );
          break;
        case "code":
          out.push(
            <pre key={key()} className="my-1.5 overflow-x-auto rounded bg-[#f3f2f1] px-3 py-2 font-mono text-[12.5px] leading-[1.5]">
              {(t as Tokens.Code).text}
            </pre>,
          );
          break;
        case "hr":
          out.push(<hr key={key()} className="my-3 border-[#edebe9]" />);
          break;
        case "text": {
          // 목록 칸의 짧은 글은 paragraph 대신 text 블록으로 온다
          const tt = t as Tokens.Text;
          out.push(<span key={key()}>{tt.tokens?.length ? inline(tt.tokens) : inlineNodes(tt.text, ctx, labels, key())}</span>);
          break;
        }
        default:
          // html 블록·표 등 — 글자 그대로
          out.push(
            <p key={key()} className="my-1.5 whitespace-pre-wrap">
              {"raw" in t ? (t.raw as string) : ""}
            </p>,
          );
      }
    }
    return out;
  }

  return <div className={`break-words text-[13.5px] leading-[1.6] ${className ?? ""}`}>{block(tokens)}</div>;
}
