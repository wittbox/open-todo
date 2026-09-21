"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  markAllNotificationsRead,
  markNotificationRead,
  setDailyMail,
} from "@/lib/actions/notification";
import type { NotificationItem } from "@/lib/queries/notifications";
import { useFormatter, useTranslations } from "next-intl";

/**
 * 알림 목록.
 *
 * 문구는 여기서 만든다 — 저장해 두면 나중에 말을 고칠 때 옛 알림만 옛말로 남는다.
 */
function useDescribe(): (n: NotificationItem) => React.ReactNode {
  const t = useTranslations("notifications");
  const bold = (chunks: React.ReactNode) => <b className="font-semibold">{chunks}</b>;
  // 알림 종류가 곧 열쇠라서 키를 문자열로 만든다 — next-intl 의 좁은 키 타입만 비켜 간다.
  const rich = t.rich as unknown as (key: string, values: Record<string, unknown>) => React.ReactNode;
  return (n) =>
    rich(`items.${n.kind}`, {
      b: bold,
      task: n.taskTitle ?? t("fallback.task"),
      list: n.listName ?? t("fallback.list"),
      project: n.projectName ?? t("fallback.project"),
      report: n.reportTitle ?? t("fallback.report"),
      actor: n.actorName ?? t("fallback.someone"),
    });
}

function when(
  format: ReturnType<typeof useFormatter>,
  t: ReturnType<typeof useTranslations<"notifications">>,
  iso: string,
): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return t("time.now");
  if (diff < 3_600_000) return t("time.minutes", { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("time.hours", { count: Math.floor(diff / 3_600_000) });
  return format.dateTime(d, { month: "long", day: "numeric" });
}

export function NotificationList({
  items,
  dailyMail,
}: {
  items: NotificationItem[];
  dailyMail: boolean;
}) {
  const router = useRouter();
  const format = useFormatter();
  const t = useTranslations("notifications");
  const describe = useDescribe();
  const [, startTransition] = useTransition();
  const [mailOn, setMailOn] = useState(dailyMail);

  const unread = items.filter((n) => !n.isRead).length;

  function open(n: NotificationItem) {
    startTransition(async () => {
      if (!n.isRead) await markNotificationRead(n.id);
      // 프로젝트 분기가 먼저다 — 멘션 알림에는 listId 가 없지만, 순서를 뒤에 두면 규칙이 겹칠 때 엉킨다.
      if (n.projectId) router.push(`/projects/${n.projectId}${n.messageId ? `?msg=${n.messageId}` : ""}`);
      else if (n.reportId) router.push(`/reports/${n.reportId}`);
      else if (n.taskId && n.listId) router.push(`/list/${n.listId}?task=${n.taskId}`);
      else if (n.listId) router.push(`/list/${n.listId}`);
      else router.refresh();
    });
  }

  return (
    <main className="thin-scroll min-w-0 flex-1 overflow-y-auto bg-pane-bg">
      <div className="mx-auto max-w-3xl px-3 py-4 md:px-7 md:py-7">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          {unread > 0 && (
            <span className="rounded-full bg-[#c2185b] px-2.5 py-0.5 text-xs text-white">{unread}</span>
          )}
          {unread > 0 && (
            <button
              onClick={() => startTransition(async () => void (await markAllNotificationsRead()))}
              className="ml-auto h-8 rounded border border-[#8a8886] bg-white px-3 text-sm hover:bg-side-hover"
            >
              {t("markAllRead")}
            </button>
          )}
        </div>

        <label className="mb-5 flex items-center gap-2.5 rounded border border-side-border bg-white px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={mailOn}
            onChange={(e) => {
              const on = e.target.checked;
              setMailOn(on);
              startTransition(async () => void (await setDailyMail(on)));
            }}
          />
          <span>
            {t("dailyMail")}
            <span className="ml-2 text-xs text-ink-2">{t("dailyMailHint")}</span>
          </span>
        </label>

        <div className="overflow-hidden rounded border border-side-border bg-white">
          {items.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-ink-2">
              {t("empty")}
              <br />
              {t("emptyHint")}
            </p>
          )}

          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className={`flex w-full items-start gap-3 border-t border-divider px-4 py-3 text-left first:border-t-0 hover:bg-side-hover ${
                n.isRead ? "" : "bg-[#f5f9ff]"
              }`}
            >
              <span
                className={`mt-2 h-[7px] w-[7px] shrink-0 rounded-full ${n.isRead ? "" : "bg-link"}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{describe(n)}</span>
                <span className="block text-[11.5px] text-ink-3">
                  {[n.listName, n.taskSeq ? `#${n.taskSeq}` : null, when(format, t, n.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Icon name="chevronRight" size={14} className="mt-1 shrink-0 text-ink-3" />
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
