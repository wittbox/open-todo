"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 화면 폭 조건을 읽는다. 서버는 폭을 모르므로 serverValue 로 그리고, 붙은 뒤 실제 값으로 바뀐다.
 * matchMedia 가 없는 곳(시험의 jsdom 등)에서도 serverValue 다.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const m = window.matchMedia(query);
      m.addEventListener?.("change", onChange);
      return () => m.removeEventListener?.("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : serverValue),
    () => serverValue,
  );
}
