"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { PHONE_QUERY } from "@/components/shell/shell";
import { useMediaQuery } from "@/components/shell/useMediaQuery";

export type MenuItem =
  | { kind: "separator" }
  | {
      kind?: "item";
      icon?: IconName;
      label: string;
      shortcut?: string;
      danger?: boolean;
      /** 아직 구현 전인 항목. 흐리게 표시하고 사유를 배지로 알린다. */
      pending?: string;
      submenu?: boolean;
      onSelect?: () => void;
    };

export type MenuAnchor = { x: number; y: number };

/**
 * 우클릭 컨텍스트 메뉴. 화면 밖으로 나가지 않게 위치를 보정한다.
 * Esc · 바깥 클릭 · 바깥 스크롤로 닫힌다.
 *
 * 폰(768px 미만)에서는 누른 자리 옆이 아니라 **아래에서 올라오는 시트**로 뜬다 — 손가락 옆의 작은
 * 메뉴는 누르기 어렵고 화면 밖으로 밀린다. 뒤 판을 누르면 닫힌다. title 은 시트 머리에 무엇의 메뉴인지 적는다.
 */
export function ContextMenu({
  anchor,
  items,
  onClose,
  minWidth = 250,
  title,
}: {
  anchor: MenuAnchor;
  items: MenuItem[];
  onClose: () => void;
  minWidth?: number;
  /** 폰 시트 머리에 보일 이름(목록 이름, 메시지 앞부분 등) */
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);
  const sheet = useMediaQuery(PHONE_QUERY, false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || sheet) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - r.height - 8)),
    });
  }, [anchor.x, anchor.y, items.length, sheet]);

  useEffect(() => {
    const inside = (e: Event) => e.target instanceof Node && (ref.current?.contains(e.target) ?? false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = (e: Event) => {
      if (!inside(e)) onClose();
    };
    const close = () => onClose();

    // 바깥을 눌렀을 때만 닫는다.
    //
    // 예전에는 메뉴 div 의 React onMouseDown 에서 stopPropagation 하는 것으로
    // 막으려 했는데 통하지 않았다. React 는 이벤트를 루트에 위임해서 처리하고
    // 이 리스너는 document 에 직접 붙어 있어, 위임 순서에 기대면 메뉴가
    // mousedown 에서 닫혀 버렸다. 그러면 버튼이 사라진 뒤에 click 이 와서
    // 메뉴 항목이 하나도 동작하지 않는다.
    //
    // 위임 순서 대신 "눌린 지점이 메뉴 안인가"를 직접 본다.
    const onDown = (e: MouseEvent) => {
      if (inside(e)) return;
      onClose();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    // 메뉴를 연 그 클릭이 곧바로 닫지 않도록 다음 틱부터 듣는다.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const list = items.map((it, i) =>
    it.kind === "separator" ? (
      <div key={i} className={sheet ? "my-1 h-px bg-divider" : "my-1.5 h-px bg-divider"} />
    ) : (
      <button
        key={i}
        role="menuitem"
        type="button"
        disabled={Boolean(it.pending)}
        onClick={() => {
          if (it.pending) return;
          it.onSelect?.();
          if (!it.submenu) onClose();
        }}
        className={[
          "flex w-full items-center gap-3.5 px-3.5 text-left",
          sheet ? "min-h-12 px-5 text-[15.5px]" : "py-2 text-sm",
          it.pending ? "cursor-default text-ink-3" : "hover:bg-side-hover active:bg-side-hover",
          it.danger && !it.pending ? "text-danger" : "",
        ].join(" ")}
      >
        <span className="grid w-[18px] shrink-0 place-items-center text-ink-2">
          {it.icon && <Icon name={it.icon} size={sheet ? 19 : 17} />}
        </span>
        <span className="flex-1">{it.label}</span>
        {it.pending && <span className="rounded-full bg-pane-bg px-2 py-0.5 text-[11px] text-ink-2">{it.pending}</span>}
        {it.shortcut && !sheet && <span className="text-xs text-ink-2">{it.shortcut}</span>}
        {it.submenu && <Icon name="chevronRight" size={14} className="text-ink-2" />}
      </button>
    ),
  );

  if (sheet) {
    return (
      <>
        {/* 뒤 판을 누르면 바깥 mousedown 으로 닫힌다 */}
        <div data-menu-backdrop="" className="fixed inset-0 z-50 bg-black/35" />
        <div
          ref={ref}
          role="menu"
          aria-label={title}
          data-menu-sheet=""
          className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-white pb-[max(12px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_20px_rgba(0,0,0,.15)]"
        >
          <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-[#c8c6c4]" aria-hidden="true" />
          {title && <div className="truncate px-5 pb-2 text-[13px] text-ink-2">{title}</div>}
          {list}
        </div>
      </>
    );
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      style={{ left: pos.x, top: pos.y, minWidth }}
      className="fixed z-50 rounded-md border border-[#e1dfdd] bg-white py-1.5 shadow-[0_6.4px_14.4px_rgba(0,0,0,.132),0_1.2px_3.6px_rgba(0,0,0,.108)]"
    >
      {list}
    </div>
  );
}

/**
 * 줄 오른쪽의 ⋯ 버튼 — 오른쪽 클릭으로만 열리던 메뉴를 손가락으로도 연다.
 * 마우스로는 줄에 올렸을 때만 보이고(부르는 줄에 group 클래스), 터치 기기에서는 늘 보인다.
 * 끌기 센서(MouseSensor·TouchSensor 는 mousedown·touchstart 를 듣는다)가 버튼 누름을 끌기로
 * 잡지 않게 누름을 줄로 올려보내지 않는다.
 */
export function RowMenuButton({ label, onOpen }: { label: string; onOpen: (anchor: MenuAnchor) => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onOpen({ x: r.right - 250, y: r.bottom + 2 });
      }}
      className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-2 opacity-0 hover:bg-black/5 focus:opacity-100 group-hover:opacity-100 pointer-coarse:h-9 pointer-coarse:w-9 pointer-coarse:opacity-100"
    >
      <Icon name="dots" size={16} />
    </button>
  );
}
