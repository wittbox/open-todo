"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { issueResetLink, setUserDisabled, setUserRole } from "@/lib/actions/admin";
import { runAction } from "@/lib/actions/session-guard";
import type { AdminUserRow } from "@/lib/queries/admin";
import { PROVIDER_LABEL } from "@/lib/auth/oauth/config";
import { ContextMenu, RowMenuButton, type MenuAnchor, type MenuItem } from "@/components/ui/menu";
import { Avatar, Banner, FIELD, LinkBox, Tag } from "@/components/admin/ui";

/**
 * 사용자 목록 — 관리자 지정·해제, 사용 중지·해제, 비밀번호 재설정 링크.
 * 자기 계정에는 아무 것도 하지 못한다(관리자가 한 명도 없는 설치가 되지 않게).
 */
export function UserTable({ users, meId }: { users: AdminUserRow[]; meId: string }) {
  const t = useTranslations("admin.users");
  const format = useFormatter();
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ user: AdminUserRow; anchor: MenuAnchor } | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string; link?: string } | null>(null);
  const [, start] = useTransition();

  const q = query.trim().toLowerCase();
  const shown = q ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.includes(q)) : users;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) setNotice({ tone: "error", text: res.error ?? "" });
    });

  const itemsFor = (u: AdminUserRow): MenuItem[] => {
    if (u.id === meId) return [{ label: t("resetLink"), pending: t("admin") }];
    return [
      {
        label: u.role === "ADMIN" ? t("removeAdmin") : t("makeAdmin"),
        onSelect: () => {
          if (u.role !== "ADMIN" && !confirm(t("confirmAdmin", { name: u.name }))) return;
          act(() => runAction(() => setUserRole(u.id, u.role === "ADMIN" ? "USER" : "ADMIN")));
        },
      },
      {
        label: t("resetLink"),
        onSelect: () =>
          start(async () => {
            const res = await runAction(() => issueResetLink(u.id));
            if (!res.ok) setNotice({ tone: "error", text: res.error });
            else if (res.data.mailed) setNotice({ tone: "info", text: t("resetMailed") });
            else setNotice({ tone: "info", text: t("resetCopy"), link: res.data.link ?? undefined });
          }),
      },
      { kind: "separator" },
      {
        label: u.disabledAt ? t("enable") : t("disable"),
        danger: !u.disabledAt,
        onSelect: () => {
          if (!u.disabledAt && !confirm(t("confirmDisable", { name: u.name }))) return;
          act(() => runAction(() => setUserDisabled(u.id, !u.disabledAt)));
        },
      },
    ];
  };

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className={`${FIELD} max-w-[280px]`} />

      {notice && (
        <Banner tone={notice.tone}>
          {notice.text}
          {notice.link && <LinkBox link={notice.link} />}
        </Banner>
      )}

      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="border-b border-side-border text-left text-xs text-ink-2">
            <th className="py-1.5 font-semibold">{t("colPerson")}</th>
            <th className="py-1.5 font-semibold">{t("colRole")}</th>
            <th className="py-1.5 font-semibold">{t("colLastLogin")}</th>
            <th className="py-1.5 font-semibold">{t("colMethods")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((u) => (
            <tr key={u.id} className={`group border-b border-divider last:border-0 ${u.disabledAt ? "opacity-60" : ""}`}>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <Avatar name={u.name} color={u.avatarColor} />
                  <span className="min-w-0">
                    <span className="block truncate">{u.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-2">{u.email}</span>
                  </span>
                </span>
              </td>
              <td className="py-2">{u.role === "ADMIN" ? <Tag tone="admin">{t("admin")}</Tag> : <span className="text-ink-2">{t("user")}</span>}</td>
              <td className="py-2 text-ink-2">
                {u.lastLoginAt ? format.dateTime(u.lastLoginAt, { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : t("never")}
              </td>
              <td className="py-2 text-ink-2">
                {[...(u.hasPassword ? [t("password")] : []), ...u.providers.map((p) => PROVIDER_LABEL[p])].join(" · ") || "—"}
              </td>
              <td className="py-2 text-right">
                {u.disabledAt && <Tag tone="off">{t("disabled")}</Tag>}{" "}
                <RowMenuButton label={u.name} onOpen={(anchor) => setMenu({ user: u, anchor })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="mt-3 text-[13px] text-ink-3">{t("none")}</p>}

      {menu && <ContextMenu anchor={menu.anchor} items={itemsFor(menu.user)} onClose={() => setMenu(null)} title={menu.user.name} />}
    </>
  );
}
