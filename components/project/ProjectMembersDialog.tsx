"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { BTN_CLASS, Dialog, INPUT_CLASS } from "@/components/project/Dialog";
import {
  addProjectMember,
  leaveProject,
  removeProjectMember,
  setProjectMemberRole,
} from "@/lib/actions/project";
import { handledAuthFailure, runAction } from "@/lib/actions/session-guard";
import type { ActionResult } from "@/lib/actions/_helpers";
import type { ProjectRole } from "@/app/generated/prisma/enums";
import type { ProjectMemberItem } from "@/lib/queries/project";

type UserHit = { id: string; name: string; email: string; avatarColor: string; department: string | null };

/**
 * 멤버 창. ShareDialog 와 같은 골격 — 사람을 찾아 넣고, 역할을 바꾸고, 내보낸다.
 * 이 창의 동작은 레이아웃을 다시 그리지 않는다(창이 닫힌다). 닫을 때 부모가 새로 읽는다.
 */
export function ProjectMembersDialog({
  projectId,
  members: initialMembers,
  myRole,
  isOwner,
  readOnly,
  onClose,
}: {
  projectId: string;
  members: ProjectMemberItem[];
  myRole: ProjectRole;
  isOwner: boolean;
  readOnly: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("projects");
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; hits: UserHit[] }>({ q: "", hits: [] });
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const canManage = myRole === "ADMIN" && !readOnly;

  const query = q.trim();
  useEffect(() => {
    if (!canManage || !query) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const all = (await res.json()) as UserHit[];
        setFound({ q: query, hits: all });
      } catch {
        /* 취소됨 */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, canManage]);

  // 지금 입력에 대한 결과만 보여 준다. 현재 멤버는 뺀다.
  const have = new Set(members.map((m) => m.userId));
  const hits = canManage && query && found.q === query ? found.hits.filter((u) => !have.has(u.id)) : [];

  function act(fn: () => Promise<ActionResult<unknown>>, then?: () => void) {
    startTransition(async () => {
      const res = await runAction(fn);
      if (!res.ok) {
        if (!handledAuthFailure(res)) setError(res.error);
        return;
      }
      then?.();
    });
  }

  function add(u: UserHit) {
    act(
      () => addProjectMember(projectId, u.id),
      () => {
        setMembers((ms) => [
          ...ms,
          { userId: u.id, name: u.name, email: u.email, avatarColor: u.avatarColor, department: u.department, role: "MEMBER", isOwner: false, isMe: false, disabled: false },
        ]);
        setQ("");
      },
    );
  }

  return (
    <Dialog title={t("members.title")} onClose={onClose}>
      {canManage && (
        <div className="relative mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("members.search")}
            aria-label={t("members.searchLabel")}
            className={INPUT_CLASS}
          />
          {hits.length > 0 && (
            <ul className="absolute left-0 right-0 top-[38px] z-10 max-h-[240px] overflow-y-auto rounded border border-[#e1dfdd] bg-white py-1 shadow-[0_6.4px_14.4px_rgba(0,0,0,.132)]">
              {hits.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => add(u)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-side-hover">
                    <Avatar name={u.name} color={u.avatarColor} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{u.name}</span>
                      <span className="block truncate text-xs text-ink-2">{[u.department, u.email].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Icon name="plus" size={15} className="text-ink-2" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="divide-y divide-[#edebe9]">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 py-2">
            <Avatar name={m.name} color={m.avatarColor} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {m.name}
                {m.isMe && <span className="ml-1 text-xs font-normal text-ink-3">{t("members.me")}</span>}
              </span>
              <span className="block truncate text-xs text-ink-2">{[m.department, m.email].filter(Boolean).join(" · ")}</span>
            </span>
            {m.isOwner ? (
              <span className="rounded-full bg-[#e6e4e2] px-2 py-0.5 text-[11px] text-ink-2">{t("members.owner")}</span>
            ) : m.isMe ? (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t("members.confirmLeave"))) act(() => leaveProject(projectId), () => router.push("/projects"));
                }}
                className="text-xs text-danger hover:underline"
              >
                {t("members.leave")}
              </button>
            ) : canManage ? (
              <select
                value={m.role}
                aria-label={t("members.roleLabel", { name: m.name })}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "REMOVE") {
                    if (!window.confirm(t("members.confirmRemove", { name: m.name }))) return;
                    act(() => removeProjectMember(projectId, m.userId), () => setMembers((ms) => ms.filter((x) => x.userId !== m.userId)));
                  } else {
                    const role = v as ProjectRole;
                    act(() => setProjectMemberRole(projectId, m.userId, role), () => setMembers((ms) => ms.map((x) => (x.userId === m.userId ? { ...x, role } : x))));
                  }
                }}
                className="h-7 rounded border border-[#c8c6c4] bg-white px-2 text-xs"
              >
                <option value="ADMIN">{t("members.admin")}</option>
                <option value="MEMBER" disabled={m.role === "ADMIN" && !isOwner}>{t("members.member")}</option>
                <option value="REMOVE" disabled={m.role === "ADMIN" && !isOwner}>{t("members.remove")}</option>
              </select>
            ) : (
              <span className="text-xs text-ink-3">{m.role === "ADMIN" ? t("members.admin") : t("members.member")}</span>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 rounded bg-[#fdf3f4] px-3 py-2 text-xs text-danger">{error}</p>}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className={BTN_CLASS}>
          {t("close")}
        </button>
      </div>
    </Dialog>
  );
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: color }}>
      {name.slice(0, 2)}
    </span>
  );
}
