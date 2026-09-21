"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { createInvite, revokeInvite, type NewInvite } from "@/lib/actions/admin";
import { runAction } from "@/lib/actions/session-guard";
import type { AdminInviteRow } from "@/lib/queries/admin";
import { Banner, BUTTON, FIELD, Hint, LinkBox, PRIMARY, Tag } from "@/components/admin/ui";

const DAYS = [1, 7, 30];

/**
 * 초대 만들기 — 관리자만. 만든 링크는 **이 자리에서 한 번만** 보인다(DB 에는 해시만 있다).
 */
export function InvitePanel({ invites, mailConfigured }: { invites: AdminInviteRow[]; mailConfigured: boolean }) {
  const t = useTranslations("admin.invites");
  const format = useFormatter();
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(7);
  const [sendMail, setSendMail] = useState(true);
  const [made, setMade] = useState<NewInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const date = (d: Date) => format.dateTime(d, { year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setMade(null);
          setCopied(false);
          start(async () => {
            const res = await runAction(() => createInvite(email, days, sendMail));
            if (res.ok) {
              setMade(res.data);
              setEmail("");
            } else setError(res.error);
          });
        }}
      >
        <div className="min-w-[240px] flex-1">
          <label htmlFor="invite-email" className="mb-1 block text-xs text-ink-2">
            {t("email")}
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className={FIELD}
          />
          <Hint>{t("emailHint")}</Hint>
        </div>
        <div>
          <label htmlFor="invite-days" className="mb-1 block text-xs text-ink-2">
            {t("expiry")}
          </label>
          <select id="invite-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${FIELD} w-28`}>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {t("days", { days: d })}
              </option>
            ))}
          </select>
        </div>
        {mailConfigured && (
          <label className="flex h-9 items-center gap-2 text-[13px]">
            <input type="checkbox" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} disabled={!email.trim()} />
            {t("sendMail")}
          </label>
        )}
        <button type="submit" disabled={pending} className={PRIMARY}>
          {t("create")}
        </button>
      </form>

      {error && <Banner tone="error">{error}</Banner>}
      {made && (
        <>
          <Banner>{made.mailed && made.email ? t("mailed", { email: made.email }) : t("onceOnly")}</Banner>
          <LinkBox link={made.link} />
          <button
            type="button"
            className={`mt-2 ${BUTTON}`}
            onClick={() => {
              void navigator.clipboard?.writeText(made.link).then(() => setCopied(true));
            }}
          >
            {copied ? t("copied") : t("copy")}
          </button>
        </>
      )}

      <h3 className="mt-6 text-xs text-ink-2">{t("listTitle")}</h3>
      {invites.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">{t("none")}</p>
      ) : (
        <table className="mt-1 w-full text-[13px]">
          <thead>
            <tr className="border-b border-side-border text-left text-xs text-ink-2">
              <th className="py-1.5 font-semibold">{t("colTo")}</th>
              <th className="py-1.5 font-semibold">{t("colBy")}</th>
              <th className="py-1.5 font-semibold">{t("colExpires")}</th>
              <th className="py-1.5 font-semibold">{t("colStatus")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.map((row) => {
              return (
                <tr key={row.id} className="border-b border-divider last:border-0">
                  <td className="py-2">{row.email ?? <span className="text-ink-3">{t("anyone")}</span>}</td>
                  <td className="py-2 text-ink-2">{row.createdByName ?? "—"}</td>
                  <td className="py-2 text-ink-2">{date(row.expiresAt)}</td>
                  <td className="py-2">
                    {row.usedAt ? (
                      <Tag tone="used">{row.usedByName ? t("usedBy", { name: row.usedByName }) : t("used")}</Tag>
                    ) : row.expired ? (
                      <Tag tone="used">{t("expired")}</Tag>
                    ) : (
                      <Tag tone="wait">{t("waiting")}</Tag>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!row.usedAt && (
                      <button
                        type="button"
                        className="text-[12px] text-danger hover:underline disabled:opacity-50"
                        disabled={pending}
                        onClick={() => start(async () => void (await runAction(() => revokeInvite(row.id))))}
                      >
                        {t("revoke")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
