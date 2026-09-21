"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * 탭이 보이는 동안만 주기적으로 부른다. 숨기면 멈추고, 다시 보이거나 창이 앞으로 오면 바로 한 번.
 * 겹쳐 돌지 않게 앞 호출이 끝나야 다음을 잰다.
 */
export function usePoll(fn: () => Promise<void>, intervalMs: number, enabled = true) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const running = useRef(false);

  /** force: 내 동작 직후처럼 화면이 숨겨져 있어도 한 번은 받아야 할 때 */
  const tick = useCallback(async (force = false) => {
    if (running.current) return;
    if (!force && typeof document !== "undefined" && document.visibilityState !== "visible") return;
    running.current = true;
    try {
      await fnRef.current();
    } catch {
      // 다음 주기에 다시 한다. 화면이 오류를 보여 줄 일이 아니다.
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void tick(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, intervalMs, tick]);

  return tick;
}
