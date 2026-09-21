"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

/**
 * 메시지 고치기 입력칸. 보고서 코멘트(lib/report/render.tsx CommentInput)와 같은 규칙 —
 * Enter 저장, Shift+Enter 줄바꿈, Esc 취소. 한글 조합을 끝내는 Enter 는 무시한다.
 * Esc 뒤에 blur 가 한 번 더 오므로 done 으로 두 번 부르지 않게 막는다.
 *
 * 폰 자판에는 Esc 가 없어 취소할 길이 없었다 — 저장·취소 버튼을 둔다(2026-09-17).
 * 버튼을 누르는 순간 입력칸이 blur 되면 저장이 먼저 불리므로, 버튼의 mousedown 에서 포커스를 뺏지 않는다.
 */
export function MessageEditor({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const t = useTranslations("projects");
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div>
      <textarea
        ref={ref}
        defaultValue={initial}
        aria-label={t("editor.label")}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
        className="mt-1 block w-full resize-none rounded border border-link px-2.5 py-1.5 text-[13.5px] leading-[1.55] outline-none"
      />
      <div className="mt-1 flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[11px] text-ink-3 pointer-coarse:hidden">{t("editor.hint")}</span>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => finish(null)}
          className="h-7 rounded px-2.5 text-[12.5px] text-ink-2 hover:bg-side-hover pointer-coarse:h-9 pointer-coarse:px-3.5"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => finish(ref.current?.value ?? initial)}
          className="h-7 rounded bg-link px-3 text-[12.5px] text-white pointer-coarse:h-9 pointer-coarse:px-4"
        >
          {t("save")}
        </button>
      </div>
    </div>
  );
}
