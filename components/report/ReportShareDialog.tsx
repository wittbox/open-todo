"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useAppName } from "@/components/brand";
import { Icon } from "@/components/icons";
import { shareReport, unshareReport } from "@/lib/actions/report";
import type { UserHit } from "@/lib/queries/share";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";

export type ShareMember = { userId: string; name: string; email: string; avatarColor: string };

/**
 * 보고서 공유. 목록 공유와 달리 역할 선택이 없다 — 읽기 전용 하나뿐이고,
 * 받은 사람이 다시 남에게 넘길 수도 없다.
 */
export function ReportShareDialog({
  reportId,
  members,
  onClose,
}: {
  reportId: string;
  members: ShareMember[];
  onClose: () => void;
}) {
  const t = useTranslations("reports");
  const app = useAppName();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<UserHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const term = q.trim();
    if (!term) return; // 지우는 순간은 입력 핸들러가 후보를 비운다
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(term)}`, { signal: ac.signal });
        if (res.ok) setCandidates((await res.json()) as UserHit[]);
      } catch {
        /* 입력이 바뀌어 취소된 요청은 무시한다 */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);

  function act(fn: () => Promise<ActionResult<unknown>>) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      else window.location.reload();
    });
  }

  const shared = new Set(members.map((m) => m.userId));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" onMouseDown={onClose} role="presentation">
      <div
        className="thin-scroll max-h-[86dvh] w-[480px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg bg-white p-6 shadow-[0_25.6px_57.6px_rgba(0,0,0,.22)]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("share.aria")}
      >
        <div className="flex items-start gap-3">
          <h3 className="flex-1 text-lg font-semibold">{t("share.title")}</h3>
          <button onClick={onClose} aria-label={t("share.close")} className="text-ink-2 hover:text-ink">
            <Icon name="x" size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">
          {t.rich("share.note", { b: (chunks: React.ReactNode) => <b>{chunks}</b> })}
        </p>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><Icon name="x" size={13} /></button>
          </div>
        )}

        <label className="mb-1.5 mt-4 block text-xs text-ink-2">{t("share.addUser")}</label>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value.trim()) setCandidates([]);
          }}
          placeholder={t("share.searchPlaceholder")}
          className="h-[34px] w-full rounded border border-[#8a8886] px-2.5 text-sm outline-none focus:border-link focus:shadow-[0_0_0_1px_#2564cf]"
        />

        {q.trim() && (
          <div className="mt-1.5 overflow-hidden rounded border border-[#e1dfdd]">
            {candidates.filter((c) => !shared.has(c.id)).length === 0 ? (
              <p className="px-3 py-2.5 text-xs leading-relaxed text-ink-2">
                {t("share.noResults", { app })}
              </p>
            ) : (
              candidates
                .filter((c) => !shared.has(c.id))
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setQ("");
                      setCandidates([]);
                      act(() => shareReport(reportId, c.id));
                    }}
                    className="flex w-full items-center gap-3 border-t border-divider px-3 py-2 text-left first:border-t-0 hover:bg-side-hover"
                  >
                    <Avatar name={c.name} color={c.avatarColor} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{c.name}</span>
                      <span className="block truncate text-xs text-ink-2">
                        {c.department ? `${c.department} · ${c.email}` : c.email}
                      </span>
                    </span>
                    <Icon name="plus" size={16} className="ml-auto text-link" />
                  </button>
                ))
            )}
          </div>
        )}

        <label className="mb-1 mt-5 block text-xs text-ink-2">{t("share.sharingCount", { count: members.length })}</label>
        {members.length === 0 && <p className="py-2 text-sm text-ink-3">{t("share.noneShared")}</p>}
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 py-2">
            <Avatar name={m.name} color={m.avatarColor} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{m.name}</div>
              <div className="truncate text-xs text-ink-2">{m.email}</div>
            </div>
            <button
              onClick={() => act(() => unshareReport(reportId, m.userId))}
              className="text-xs text-danger hover:underline"
            >
              {t("share.unshare")}
            </button>
          </div>
        ))}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="h-8 rounded border border-[#8a8886] px-4 text-sm hover:bg-side-hover">
            {t("share.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
      style={{ background: color }}
    >
      {name.slice(0, 2)}
    </span>
  );
}
