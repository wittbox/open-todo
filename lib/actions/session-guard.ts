import type { ActionResult } from "@/lib/actions/_helpers";
import { HOME_PATH } from "@/lib/home";
import { loadMessages } from "@/i18n/messages";
import { isLocale } from "@/i18n/locales";

/**
 * 세션이 끊긴 화면을 로그인으로 돌려보낸다.
 *
 * 끊긴 화면은 멀쩡해 보인다. 눌러도 아무 일이 없을 뿐이라, 실제로 "작업 순서가
 * 저장되지 않는다"는 기능 버그로 신고됐다(2026-09-10 작업기록 6절).
 *
 * 끊기는 방식이 둘이다.
 *   1. 액션이 돌긴 하는데 requireUserId 에서 걸린다 → ActionResult 의 code 로 온다.
 *   2. 액션이 아예 못 돈다 → 관문이 POST 를 /login 으로 돌려보내고, Next 는 그 응답을
 *      이해하지 못해 "An unexpected response was received from the server" 를 던진다.
 *      던져진 예외는 오류 경계가 삼켜서 화면에는 아무 흔적도 남지 않는다.
 * 쿠키가 만료된 실제 상황은 2번이다. 1번만 막으면 아무것도 고쳐지지 않는다.
 */

/**
 * 이 파일은 브라우저에서만 도는 도우미라 next-intl 훅을 쓸 수 없다(컴포넌트가 아니다).
 * 언어는 <html lang> 에서 읽는다 — 루트 레이아웃이 요청 언어로 적어 둔 값이다.
 */
function guardText(key: "errors.unauthenticated" | "errors.generic"): string {
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
  const messages = loadMessages(isLocale(lang) ? lang : "ko");
  return key === "errors.unauthenticated" ? messages.errors.unauthenticated : messages.errors.generic;
}

/** 인증이 끊긴 응답이면 갈 곳, 아니면 null. */
export function loginRedirect(res: ActionResult<unknown>, here: string): string | null {
  if (res.ok || res.code !== "unauthenticated") return null;
  return loginUrl(here);
}

/** 열려 있던 자리를 들고 가는 로그인 주소. */
export function loginUrl(here: string): string {
  // 둘째 글자가 / 나 \ 면 브라우저가 프로토콜 상대 주소로 읽어 밖으로 나간다.
  const inApp = here.startsWith("/") && here[1] !== "/" && here[1] !== "\\";
  return `/login?returnTo=${encodeURIComponent(inApp ? here : HOME_PATH)}`;
}

type Deps = {
  /** 세션이 끊겼는지 확인한다 */
  probe: () => Promise<boolean>;
  /** 로그인으로 보낸다 */
  go: (url: string) => void;
  /** 지금 화면의 경로 */
  here: () => string;
};

const browser: Deps = {
  probe: async () => {
    try {
      // 보호된 경로를 한 번 두드려 본다. 세션이 없으면 관문이 로그인으로 돌려보낸다.
      const res = await fetch(window.location.pathname, { redirect: "manual" });
      return res.type === "opaqueredirect" || res.status === 401 || res.status === 307;
    } catch {
      // 확인할 수 없으면 끊겼다고 단정하지 않는다. 네트워크가 잠깐 흔들렸을 수도 있다.
      return false;
    }
  },
  go: (url) => window.location.assign(url),
  here: () => window.location.pathname + window.location.search,
};

/**
 * 서버 액션 호출을 감싼다.
 *
 * 호출 자체가 깨지면 세션을 확인하고, 끊겼으면 로그인으로 보낸다. 아니면 평범한
 * 실패로 바꿔 돌려준다 — 오류 경계가 화면을 통째로 가져가는 것보다 낫다.
 */
export async function runAction<T>(
  fn: () => Promise<ActionResult<T>>,
  deps: Deps = browser,
): Promise<ActionResult<T>> {
  let res: ActionResult<T>;
  try {
    res = await fn();
  } catch {
    if (await deps.probe()) {
      deps.go(loginUrl(deps.here()));
      return { ok: false, error: guardText("errors.unauthenticated"), code: "unauthenticated" };
    }
    return { ok: false, error: guardText("errors.generic"), code: "unknown" };
  }

  // 액션이 돌아서 인증 오류를 돌려준 경우(1번). 화면에 오류 한 줄을 남기는 대신 보낸다.
  if (!res.ok && res.code === "unauthenticated") deps.go(loginUrl(deps.here()));
  return res;
}

/** 인증 오류였으면 로그인으로 보내고 true. runAction 이 이미 보냈으면 문구만 감춘다. */
export function handledAuthFailure(res: ActionResult<unknown>): boolean {
  return !res.ok && res.code === "unauthenticated";
}
