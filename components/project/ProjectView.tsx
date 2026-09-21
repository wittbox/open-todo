"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { MessageComposer } from "@/components/project/MessageComposer";
import { MessageRow } from "@/components/project/MessageRow";
import { ProjectMembersDialog } from "@/components/project/ProjectMembersDialog";
import { ProjectSettingsDialog } from "@/components/project/ProjectSettingsDialog";
import { usePoll } from "@/components/project/usePoll";
import { deleteMessage, editMessage, pinMessage } from "@/lib/actions/message";
import { markProjectRead } from "@/lib/actions/project";
import { sendMessage } from "@/components/project/send";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import { dayKeyOf, dayLabel, type Translate } from "@/lib/projects/format";
import { mergeMessages } from "@/lib/projects/merge";
import type { MessageItem, ProjectView as View } from "@/lib/queries/project";
import { openPanel } from "@/components/shell/shell";
import { useLocale, useTimeZone, useTranslations } from "next-intl";

type Member = Extract<View, { kind: "member" }>;

/** 폴링 겹침 여유. updatedAt 이 매겨진 뒤 커밋되기까지의 어긋남을 덮는다. id 로 바꿔 끼우니 겹쳐도 무해하다. */
const POLL_OVERLAP_MS = 2000;
const POLL_MS = 5000;

/**
 * 프로젝트 대화 화면.
 *
 * 메시지는 id 로 Map 에 두고, 5초마다 "그 뒤로 바뀐 것"을 받아 바꿔 끼운다 — 새 글·수정·삭제·고정이
 * 모두 같은 길로 온다. 내 동작 뒤에도 서버를 다시 그리지 않고(입력창·폴러가 리마운트된다) 곧장 한 번 받는다.
 * 읽은 위치는 보이는 화면에서 새 원글을 봤을 때만 올린다.
 */
export function ProjectView({ initial, meId }: { initial: Member; meId: string }) {
  const t = useTranslations("projects");
  const locale = useLocale();
  // 순수 함수(lib/projects/format.ts)는 열쇠를 문자열로 받는다 — 거기서는 키 타입을 알 수 없다.
  const tx = t as unknown as Translate;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "members" | "settings">(null);

  const [byId, setById] = useState(() => new Map(initial.messages.map((m) => [m.id, m])));
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const since = useRef(new Date(new Date(initial.serverTime).getTime() - POLL_OVERLAP_MS));
  // 들어올 때의 읽은 위치. 구분선은 이 값으로 고정한다 — 읽음을 올려도 구분선이 사라지지 않게.
  const [unreadFrom] = useState(initial.lastReadSeq);
  const reportedSeq = useRef(initial.lastReadSeq);
  const streamRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // 위로 올려 둔 채 도착한 남의 새 원글 수. 아래로 내려가면 0.
  const [newBelow, setNewBelow] = useState(0);
  const knownIds = useRef(new Set(initial.messages.map((m) => m.id)));
  const readOnly = initial.archivedAt != null;
  const highlightId = params.get("msg");

  /* ── 받아서 합치기 ── */

  const merge = useCallback((items: MessageItem[]) => {
    if (items.length === 0) return;
    setById((prev) => mergeMessages(prev, items));
  }, []);

  const fetchChanges = useCallback(async () => {
    const res = await fetch(
      `/api/projects/${initial.id}/messages?since=${encodeURIComponent(since.current.toISOString())}`,
      { cache: "no-store" },
    );
    if (res.status === 401 || res.status === 404) {
      // 세션이 끝났거나 멤버에서 빠졌다. 서버가 다시 그리게 두면 알맞은 화면으로 간다.
      router.refresh();
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as {
      now: string;
      messages: MessageItem[];
      unreadByProject: Record<string, number>;
    };
    // 위로 올려 둔 채 남의 새 원글이 오면 세어 두었다가 "새 메시지 N ↓" 로 알린다.
    const fresh = data.messages.filter((m) => !m.parentId && !m.deletedAt && !m.isMine && !knownIds.current.has(m.id));
    for (const m of data.messages) knownIds.current.add(m.id);
    if (fresh.length > 0 && !stickToBottom.current) setNewBelow((n) => n + fresh.length);
    merge(data.messages);
    const maxUpdated = data.messages.reduce((acc, m) => Math.max(acc, new Date(m.updatedAt).getTime()), 0);
    since.current = new Date(Math.max(maxUpdated, new Date(data.now).getTime()) - POLL_OVERLAP_MS);
    window.dispatchEvent(new CustomEvent("todo:project-unread", { detail: { ...data.unreadByProject, [initial.id]: 0 } }));
  }, [initial.id, merge, router]);

  const refetch = usePoll(fetchChanges, POLL_MS);

  /* ── 보이는 목록 ── */

  const roots = useMemo(
    () => [...byId.values()].filter((m) => !m.parentId).sort((a, b) => a.seq - b.seq),
    [byId],
  );
  const firstUnreadId = useMemo(
    () => roots.find((m) => m.seq > unreadFrom && !m.isMine && !m.deletedAt)?.id ?? null,
    [roots, unreadFrom],
  );
  const tz = useTimeZone();
  const todayKey = dayKeyOf(new Date().toISOString(), tz);

  /* ── 읽은 위치 ── */

  useEffect(() => {
    const maxSeq = roots.reduce((acc, m) => Math.max(acc, m.seq), 0);
    if (maxSeq <= reportedSeq.current) return;
    if (document.visibilityState !== "visible") return;
    reportedSeq.current = maxSeq;
    const t = setTimeout(() => {
      void markProjectRead(initial.id, maxSeq);
      window.dispatchEvent(new CustomEvent("todo:project-unread", { detail: { [initial.id]: 0 } }));
    }, 800);
    return () => clearTimeout(t);
  }, [roots, initial.id]);

  /* ── 스크롤 ── */

  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const target = highlightId
      ? el.querySelector(`#msg-${CSS.escape(highlightId)}`)
      : firstUnreadId
        ? el.querySelector("[data-unread-divider]")
        : null;
    if (target) (target as HTMLElement).scrollIntoView({ block: highlightId ? "center" : "start" });
    else el.scrollTop = el.scrollHeight;
    // 처음 한 번만. 이후에는 아래에 붙어 있을 때만 따라 내려간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = streamRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [roots.length]);

  async function loadOlder() {
    const el = streamRef.current;
    const first = roots[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const prevHeight = el?.scrollHeight ?? 0;
    const res = await fetch(`/api/projects/${initial.id}/messages?before=${first.seq}`, { cache: "no-store" });
    setLoadingOlder(false);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: MessageItem[]; hasMore: boolean };
    stickToBottom.current = false;
    merge(data.messages);
    setHasMore(data.hasMore);
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - prevHeight;
    });
  }

  /* ── 동작 ── */

  function fail(res: ActionResult<unknown>) {
    if (!res.ok && !handledAuthFailure(res)) setError(res.error);
  }

  async function send(body: string, files: File[]): Promise<boolean> {
    const res = await sendMessage({ projectId: initial.id, body, files }, tx);
    if (!res.ok) {
      fail(res);
      return false;
    }
    stickToBottom.current = true;
    merge([res.data]);
    return true;
  }

  function act(fn: () => Promise<ActionResult<unknown>>) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok) fail(res);
      // 내 동작의 결과는 화면이 숨겨져 있어도 바로 받는다.
      await refetch(true);
    });
  }

  function select(key: "thread" | "msg", id: string | null) {
    const q = new URLSearchParams(params.toString());
    if (id) q.set(key, id);
    else q.delete(key);
    const href = `${pathname}${q.size ? `?${q}` : ""}`;
    if (key === "thread" && id) openPanel(router, href);
    else router.replace(href, { scroll: false });
  }

  async function copyLink(id: string) {
    const url = `${window.location.origin}/projects/${initial.id}?msg=${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setError(t("stream.copyFailed", { url }));
    }
  }

  const pinned = roots.filter((m) => m.pinnedAt && !m.deletedAt);
  const [pinsOpen, setPinsOpen] = useState(false);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-pane-bg">
      <header className="flex items-center gap-2.5 border-b border-[#e1dfdd] bg-white px-4 py-2.5 md:px-6 md:py-3.5">
        <Icon name={initial.isPublic ? "hash" : "lock"} size={18} className="shrink-0 text-ink-2" />
        <h1 className="truncate text-[18px] font-semibold md:text-[20px]">{initial.name}</h1>
        {/* 폰에서는 목적을 뺀다 — 한 줄에 이름·멤버·설정이 겨우 들어간다. */}
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
          <span className="hidden md:inline">{initial.purpose}</span>
        </span>
        {readOnly && <span className="rounded-full bg-[#fff4ce] px-2 py-0.5 text-[11px] text-[#7a5a00]">{t("header.archived")}</span>}
        <button
          type="button"
          onClick={() => setDialog("members")}
          className="inline-flex h-7 items-center gap-1.5 rounded border border-[#e1dfdd] px-2.5 text-[12.5px] text-ink-2 hover:bg-side-hover"
        >
          <Icon name="person" size={14} />
          {t("header.members", { count: initial.members.length })}
        </button>
        {initial.myRole === "ADMIN" && (
          <button
            type="button"
            onClick={() => setDialog("settings")}
            aria-label={t("settings.title")}
            className="grid h-7 w-7 place-items-center rounded border border-[#e1dfdd] text-ink-2 hover:bg-side-hover"
          >
            <Icon name="gear" size={15} />
          </button>
        )}
      </header>

      {pinned.length > 0 && (
        <div className="border-b border-[#f2e2a8] bg-[#fff8e6] text-[12.5px] text-[#7a5a00]">
          <button
            type="button"
            onClick={() => setPinsOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-6 py-1.5 text-left"
          >
            <Icon name="pin" size={13} />
            <b>{t("pins.count", { count: pinned.length })}</b>
            {!pinsOpen && <span className="min-w-0 flex-1 truncate">{pinned[0].body}</span>}
            <Icon name={pinsOpen ? "chevronUp" : "chevronDown"} size={14} className="ml-auto shrink-0" />
          </button>
          {pinsOpen && (
            <ul className="border-t border-[#f2e2a8] px-6 py-1.5">
              {pinned.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-1">
                  <button
                    type="button"
                    onClick={() => {
                      document.getElementById(`msg-${m.id}`)?.scrollIntoView({ block: "center" });
                      setPinsOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                  >
                    <span className="font-semibold">{m.author?.name ?? t("message.unknownUser")}</span> · {m.body}
                  </button>
                  {!readOnly && (
                    <button type="button" onClick={() => act(() => pinMessage(m.id, false))} className="shrink-0 hover:underline">
                      {t("pins.unpin")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="mx-6 mt-2 flex items-start gap-2 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("close")}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      <div
        ref={streamRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (stickToBottom.current) setNewBelow(0);
        }}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto py-2"
      >
        {hasMore && (
          <div className="py-2 text-center">
            <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="text-[12.5px] text-link hover:underline disabled:opacity-50">
              {loadingOlder ? t("stream.loadingOlder") : t("stream.loadOlder")}
            </button>
          </div>
        )}
        {roots.length === 0 && (
          <p className="px-6 py-10 text-center text-[13px] text-ink-2">
            {t("stream.empty")}
          </p>
        )}
        {roots.map((m, i) => {
          const day = dayKeyOf(m.createdAt, tz);
          const prevDay = i > 0 ? dayKeyOf(roots[i - 1].createdAt, tz) : null;
          return (
            <div key={m.id}>
              {day !== prevDay && (
                <div className="mx-6 my-2 flex items-center gap-3 text-[11.5px] text-ink-3 before:h-px before:flex-1 before:bg-[#e1dfdd] after:h-px after:flex-1 after:bg-[#e1dfdd]">
                  {dayLabel(day, todayKey, tx, locale)}
                </div>
              )}
              {m.id === firstUnreadId && (
                <div data-unread-divider="" className="mx-6 my-1.5 flex items-center gap-2.5 text-[11.5px] font-semibold text-[#c2185b] before:h-px before:flex-1 before:bg-[#c2185b]">
                  {t("stream.unreadDivider")}
                </div>
              )}
              <MessageRow
                m={m}
                meId={meId}
                meName={initial.members.find((x) => x.isMe)?.name}
                readOnly={readOnly}
                highlighted={highlightId === m.id}
                onEdit={(id, body) => act(() => editMessage(id, body))}
                onDelete={(id) => {
                  const target = byId.get(id);
                  const ask =
                    target && target.replyCount > 0
                      ? t("stream.confirmDeleteWithReplies", { count: target.replyCount })
                      : t("stream.confirmDelete");
                  if (window.confirm(ask)) act(() => deleteMessage(id));
                }}
                onPin={(id, pinned) => act(() => pinMessage(id, pinned))}
                onOpenThread={(id) => select("thread", id)}
                onCopyLink={(id) => void copyLink(id)}
              />
            </div>
          );
        })}
      </div>

      {newBelow > 0 && (
        <div className="relative h-0">
          <button
            type="button"
            onClick={() => {
              const el = streamRef.current;
              if (el) el.scrollTop = el.scrollHeight;
              stickToBottom.current = true;
              setNewBelow(0);
            }}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-link px-3 py-1 text-[12px] text-white shadow-[0_4px_10px_rgba(0,0,0,.18)] hover:brightness-95"
          >
            {t("stream.newBelow", { count: newBelow })}
          </button>
        </div>
      )}

      <MessageComposer
        placeholder={t("stream.placeholder", { name: initial.name })}
        disabled={readOnly}
        disabledHint={t("errors.archived")}
        members={initial.members.filter((m) => !m.isMe)}
        allowFiles
        onSend={send}
      />

      {dialog === "members" && (
        <ProjectMembersDialog
          projectId={initial.id}
          members={initial.members}
          myRole={initial.myRole}
          isOwner={initial.isOwner}
          readOnly={readOnly}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
      {dialog === "settings" && (
        <ProjectSettingsDialog
          project={initial}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
