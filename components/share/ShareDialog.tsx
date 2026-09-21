"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import {
  createInviteLink,
  removeShare,
  revokeInviteLink,
  shareWithUser,
  updateShareRole,
} from "@/lib/actions/share";
import type { ShareState, UserHit } from "@/lib/queries/share";
import type { ShareRole, ShareSubjectType } from "@/app/generated/prisma/enums";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import { useFormatter, useTranslations } from "next-intl";
import { useAppName } from "@/components/brand";

const ROLE_LABEL: Record<ShareRole, string> = {
  VIEWER: "roles.VIEWER",
  EDITOR: "roles.EDITOR",
  ADMIN: "roles.ADMIN",
};

export function ShareDialog({
  subject,
  onClose,
}: {
  subject: { type: ShareSubjectType; id: string };
  onClose: () => void;
}) {
  const [, startTransition] = useTransition();

  const [state, setState] = useState<ShareState | null>(null);
  const [candidates, setCandidates] = useState<UserHit[]>([]);
  const [q, setQ] = useState("");
  const [newRole, setNewRole] = useState<ShareRole>("EDITOR");
  const [inviteRole, setInviteRole] = useState<ShareRole>("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const format = useFormatter();
  const t = useTranslations("share");
  const app = useAppName();

  const load = useCallback(
    async (term: string | null) => {
      const url =
        `/api/share?type=${subject.type}&id=${encodeURIComponent(subject.id)}` +
        (term === null ? "" : `&q=${encodeURIComponent(term)}`);
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? t("loadFailed"));
        setLoading(false);
        return;
      }
      setState(body.state as ShareState);
      setCandidates((body.candidates ?? []) as UserHit[]);
      setLoading(false);
    },
    [subject.id, subject.type, t],
  );

  useEffect(() => {
    // 다이얼로그가 열릴 때 한 번 서버에서 공유 상태를 읽어 온다.
    // load 는 await fetch 뒤에 setState 하므로 동기 setState 가 아니지만,
    // 린트 규칙이 호출 그래프만 보고 잡아내서 여기서만 끈다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null);
  }, [load]);

  useEffect(() => {
    const term = q.trim();
    if (!term) return; // 지우는 순간은 입력 핸들러가 후보를 비운다
    const t = setTimeout(() => void load(term), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 여기서 router.refresh() 를 부르지 않는다. 레이아웃이 다시 그려지면
  // 이 다이얼로그가 리마운트되며 닫힌다. 사이드바는 닫을 때 한 번 갱신한다.
  function act(fn: () => Promise<ActionResult<unknown>>) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok && !handledAuthFailure(res)) setError(res.error);
      await load(q.trim() || null);
    });
  }

  async function copyInvite(token: string) {
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast(t("copied"));
    } catch {
      setToast(t("copyFailed", { url }));
    }
  }

  const subjectLabel = t(`subject.${subject.type}`);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" onMouseDown={onClose} role="presentation">
      <div
        className="thin-scroll max-h-[86dvh] w-[520px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg bg-white shadow-[0_25.6px_57.6px_rgba(0,0,0,.22)]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("dialogTitle", { subject: subjectLabel })}
      >
        <div className="flex items-start gap-3 px-6 pb-1 pt-5">
          <h3 className="flex-1 text-lg font-semibold">
            {state ? t("dialogTitleNamed", { subject: subjectLabel, name: state.name }) : t("dialogTitle", { subject: subjectLabel })}
          </h3>
          <button onClick={onClose} aria-label={t("close")} className="text-ink-2 hover:text-ink">
            <Icon name="x" size={18} />
          </button>
        </div>

        {loading && <p className="px-6 pb-6 pt-3 text-sm text-ink-2">{t("loading")}</p>}

        {error && (
          <div className="mx-6 mt-3 flex items-start gap-2 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><Icon name="x" size={13} /></button>
          </div>
        )}

        {state && (
          <div className="px-6 pb-5">
            {state.inheritedFromGroup && (
              <p className="mt-2 rounded bg-pane-bg px-3 py-2 text-xs leading-relaxed text-ink-2">
                {t.rich("inherited", {
                  group: state.inheritedFromGroup.name,
                  b: (chunks: React.ReactNode) => <b>{chunks}</b>,
                })}
              </p>
            )}

            {state.canManage && (
              <>
                <label className="mb-1.5 mt-4 block text-xs text-ink-2">{t("addUser")}</label>
                <div className="flex gap-2">
                  <input
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      if (!e.target.value.trim()) setCandidates([]);
                    }}
                    placeholder={t("searchPlaceholder")}
                    className="h-[34px] flex-1 rounded border border-[#8a8886] px-2.5 text-sm outline-none focus:border-link focus:shadow-[0_0_0_1px_#2564cf]"
                  />
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as ShareRole)}
                    className="h-[34px] w-[110px] rounded border border-[#8a8886] px-1.5 text-sm"
                  >
                    {(Object.keys(ROLE_LABEL) as ShareRole[]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </div>

                {q.trim() && (
                  <div className="mt-1.5 overflow-hidden rounded border border-[#e1dfdd]">
                    {candidates.length === 0 ? (
                      <p className="px-3 py-2.5 text-xs leading-relaxed text-ink-2">
                        {t.rich("noResults", { app, b: (chunks: React.ReactNode) => <b>{chunks}</b> })}
                      </p>
                    ) : (
                      candidates.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setQ("");
                            act(() => shareWithUser(subject.type, subject.id, c.id, newRole));
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
              </>
            )}

            <label className="mb-1 mt-5 block text-xs text-ink-2">
              {t("membersCount", { count: state.members.length })}
            </label>
            {state.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 py-2">
                <Avatar name={m.name} color={m.avatarColor} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {m.name}
                    {m.isMe && <span className="ml-1.5 text-xs text-ink-2">{t("me")}</span>}
                  </div>
                  <div className="truncate text-xs text-ink-2">{m.email}</div>
                </div>
                {m.role === "OWNER" ? (
                  <span className="rounded-full bg-pane-bg px-2.5 py-1 text-xs text-ink-2">{t("owner")}</span>
                ) : state.canManage ? (
                  <select
                    value={m.role}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "REMOVE") act(() => removeShare(m.shareId!));
                      else act(() => updateShareRole(m.shareId!, v as ShareRole));
                    }}
                    className="h-7 rounded border border-[#d6d4d2] px-1 text-[13px]"
                  >
                    {(Object.keys(ROLE_LABEL) as ShareRole[]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                    <option value="REMOVE">{t("remove")}</option>
                  </select>
                ) : (
                  <span className="text-xs text-ink-2">{ROLE_LABEL[m.role as ShareRole]}</span>
                )}
              </div>
            ))}

            {state.canManage && (
              <>
                <label className="mb-1.5 mt-5 block text-xs text-ink-2">{t("inviteLink")}</label>
                {state.invites.length === 0 && (
                  <div className="flex gap-2">
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as ShareRole)}
                      className="h-[34px] w-[110px] rounded border border-[#8a8886] px-1.5 text-sm"
                    >
                      {(Object.keys(ROLE_LABEL) as ShareRole[]).map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => act(() => createInviteLink(subject.type, subject.id, inviteRole))}
                      className="h-[34px] rounded border border-[#8a8886] px-3 text-sm hover:bg-side-hover"
                    >
                      {t("createLink")}
                    </button>
                  </div>
                )}
                {state.invites.map((inv) => (
                  <div key={inv.token} className="mt-1.5">
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={`${typeof window === "undefined" ? "" : window.location.origin}/invite/${inv.token}`}
                        className="h-[34px] flex-1 rounded border border-[#8a8886] px-2.5 text-xs text-ink-2 outline-none"
                      />
                      <button
                        onClick={() => copyInvite(inv.token)}
                        className="h-[34px] rounded border border-[#8a8886] px-3 text-sm hover:bg-side-hover"
                      >
                        {t("copy")}
                      </button>
                      <button
                        onClick={() => act(() => revokeInviteLink(inv.token))}
                        className="h-[34px] rounded border border-[#8a8886] px-3 text-sm text-danger hover:bg-side-hover"
                      >
                        {t("revoke")}
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                      {t.rich("linkNote", {
                        role: t(ROLE_LABEL[inv.role] as never),
                        date: format.dateTime(new Date(inv.expiresAt), { year: "numeric", month: "numeric", day: "numeric" }),
                        b: (chunks: React.ReactNode) => <b>{chunks}</b>,
                      })}
                      {inv.usedAt && ` · ${t("linkUsed")}`}
                    </p>
                  </div>
                ))}
              </>
            )}

            {!state.canManage && (
              <p className="mt-4 rounded bg-pane-bg px-3 py-2 text-xs text-ink-2">
                {t("onlyAdmins")}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 px-6 pb-5">
          <button onClick={onClose} className="h-8 rounded border border-[#8a8886] px-4 text-sm hover:bg-side-hover">
            {t("close")}
          </button>
        </div>

        {toast && (
          <div className="pointer-events-none sticky bottom-3 mx-auto w-fit rounded bg-ink px-4 py-2 text-[13px] text-white">
            {toast}
          </div>
        )}
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
