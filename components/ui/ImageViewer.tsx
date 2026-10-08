"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { formatBytes } from "@/lib/files/policy";

/**
 * 첨부 사진 보기. 예전에는 사진을 누르면 새 탭으로 열렸다.
 *
 * 화면에 맞춰 크게 띄우고, 같은 작업(또는 같은 메시지)의 사진끼리 ◀ ▶ · ← → · 옆으로 밀기로 넘긴다.
 * 사진을 누르면 원본 크기(스크롤로 훑기) ↔ 화면 맞춤. 작은 글씨가 찍힌 라벨·성적서 사진을 확인하려는 것.
 * 닫기: ✕ · Esc · 사진 바깥 누르기. 열려 있는 동안 뒤 화면은 스크롤되지 않는다.
 */

export type ViewerImage = { id: string; name: string; size?: number; uploaderName?: string | null };

const SWIPE_PX = 50;

export function ImageViewer({
  images,
  start,
  onClose,
}: {
  images: ViewerImage[];
  start: number;
  onClose: () => void;
}) {
  const t = useTranslations("files.viewer");
  const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), images.length - 1));
  const [zoom, setZoom] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const many = images.length > 1;
  const img = images[index];

  const go = (by: number) => {
    if (!many) return;
    setIndex((i) => (i + by + images.length) % images.length);
    setZoom(false);
  };

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!img) return null;
  const src = `/api/files/${img.id}`;
  const meta = [img.size != null ? formatBytes(img.size) : null, img.uploaderName].filter(Boolean).join(" · ");
  const btn = "inline-grid h-8 min-w-8 place-items-center rounded bg-white/15 px-2.5 text-[12.5px] text-white hover:bg-white/25";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={img.name}
      className="fixed inset-0 z-[100] flex flex-col bg-black/85 text-white"
      onClick={(e) => {
        // 사진·버튼이 아닌 곳(어두운 바탕)을 누르면 닫는다.
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.backdrop != null) onClose();
      }}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null || zoom) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > SWIPE_PX) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex shrink-0 items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
        <span className="min-w-0 truncate font-semibold">{img.name}</span>
        {meta && <span className="shrink-0 text-xs text-[#c8c6c4]">{meta}</span>}
        <span className="flex-1" />
        <a href={src} target="_blank" rel="noreferrer" className={`${btn} max-sm:hidden`}>
          {t("openInTab")}
        </a>
        <a href={src} download={img.name} className={btn}>
          {t("download")}
        </a>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t("close")} className={btn}>
          <Icon name="x" size={15} />
        </button>
      </div>

      <div
        data-backdrop=""
        className={`relative min-h-0 flex-1 ${zoom ? "overflow-auto" : "grid place-items-center overflow-hidden p-4 sm:px-16"}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={img.id}
          src={src}
          alt={img.name}
          onClick={() => setZoom((z) => !z)}
          className={
            zoom
              ? "m-auto max-w-none cursor-zoom-out"
              : "max-h-full max-w-full cursor-zoom-in object-contain shadow-[0_10px_40px_rgba(0,0,0,.5)]"
          }
        />
        {many && !zoom && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t("prev")}
              className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/15 hover:bg-white/25 max-sm:hidden"
            >
              <Icon name="chevronRight" size={18} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t("next")}
              className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/15 hover:bg-white/25 max-sm:hidden"
            >
              <Icon name="chevronRight" size={18} />
            </button>
          </>
        )}
      </div>

      <div className="shrink-0 pb-3 pt-2 text-center text-xs text-[#c8c6c4]">
        {many && (
          <span>
            {index + 1} / {images.length}
          </span>
        )}
        <span className="ml-3 max-sm:hidden">{zoom ? t("fit") : t("actualSize")}</span>
      </div>
    </div>,
    document.body,
  );
}
