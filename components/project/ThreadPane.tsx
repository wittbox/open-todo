"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { PANE_CLASS } from "@/components/shell/shell";
import { MessageComposer, type MentionCandidate } from "@/components/project/MessageComposer";
import { MessageRow } from "@/components/project/MessageRow";
import { usePoll } from "@/components/project/usePoll";
import { deleteMessage, editMessage } from "@/lib/actions/message";
import { sendMessage } from "@/components/project/send";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import type { MessageItem } from "@/lib/queries/project";
import type { Translate } from "@/lib/projects/format";

const POLL_MS = 5000;

/**
 * 스레드 창 — 작업 상세 창과 같은 자리(오른쪽 360px). 원글 + 답글 + 답글 입력.
 * 답글은 5초마다 통째로 다시 받는다(한 스레드는 작아서 "바뀐 것만" 을 따질 이유가 없다).
 * 원글이 지워지면 다음 방문 때 창이 사라진다 — 페이지가 스레드를 다시 찾지 못한다.
 */
export function ThreadPane({
  projectId,
  parent,
  replies: initialReplies,
  members,
  meId,
  meName,
  readOnly,
}: {
  projectId: string;
  parent: MessageItem;
  replies: MessageItem[];
  /** @ 자동완성 후보(나 제외) */
  members?: MentionCandidate[];
  meId: string;
  meName?: string;
  readOnly: boolean;
}) {
  const t = useTranslations("projects");
  // send.ts 는 훅을 쓰지 못해 열쇠를 문자열로 받는다.
  const tx = t as unknown as Translate;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [byId, setById] = useState(() => new Map(initialReplies.map((m) => [m.id, m])));
  const listRef = useRef<HTMLDivElement>(null);
  const highlightId = params.get("msg");

  const fetchReplies = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/messages?parent=${encodeURIComponent(parent.id)}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 404) {
      router.refresh();
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { messages: MessageItem[] };
    setById(new Map(data.messages.map((m) => [m.id, m])));
  }, [projectId, parent.id, router]);

  const refetch = usePoll(fetchReplies, POLL_MS);

  const replies = useMemo(() => [...byId.values()].sort((a, b) => a.seq - b.seq), [byId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const target = highlightId ? el.querySelector(`#msg-${CSS.escape(highlightId)}`) : null;
    if (target) (target as HTMLElement).scrollIntoView({ block: "center" });
    else el.scrollTop = el.scrollHeight;
  }, [replies.length, highlightId]);

  function close() {
    const q = new URLSearchParams(params.toString());
    q.delete("thread");
    q.delete("msg");
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false });
  }

  function fail(res: ActionResult<unknown>) {
    if (!res.ok && !handledAuthFailure(res)) setError(res.error);
  }

  function act(fn: () => Promise<ActionResult<unknown>>) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok) fail(res);
      await refetch(true);
    });
  }

  async function send(body: string, files: File[]): Promise<boolean> {
    const res = await sendMessage({ projectId, body, parentId: parent.id, files }, tx);
    if (!res.ok) {
      fail(res);
      return false;
    }
    setById((prev) => new Map(prev).set(res.data.id, res.data));
    return true;
  }

  const parentDeleted = parent.deletedAt != null;

  return (
    <>
    <div data-pane-backdrop="" onClick={close} className="fixed inset-0 z-20 hidden bg-black/10 md:block xl:hidden" />
    <aside className={PANE_CLASS} aria-label={t("thread.title")}>
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <Icon name="reply" size={16} className="text-ink-2" />
        <h2 className="text-sm font-semibold">{t("thread.title")}</h2>
        <button type="button" onClick={close} aria-label={t("thread.close")} className="ml-auto grid h-10 w-10 place-items-center rounded text-ink-2 hover:bg-side-hover md:h-7 md:w-7">
          <Icon name="x" size={16} />
        </button>
      </div>

      {error && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("close")}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      <div ref={listRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="mx-3 rounded bg-white py-1">
          <MessageRow
            m={parent}
            meId={meId}
            meName={meName}
            readOnly={readOnly}
            inThread
            onEdit={(id, body) => act(() => editMessage(id, body))}
            onDelete={(id) => {
              const ask = replies.length
                ? t("stream.confirmDeleteWithReplies", { count: replies.length })
                : t("stream.confirmDelete");
              if (window.confirm(ask)) {
                act(() => deleteMessage(id));
              }
            }}
          />
        </div>

        <div className="mx-3 mb-1 mt-3 flex items-center gap-2 text-[11.5px] text-ink-3 after:h-px after:flex-1 after:bg-[#e1dfdd]">
          {t("thread.replies", { count: replies.length })}
        </div>

        {replies.map((m) => (
          <MessageRow
            key={m.id}
            m={m}
            meId={meId}
            meName={meName}
            readOnly={readOnly}
            inThread
            highlighted={highlightId === m.id}
            onEdit={(id, body) => act(() => editMessage(id, body))}
            onDelete={(id) => {
              if (window.confirm(t("stream.confirmDeleteReply"))) act(() => deleteMessage(id));
            }}
          />
        ))}
      </div>

      <MessageComposer
        placeholder={t("thread.placeholder")}
        members={members}
        allowFiles
        disabled={readOnly || parentDeleted}
        disabledHint={parentDeleted ? t("errors.replyToDeleted") : t("errors.archived")}
        onSend={send}
      />
    </aside>
    </>
  );
}
