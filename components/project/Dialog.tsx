"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";

/**
 * 프로젝트 화면의 다이얼로그 껍데기. ShareDialog·SendDialog 와 같은 모양
 * (어두운 바탕, 흰 판, Esc 로 닫힘)을 세 창이 따로 베끼지 않게 한 곳에 둔다.
 */
export function Dialog({
  title,
  width = 520,
  onClose,
  children,
}: {
  title: string;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("projects");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="presentation" onMouseDown={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width }}
        className="thin-scroll max-h-[86dvh] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg bg-white p-6 shadow-[0_25.6px_57.6px_rgba(0,0,0,.22)]"
      >
        <div className="mb-4 flex items-center">
          <h3 className="text-lg font-semibold">{title}</h3>
          <span className="flex-1" />
          <button type="button" onClick={onClose} aria-label={t("close")} className="text-ink-2 hover:text-ink">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const INPUT_CLASS =
  "h-[34px] w-full rounded border border-[#8a8886] px-2.5 text-sm outline-none focus:border-link focus:shadow-[0_0_0_1px_#2564cf]";
export const BTN_CLASS = "h-8 rounded border border-[#8a8886] px-4 text-sm hover:bg-side-hover disabled:opacity-50";
export const PRIMARY_CLASS = "h-8 rounded bg-link px-4 text-sm text-white hover:brightness-95 disabled:opacity-50";
