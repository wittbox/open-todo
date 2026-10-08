"use client";

import { useCallback, useLayoutEffect, useRef, type ComponentProps } from "react";

/**
 * 내용만큼 아래로 늘어나는 한 줄짜리 입력칸 — 작업 제목·단계 이름.
 *
 * `<input>` 은 길게 쓰면 옆으로 잘리고, `rows={1}` 짜리 `<textarea>` 는 접히긴 해도 한 줄 높이에
 * 갇혀 안에서 스크롤된다. 그래서 글이 바뀔 때마다 높이를 내용(scrollHeight)에 맞춘다.
 * CSS `field-sizing: content` 는 아직 모든 브라우저(아이폰 Safari 등)에 있지 않아 쓰지 않는다.
 *
 * 폭이 바뀌면(창 크기·상세 창 폭) 줄이 다시 접히므로 그때도 맞춘다. 높이를 바꾸는 것 자체가 다시
 * 크기 변화를 부르지 않게, 폭이 달라졌을 때만 다시 잰다.
 */
export function GrowingTextarea({ ref, onInput, className = "", ...rest }: ComponentProps<"textarea">) {
  const inner = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // 제어 컴포넌트(value)는 값이 바뀔 때마다, 아니면 처음 한 번.
  useLayoutEffect(fit, [fit, rest.value]);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <textarea
      rows={1}
      {...rest}
      ref={(el) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      onInput={(e) => {
        fit();
        onInput?.(e);
      }}
      className={`resize-none overflow-hidden ${className}`}
    />
  );
}

/** 한 줄 항목에 들어온 줄바꿈(붙여 넣기 등)은 띄어쓰기로 — 이 칸들은 Enter 가 저장이다. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}

/**
 * 이 칸들의 Enter — 줄바꿈은 넣지 않고(Shift+Enter 도) 저장·제출한다.
 * 한글 조합 중에 온 Enter 는 넘긴다: 조합이 끝난 뒤 같은 Enter 가 한 번 더 오고(229 → Enter),
 * 그때 처리해야 마지막 글자가 빠지거나 두 번 들어가지 않는다.
 */
export function onEnter(e: React.KeyboardEvent, action: () => void): void {
  if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  action();
}
