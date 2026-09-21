"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { ContextMenu, type MenuAnchor, type MenuItem } from "@/components/ui/menu";
import { MessageBody } from "@/components/project/MessageBody";
import { MessageEditor } from "@/components/project/MessageEditor";
import { formatBytes, isInlineImage } from "@/lib/files/policy";
import { relativeShort, timeOf, type Translate } from "@/lib/projects/format";
import type { MessageItem } from "@/lib/queries/project";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";

/** 길게 누르기로 보는 시간(ms)과, 그 사이 이만큼 움직이면 스크롤로 본다(px). */
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

/**
 * 멘션 토큰을 이름으로 푼 글 — 복사와 메뉴 머리에 쓴다.
 * 토큰이 가리키는 사람을 찾지 못했을 때 쓸 말은 부른 쪽이 번역해 넘긴다.
 */
export function messagePlainText(
  m: Pick<MessageItem, "body" | "mentions">,
  labels: { all: string; unknown: string },
): string {
  return m.body.replace(/<@(all|[a-z0-9]{20,32})>/g, (_, id: string) =>
    id === "all" ? `@${labels.all}` : `@${m.mentions.find((x) => x.userId === id)?.name ?? labels.unknown}`,
  );
}

/**
 * 메시지 한 줄. 아바타 · 이름 · 시각 · (수정됨) · 고정 표시 · 본문 · 파일 · 답글 꼬리.
 * 마우스를 올리면 오른쪽 위에 도구가 뜬다. 삭제된 글은 자리만 남는다.
 *
 * 터치 기기에는 마우스 올리기가 없어 답글·수정·삭제를 할 길이 없었다(2026-09-17). 길게 누르거나
 * 머리줄의 ⋯ 로 같은 도구를 메뉴로 연다(폰에서는 아래에서 올라오는 시트). 길게 누르면 글자 선택이
 * 되지 않으므로 메뉴에 '텍스트 복사' 를 둔다.
 */
export function MessageRow({
  m,
  meId,
  meName,
  readOnly,
  highlighted,
  inThread,
  onEdit,
  onDelete,
  onPin,
  onOpenThread,
  onCopyLink,
}: {
  m: MessageItem;
  meId: string;
  /** 나를 부른 멘션에 붙일 내 이름 */
  meName?: string;
  /** 보관된 프로젝트. 도구를 감춘다. */
  readOnly: boolean;
  highlighted?: boolean;
  /** 스레드 창 안에서는 답글 꼬리·고정을 그리지 않는다 */
  inThread?: boolean;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onOpenThread?: (id: string) => void;
  onCopyLink?: (id: string) => void;
}) {
  const tz = useTimeZone();
  const format = useFormatter();
  const t = useTranslations("projects");
  // 순수 함수(lib/projects/format.ts)는 열쇠를 문자열로 받는다 — 거기서는 키 타입을 알 수 없다.
  const tx = t as unknown as Translate;
  const mentionLabels = { all: t("message.mentionAll"), unknown: t("message.unknownUser") };
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  // 길게 눌러 메뉴를 연 뒤 손을 떼면 click 이 한 번 온다 — 링크·답글 버튼이 눌리지 않게 삼킨다.
  const swallowClick = useRef(false);
  const author = m.author;
  const deleted = m.deletedAt != null;
  const canMenu = !deleted && !editing;

  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }

  function menuItems(): MenuItem[] {
    const items: MenuItem[] = [];
    if (!readOnly && !inThread && onOpenThread) items.push({ icon: "reply", label: t("message.replyInThread"), onSelect: () => onOpenThread(m.id) });
    if (!readOnly && !inThread && onPin) {
      items.push({ icon: "pin", label: m.pinnedAt ? t("message.unpin") : t("message.pin"), onSelect: () => onPin(m.id, !m.pinnedAt) });
    }
    if (onCopyLink) items.push({ icon: "link", label: t("message.copyLink"), onSelect: () => onCopyLink(m.id) });
    items.push({
      icon: "copy",
      label: t("message.copyText"),
      onSelect: () => void navigator.clipboard?.writeText(messagePlainText(m, mentionLabels)).catch(() => {}),
    });
    const mine = !readOnly && m.isMine;
    const removable = !readOnly && m.canDelete;
    if (mine || removable) items.push({ kind: "separator" });
    if (mine) items.push({ icon: "edit", label: t("message.edit"), onSelect: () => setEditing(true) });
    if (removable) items.push({ icon: "trash", label: t("message.delete"), danger: true, onSelect: () => onDelete(m.id) });
    return items;
  }

  return (
    <div
      id={`msg-${m.id}`}
      data-message={m.id}
      onTouchStart={(e) => {
        if (!canMenu || e.touches.length !== 1) return;
        const t = e.touches[0];
        cancelPress();
        press.current = {
          x: t.clientX,
          y: t.clientY,
          timer: setTimeout(() => {
            press.current = null;
            // 손을 뗄 때 오는 click 만 삼킨다. 오지 않는 브라우저도 있어(안드로이드·iOS 길게 누르기) 잠깐 뒤 푼다.
            swallowClick.current = true;
            setTimeout(() => (swallowClick.current = false), 700);
            setMenu({ x: t.clientX, y: t.clientY });
          }, LONG_PRESS_MS),
        };
      }}
      onTouchMove={(e) => {
        const p = press.current;
        const t = e.touches[0];
        if (p && t && (Math.abs(t.clientX - p.x) > MOVE_TOLERANCE || Math.abs(t.clientY - p.y) > MOVE_TOLERANCE)) cancelPress();
      }}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        // 메뉴는 이 줄 안에 그려진다 — 메뉴 항목 누름은 삼키지 않는다.
        if ((e.target as HTMLElement).closest?.("[role=menu]")) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={`group/msg relative flex gap-2.5 px-4 py-1.5 hover:bg-white/70 md:px-6 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] ${
        highlighted || menu ? "bg-[#fff9db]" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
        style={{ background: deleted ? "#a19f9d" : (author?.avatarColor ?? "#8a8886") }}
      >
        {deleted ? "?" : (author?.name.slice(0, 2) ?? "?")}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[13px]">
          <span className={`font-semibold ${deleted ? "text-ink-3" : ""}`}>
            {deleted ? t("message.deletedAuthor") : (author?.name ?? t("message.unknownUser"))}
          </span>
          <span className="text-[11.5px] text-ink-3" title={format.dateTime(new Date(m.createdAt), { dateStyle: "medium", timeStyle: "short" })}>
            {timeOf(m.createdAt, tz)}
          </span>
          {m.editedAt && !deleted && <span className="text-[11px] text-ink-3">{t("message.edited")}</span>}
          {m.pinnedAt && !deleted && !inThread && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-[#7a5a00]">
              <Icon name="pin" size={11} />
              {t("message.pinned")}
            </span>
          )}
          {canMenu && (
            <button
              type="button"
              aria-label={t("message.menu")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ x: r.right - 250, y: r.bottom + 2 });
              }}
              className="ml-auto hidden h-8 w-8 shrink-0 self-center place-items-center rounded text-ink-3 pointer-coarse:grid"
            >
              <Icon name="dots" size={16} />
            </button>
          )}
        </div>

        {deleted ? (
          <div className="text-[13px] italic text-ink-3">{t("message.deletedBody")}</div>
        ) : editing ? (
          <MessageEditor
            initial={m.body}
            onDone={(v) => {
              setEditing(false);
              if (v != null && v.trim() && v !== m.body) onEdit(m.id, v);
            }}
          />
        ) : (
          <MessageBody body={m.body} mentions={m.mentions} meId={meId} meName={meName} />
        )}

        {m.files.length > 0 && !deleted && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {m.files.map((f) =>
              isInlineImage(f.mimeType) ? (
                <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noopener" title={f.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${f.id}`} alt={f.name} className="max-h-[220px] max-w-[320px] rounded border border-[#e1dfdd] object-cover" />
                </a>
              ) : (
                <a
                  key={f.id}
                  href={`/api/files/${f.id}`}
                  className="inline-flex items-center gap-1.5 rounded border border-[#e1dfdd] bg-white px-2 py-1 text-[12.5px] hover:bg-side-hover"
                >
                  <Icon name="clip" size={13} className="text-ink-2" />
                  <span className="max-w-[240px] truncate">{f.name}</span>
                  <span className="text-[11.5px] text-ink-3">{formatBytes(f.size)}</span>
                </a>
              ),
            )}
          </div>
        )}

        {!inThread && m.replyCount > 0 && onOpenThread && (
          <button
            type="button"
            onClick={() => onOpenThread(m.id)}
            className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-link hover:underline"
          >
            <Icon name="reply" size={13} />
            {t("message.replyCount", { count: m.replyCount })}
            {m.lastReplyAt && (
              <span className="font-normal text-ink-3">
                {t("message.lastReply", { when: relativeShort(m.lastReplyAt, new Date(), tz, tx) })}
              </span>
            )}
          </button>
        )}
      </div>

      {!deleted && !editing && !readOnly && (
        <div className="absolute -top-2.5 right-6 hidden rounded border border-[#e1dfdd] bg-white text-[12px] shadow-[0_2px_6px_rgba(0,0,0,.08)] group-hover/msg:flex">
          {!inThread && onOpenThread && (
            <Tool onClick={() => onOpenThread(m.id)}>{t("message.reply")}</Tool>
          )}
          {!inThread && onPin && <Tool onClick={() => onPin(m.id, !m.pinnedAt)}>{m.pinnedAt ? t("message.unpin") : t("message.pin")}</Tool>}
          {m.isMine && <Tool onClick={() => setEditing(true)}>{t("message.edit")}</Tool>}
          {m.canDelete && (
            <Tool danger onClick={() => onDelete(m.id)}>
              {t("message.delete")}
            </Tool>
          )}
          {onCopyLink && <Tool onClick={() => onCopyLink(m.id)}>{t("message.copyLink")}</Tool>}
        </div>
      )}

      {menu && (
        <ContextMenu
          anchor={menu}
          items={menuItems()}
          title={`${author?.name ?? t("message.unknownUser")} · ${messagePlainText(m, mentionLabels).slice(0, 60)}`}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function Tool({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-l border-[#edebe9] px-2 py-0.5 first:border-l-0 hover:bg-side-hover ${danger ? "text-danger" : "text-ink-2"}`}
    >
      {children}
    </button>
  );
}
