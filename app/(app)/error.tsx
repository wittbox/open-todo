"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * 화면이 깨졌을 때 보여 줄 것.
 *
 * 가장 흔한 원인은 배포다. 탭을 열어 둔 채로 새 버전이 올라가면, 그 화면이
 * 부르는 서버 액션이 서버에 더는 없어서
 * "Failed to find Server Action ... from an older or newer deployment" 가 난다.
 * 사용자가 한 일과는 아무 상관이 없는데, 기본 화면은 영어로 "This page
 * couldn't load" 만 보여 줘서 방금 누른 것이 고장 난 것처럼 보인다.
 *
 * 그 경우는 새로 받으면 끝나므로 한 번만 스스로 새로고침한다. 두 번째부터는
 * 진짜 문제일 수 있으니 멈추고 사람이 보게 둔다.
 */
const RELOAD_MARK = "todo:auto-reloaded";

function isStaleDeployment(error: Error & { digest?: string }): boolean {
  const text = `${error.message} ${error.digest ?? ""}`;
  return /Server Action|older or newer deployment/i.test(text);
}

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("nav.error");
  const [stale] = useState(() => isStaleDeployment(error));

  useEffect(() => {
    if (!stale) return;
    if (sessionStorage.getItem(RELOAD_MARK)) return;
    sessionStorage.setItem(RELOAD_MARK, "1");
    window.location.reload();
  }, [stale]);

  useEffect(() => {
    // 정상으로 돌아온 화면에서는 표시를 지운다 — 다음에 또 필요할 수 있다.
    if (!stale) sessionStorage.removeItem(RELOAD_MARK);
  }, [stale]);

  return (
    <main className="grid flex-1 place-items-center bg-pane-bg px-6">
      <div className="w-full max-w-md rounded-lg border border-side-border bg-white p-7 text-center">
        <h1 className="text-base font-semibold">{stale ? t("staleTitle") : t("failedTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          {stale ? (
            <>
              {t("staleLine1")}
              <br />
              {t("staleLine2")}
            </>
          ) : (
            <>
              {t("failedLine1")}
              <br />
              {t("failedLine2")}
            </>
          )}
        </p>

        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="h-9 rounded bg-link px-4 text-sm text-white hover:brightness-95"
          >
            {t("reload")}
          </button>
          <button
            onClick={reset}
            className="h-9 rounded border border-[#8a8886] px-4 text-sm hover:bg-side-hover"
          >
            {t("retry")}
          </button>
        </div>

        {error.digest && <p className="mt-4 font-mono text-[11px] text-ink-3">{error.digest}</p>}
      </div>
    </main>
  );
}
