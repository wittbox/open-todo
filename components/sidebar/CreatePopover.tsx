"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";

/**
 * 사이드바 아래 '새 목록' · '새 그룹' 을 누르면 버튼 위로 뜨는 풍선.
 *
 * 예전에는 '새 그룹' 이 누르는 즉시 "제목 없는 그룹" 을 만들어서, 이름을 바꾸려면 다시 메뉴를 열어야 했다.
 * 이름이 비어 있으면 '만들기' 가 잠긴다 — 이름 없는 그룹·목록이 쌓이지 않게.
 *
 * 바깥을 누르거나 Esc 로 닫힌다(입력한 것은 버린다). 버튼 자체를 다시 누르면 닫히도록, 버튼에는
 * `data-create-anchor` 를 달아 두고 바깥 누름에서 뺀다(안 그러면 닫혔다가 곧바로 다시 열린다).
 */

const WIDTH = 288;
const GAP = 10;
const NEW_GROUP = "__new__";

export type CreateTarget = { groupId: string } | { newGroupName: string };

function Balloon({
  anchor,
  align,
  label,
  onClose,
  children,
}: {
  anchor: DOMRect;
  /** 풍선을 버튼의 어느 쪽 끝에 맞출지 */
  align: "left" | "right";
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 풍선은 버튼을 누른 뒤에만 그려진다(서버에서 그릴 일이 없다) — 화면 크기를 바로 읽어 자리를 정한다.
  const raw = align === "right" ? anchor.right - WIDTH : anchor.left + 8;
  const left = Math.max(8, Math.min(raw, window.innerWidth - WIDTH - 8));
  const bottom = window.innerHeight - anchor.top + GAP;

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest("[data-create-anchor]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const arrow = Math.max(16, Math.min(anchor.left + anchor.width / 2 - left, WIDTH - 16));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="fixed z-50 rounded-lg bg-white p-3.5 text-sm shadow-[0_10px_30px_rgba(0,0,0,.18),0_0_0_1px_rgba(0,0,0,.06)]"
      style={{ width: WIDTH, left, bottom }}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute -bottom-1.5 h-3 w-3 rotate-45 bg-white shadow-[3px_3px_4px_rgba(0,0,0,.06)]"
        style={{ left: arrow - 6 }}
      />
    </div>
  );
}

const inputCls =
  "h-[34px] w-full rounded border border-[#8a8886] bg-white px-2.5 text-sm outline-none focus:border-[#2564cf] focus:shadow-[0_0_0_1px_#2564cf]";

function Footer({ ready, onClose }: { ready: boolean; onClose: () => void }) {
  const t = useTranslations("nav.create");
  return (
    <div className="mt-3 flex justify-end gap-2">
      <button type="button" onClick={onClose} className="h-[30px] rounded border border-[#8a8886] px-3 text-[13px] hover:bg-side-hover">
        {t("cancel")}
      </button>
      <button
        type="submit"
        disabled={!ready}
        className="h-[30px] rounded bg-[#2564cf] px-3 text-[13px] text-white disabled:opacity-40"
      >
        {t("submit")}
      </button>
    </div>
  );
}

export function NewGroupPopover({
  anchor,
  onCreate,
  onClose,
}: {
  anchor: DOMRect;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("nav.create");
  const [name, setName] = useState("");
  const ready = name.trim().length > 0;
  return (
    <Balloon anchor={anchor} align="right" label={t("groupTitle")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onCreate(name.trim());
        }}
      >
        <p className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold">
          <Icon name="groupPlus" size={16} />
          {t("groupTitle")}
        </p>
        <input
          autoFocus
          aria-label={t("groupName")}
          placeholder={t("groupName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />
        <p className="mt-1.5 text-[11.5px] text-ink-3">{t("groupHint")}</p>
        <Footer ready={ready} onClose={onClose} />
      </form>
    </Balloon>
  );
}

export function NewListPopover({
  anchor,
  groups,
  defaultGroupId,
  onCreate,
  onClose,
}: {
  anchor: DOMRect;
  /** 목록을 넣을 수 있는 내 그룹들(사이드바 순서) */
  groups: { id: string; name: string }[];
  defaultGroupId: string | null;
  onCreate: (name: string, target: CreateTarget) => void;
  onClose: () => void;
}) {
  const t = useTranslations("nav.create");
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? NEW_GROUP);
  const [groupName, setGroupName] = useState("");
  // 그룹이 하나도 없으면 고를 것이 없다 — 같은 풍선에서 그룹 이름도 받는다.
  const makingGroup = groups.length === 0 || groupId === NEW_GROUP;
  const ready = name.trim().length > 0 && (!makingGroup || groupName.trim().length > 0);

  return (
    <Balloon anchor={anchor} align="left" label={t("listTitle")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onCreate(name.trim(), makingGroup ? { newGroupName: groupName.trim() } : { groupId });
        }}
      >
        <p className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold">
          <Icon name="plus" size={16} />
          {t("listTitle")}
        </p>
        <input
          autoFocus
          aria-label={t("listName")}
          placeholder={t("listName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />

        <p className="mb-1 mt-2.5 text-xs text-ink-2">
          {t("listGroup")}
          {groups.length === 0 && <span className="text-ink-3"> — {t("noGroupsYet")}</span>}
        </p>
        {groups.length > 0 && (
          <select
            aria-label={t("listGroup")}
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className={`${inputCls} cursor-pointer`}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={NEW_GROUP}>{t("newGroupOption")}</option>
          </select>
        )}
        {makingGroup && (
          <input
            autoFocus={groups.length > 0}
            aria-label={t("newGroupName")}
            placeholder={t("newGroupName")}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className={`${inputCls} ${groups.length > 0 ? "mt-2" : ""}`}
          />
        )}
        <Footer ready={ready} onClose={onClose} />
      </form>
    </Balloon>
  );
}
